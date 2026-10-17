// เซิร์ฟเวอร์สำหรับรันในเครื่อง — เสิร์ฟหน้าเว็บ + data.json สด, ปุ่มรีเฟรช และ cron ดึงข้อมูลรายวัน
// (บน GitHub Pages ไม่ใช้ไฟล์นี้ แต่ใช้ GitHub Actions + src/build.js แทน)
import express from 'express';
import cron from 'node-cron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './store.js';
import { collectMissing, provider, TIMEZONE, today } from './collector.js';
import { buildDataset } from './dataset.js';
import Anthropic from '@anthropic-ai/sdk';
import { addLink, loadLinks, removeLink, updateManual } from './links.js';
import { analyzeProduct, loadAnalyses } from './analyzer.js';
import { ranking } from '../public/lib/analytics.js';

const PORT = Number(process.env.PORT) || 3000;
// ค่าเริ่มต้น: ดึงข้อมูลทุกวันเวลา 06:00 น. (เวลาไทย)
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 6 * * *';
// ช่วงพักขั้นต่ำระหว่างการกดรีเฟรช — กันการกดรัวจนเสียค่า Apify
const REFRESH_COOLDOWN_MS = (Number(process.env.REFRESH_COOLDOWN_MINUTES) || 10) * 60 * 1000;

const app = express();

const hasAnthropicKey = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

app.get('/data.json', (req, res) => {
  res.json(buildDataset({ provider: provider.name, canRefresh: true, canAnalyze: hasAnthropicKey() }));
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

// เพิ่มสินค้า/ร้านจากลิงก์ TikTok Shop — ข้อมูลยอดขายจะตามมาตอนเก็บข้อมูลครั้งถัดไป (ถ้าใช้ Apify)
app.post('/api/links', express.json({ limit: '10kb' }), async (req, res) => {
  if (typeof req.body?.url !== 'string') return res.status(400).json({ error: 'กรุณาวางลิงก์' });
  try {
    res.json(await addLink(req.body.url));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// บันทึกราคา / ยอดขายสะสม / % ค่าคอม ที่ผู้ใช้กรอกเอง
app.put('/api/links/:id/manual', express.json({ limit: '10kb' }), (req, res) => {
  try {
    res.json(updateManual(req.params.id, req.body ?? {}, today()));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/links/:id', (req, res) => {
  res.json({ removed: removeLink(req.params.id) });
});

// วิเคราะห์สินค้าด้วย AI — มีค่าใช้จ่ายต่อครั้ง จึงคืนผลเดิมถ้าเคยวิเคราะห์แล้ว (ส่ง ?force=1 เพื่อวิเคราะห์ใหม่)
const analyzing = new Map();
app.post('/api/analyze/:id', async (req, res) => {
  const { id } = req.params;
  if (!hasAnthropicKey()) return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY ในไฟล์ .env' });
  const cached = loadAnalyses()[id];
  if (cached && req.query.force !== '1') return res.json(cached);

  const dataset = buildDataset({ provider: provider.name, canRefresh: true });
  const metrics = ranking(dataset, { days: 7, limit: 100000 }).find((r) => r.id === id);
  const product = metrics ?? loadLinks().find((l) => l.id === id);
  if (!product) return res.status(404).json({ error: 'ไม่พบสินค้า' });

  try {
    if (!analyzing.has(id)) analyzing.set(id, analyzeProduct(product, metrics).finally(() => analyzing.delete(id)));
    res.json(await analyzing.get(id));
  } catch (err) {
    console.error('[analyze]', err);
    if (err instanceof Anthropic.AuthenticationError) return res.status(400).json({ error: 'ANTHROPIC_API_KEY ไม่ถูกต้อง' });
    if (err instanceof Anthropic.RateLimitError) return res.status(429).json({ error: 'เรียก AI ถี่เกินไป ลองใหม่อีกสักครู่' });
    if (err instanceof Anthropic.APIError) return res.status(502).json({ error: `AI ขัดข้อง (${err.status ?? 'เชื่อมต่อไม่ได้'})` });
    res.status(500).json({ error: err.message });
  }
});

// กันไม่ให้เก็บข้อมูลซ้อนกัน (เช่น cron ทำงานพร้อมกับกดรีเฟรช) — สำคัญเพราะ Apify คิดเงินต่อครั้ง
let running = null;
function collect() {
  running ??= collectMissing().finally(() => { running = null; });
  return running;
}

let lastRefresh = 0;
app.post('/api/refresh', async (req, res) => {
  const wait = lastRefresh + REFRESH_COOLDOWN_MS - Date.now();
  if (wait > 0) return res.status(429).json({ error: `รีเฟรชได้อีกครั้งใน ${Math.ceil(wait / 60000)} นาที` });
  lastRefresh = Date.now();
  try {
    const added = await collect();
    res.json({ added, lastUpdated: store.lastUpdated() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')));

store.load(provider.name);

app.listen(PORT, () => {
  console.log(`TikTok Trends พร้อมใช้งานที่ http://localhost:${PORT} (ข้อมูล: ${provider.name})`);
  console.log(`อัปเดตอัตโนมัติตามตาราง "${CRON_SCHEDULE}" (${TIMEZONE})`);
  collect().catch((err) => console.error('[startup]', err.message));
});

cron.schedule(CRON_SCHEDULE, () => collect().catch((err) => console.error('[cron]', err.message)), { timezone: TIMEZONE });
