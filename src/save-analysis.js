// บันทึกผลวิเคราะห์ที่ทำนอกเว็บ (เช่น ให้ Claude วิเคราะห์ในแชท) ให้เป็นรูปแบบเดียวกับปุ่ม "วิเคราะห์ด้วย AI"
// ใช้: node src/save-analysis.js <productId> <result.json> [--with-sales]
import fs from 'node:fs';
import { SCHEMA, saveAnalysis } from './analyzer.js';

const [id, file] = process.argv.slice(2);
if (!id || !file) {
  console.error('ใช้: node src/save-analysis.js <productId> <result.json> [--with-sales]');
  process.exit(1);
}
const result = JSON.parse(fs.readFileSync(file, 'utf8'));

const missing = SCHEMA.required.filter((k) => result[k] == null);
if (missing.length) throw new Error(`ผลวิเคราะห์ขาดหัวข้อ: ${missing.join(', ')}`);
if (!['live', 'video', 'both'].includes(result.bestFormat)) throw new Error('bestFormat ต้องเป็น live, video หรือ both');
for (const k of ['live', 'video']) {
  if (!Number.isInteger(result[k].score) || result[k].score < 1 || result[k].score > 10) throw new Error(`${k}.score ต้องเป็น 1–10`);
}

saveAnalysis(id, {
  result,
  analyzedAt: new Date().toISOString(),
  model: 'claude',
  source: 'chat',
  usedImage: true,
  withSalesData: process.argv.includes('--with-sales'),
  costUsd: null,
});
console.log(`บันทึกผลวิเคราะห์ ${id} แล้ว`);
