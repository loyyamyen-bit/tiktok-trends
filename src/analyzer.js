// วิเคราะห์สินค้าสำหรับทำ Affiliate ด้วย Claude — อ่านรูป ชื่อ และตัวเลขยอดขาย (ถ้ามี)
// ผลลัพธ์เก็บไว้ที่ DATA_DIR/analyses.json เพื่อเปิดดูซ้ำได้โดยไม่ต้องเรียก API ใหม่
//
// ต้องตั้งค่า ANTHROPIC_API_KEY (สร้างได้ที่ https://console.anthropic.com)
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const ANALYSES_FILE = path.join(DATA_DIR, 'analyses.json');
const MODEL = 'claude-opus-5-5';
// ราคา Claude Opus 5.5 (USD ต่อ 1 ล้าน token) — ใช้ประมาณค่าใช้จ่ายต่อครั้ง
const PRICE_PER_MTOK = { input: 4, output: 20 };
// โหลดรูปจาก CDN ของ TikTok เท่านั้น
const IMAGE_HOST = /(^|\.)(ibyteimg\.com|tiktokcdn\.com|tiktokcdn-us\.com|byteimg\.com)$/;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'bestFormat', 'live', 'video', 'targetAudience', 'sellingPoints', 'hooks', 'contentIdeas', 'liveOutline', 'cautions', 'checklist', 'dataNote'],
  properties: {
    summary: { type: 'string', description: 'สรุปภาพรวม 1-2 ประโยค ว่าควรรับสินค้านี้ไปทำไหม และทำแบบไหน' },
    bestFormat: { type: 'string', enum: ['live', 'video', 'both'] },
    live: {
      type: 'object',
      additionalProperties: false,
      required: ['score', 'reason'],
      properties: {
        score: { type: 'integer', description: 'ความเหมาะกับการไลฟ์ 1-10' },
        reason: { type: 'string' },
      },
    },
    video: {
      type: 'object',
      additionalProperties: false,
      required: ['score', 'reason'],
      properties: {
        score: { type: 'integer', description: 'ความเหมาะกับการทำคลิปสั้น 1-10' },
        reason: { type: 'string' },
      },
    },
    targetAudience: { type: 'array', items: { type: 'string' } },
    sellingPoints: { type: 'array', items: { type: 'string' } },
    hooks: { type: 'array', items: { type: 'string' }, description: 'ประโยคเปิดคลิป 3 วินาทีแรก 3 แบบ' },
    contentIdeas: { type: 'array', items: { type: 'string' } },
    liveOutline: { type: 'array', items: { type: 'string' }, description: 'ลำดับการไลฟ์ขายสั้น ๆ ทีละขั้น' },
    cautions: { type: 'array', items: { type: 'string' }, description: 'ข้อควรระวัง เช่น การกล่าวอ้างเกินจริง กฎ อย. นโยบาย TikTok ของปลอม' },
    checklist: { type: 'array', items: { type: 'string' }, description: 'สิ่งที่ควรเช็กก่อนรับสินค้าไปทำ' },
    dataNote: { type: 'string', description: 'ความเห็นต่อตัวเลขยอดขาย/ราคา/ค่าคอมที่ให้มา หรือบอกว่าไม่มีข้อมูลพอ' },
  },
};

const SYSTEM = `คุณเป็นที่ปรึกษาด้าน TikTok Shop Affiliate ในประเทศไทย ช่วยครีเอเตอร์ตัดสินใจว่าจะรับสินค้าไปทำ Live หรือคลิปสั้นหรือไม่ และทำอย่างไร
ตอบเป็นภาษาไทยที่กระชับ อ่านง่าย ใช้ภาษาแบบที่ครีเอเตอร์ไทยใช้จริง
- ประเมินจากสิ่งที่เห็นในรูปและชื่อสินค้า และตัวเลขที่ให้มาเท่านั้น ถ้าข้อมูลไม่พอให้บอกตรง ๆ อย่าเดาตัวเลข
- คะแนน 1-10: ไลฟ์เหมาะกับสินค้าที่สาธิตได้ ตอบคำถามได้ เล่นโปรได้ คลิปเหมาะกับสินค้าที่เห็นผลเป็นภาพ มีมุมเล่าเรื่อง หรือ hook แรง
- Hook ต้องเป็นประโยคพูดได้จริงใน 3 วินาทีแรก
- ข้อควรระวัง: ชี้การกล่าวอ้างที่เสี่ยงผิดกฎโฆษณาเครื่องสำอาง/อาหารเสริมของไทยหรือนโยบาย TikTok, ความเสี่ยงของปลอม, ผลลัพธ์ที่ไม่ควรรับประกัน
- อย่าแนะนำให้ทำภาพก่อน/หลังปลอมหรือกล่าวอ้างเกินจริง`;

