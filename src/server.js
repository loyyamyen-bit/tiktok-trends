// เซิร์ฟเวอร์สำหรับรันในเครื่อง — เสิร์ฟหน้าเว็บ + data.json สด, ปุ่มรีเฟรช และ cron ดึงข้อมูลรายวัน
// (บน GitHub Pages ไม่ใช้ไฟล์นี้ แต่ใช้ GitHub Actions + src/build.js แทน)
import express from 'express';
import cron from 'node-cron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './store.js';
import { collectMissing, provider, TIMEZONE } from './collector.js';
import { buildDataset } from './dataset.js';
import { addLink, removeLink } from './links.js';

const PORT = Number(process.env.PORT) || 3000;
// ค่าเริ่มต้น: ดึงข้อมูลทุกวันเวลา 06:00 น. (เวลาไทย)
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 6 * * *';
// ช่วงพักขั้นต่ำระหว่างการกดรีเฟรช — กันการกดรัวจนเสียค่า Apify
const REFRESH_COOLDOWN_MS = (Number(process.env.REFRESH_COOLDOWN_MINUTES) || 10) * 60 * 1000;

const app = express();

app.get('/data.json', (req, res) => {
  res.json(buildDataset({ provider: provider.name, canRefresh: true }));
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

app.delete('/api/links/:id', (req, res) => {
  res.json({ removed: removeLink(req.params.id) });
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