export function loadAnalyses() {
  try {
    return JSON.parse(fs.readFileSync(ANALYSES_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveAnalysis(id, record) {
  const all = loadAnalyses();
  all[id] = record;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(ANALYSES_FILE, `${JSON.stringify(all, null, 2)}\n`);
}

// ดาวน์โหลดรูปแล้วส่งเป็น base64 — ไม่ต้องพึ่งให้ API ไปโหลดจาก CDN เอง
async function imageBlock(src) {
  if (!src) return null;
  try {
    const url = new URL(src);
    if (url.protocol !== 'https:' || !IMAGE_HOST.test(url.hostname)) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const type = res.headers.get('content-type')?.split(';')[0];
    if (!res.ok || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(type)) return null;
    const data = Buffer.from(await res.arrayBuffer()).toString('base64');
    return { type: 'image', source: { type: 'base64', media_type: type, data } };
  } catch {
    return null;
  }
}

function describe(product, m) {
  const lines = [`ชื่อสินค้า: ${product.name}`];
  if (product.shop) lines.push(`ร้าน: ${product.shop}`);
  if (product.price) lines.push(`ราคา: ${product.price} บาท`);
  if (m) {
    lines.push(`ยอดขาย 7 วันล่าสุด: ${m.totalSales} ชิ้น (เติบโต ${m.growth.toFixed(0)}% จาก 7 วันก่อน)`);
    if (m.rate != null) lines.push(`ค่าคอม: ${(m.rate * 100).toFixed(0)}%${m.commissionEstimated ? ' (ค่าประมาณ ไม่ใช่ข้อมูลจริง)' : ''}`);
    if (m.creators) lines.push(`ครีเอเตอร์ที่โปรโมท: ${m.creators} คน`);
    if (m.liveShare || m.videoShare) lines.push(`สัดส่วนยอดขาย: Live ${(m.liveShare * 100).toFixed(0)}% วิดีโอ ${(m.videoShare * 100).toFixed(0)}%`);
    if (m.stage) lines.push(`ช่วงกระแส: ${m.stage}`);
  } else {
    lines.push('ยังไม่มีข้อมูลยอดขาย');
  }
  return lines.join('\n');
}

export async function analyzeProduct(product, metrics) {
  const image = await imageBlock(product.image);
  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    // ถ้าโมเดลหลักปฏิเสธคำขอ ให้ API ลองโมเดลสำรองที่ Anthropic แนะนำให้อัตโนมัติ
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [
      {
        role: 'user',
        content: [
          ...(image ? [image] : []),
          {
            type: 'text',
            text: `วิเคราะห์สินค้านี้สำหรับทำ Affiliate บน TikTok Shop ไทย${image ? '' : ' (ไม่มีรูป ประเมินจากชื่อ)'}\n\n${describe(product, metrics)}`,
          },
        ],
      },
    ],
  });

  if (response.stop_reason === 'refusal') throw new Error('AI ไม่สามารถวิเคราะห์สินค้านี้ได้');
  if (response.stop_reason === 'max_tokens') throw new Error('ผลวิเคราะห์ยาวเกินกำหนด ลองใหม่อีกครั้ง');
  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('ไม่ได้รับผลวิเคราะห์จาก AI');
  const result = JSON.parse(text);
  for (const k of ['live', 'video']) result[k].score = Math.min(10, Math.max(1, Math.round(result[k].score)));

  const { input_tokens = 0, output_tokens = 0, cache_read_input_tokens = 0, cache_creation_input_tokens = 0 } = response.usage ?? {};
  const costUsd = ((input_tokens + cache_read_input_tokens + cache_creation_input_tokens) * PRICE_PER_MTOK.input + output_tokens * PRICE_PER_MTOK.output) / 1e6;
  const record = {
    result,
    analyzedAt: new Date().toISOString(),
    model: response.model,
    usedImage: Boolean(image),
    withSalesData: Boolean(metrics),
    usage: { input_tokens, output_tokens },
    costUsd: Math.round(costUsd * 10000) / 10000,
  };
  saveAnalysis(product.id, record);
  console.log(`[analyze] ${product.id} เสร็จ (${input_tokens}+${output_tokens} tokens ≈ $${record.costUsd})`);
  return record;
}
