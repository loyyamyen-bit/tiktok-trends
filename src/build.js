// สร้างเว็บแบบ static ไว้ที่ dist/ (หน้าเว็บ + data.json) สำหรับ GitHub Pages
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './store.js';
import { provider } from './collector.js';
import { buildDataset } from './dataset.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

store.load(provider.name);
fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(path.join(root, 'public'), dist, { recursive: true });
const data = buildDataset({ provider: provider.name, canRefresh: false });
fs.writeFileSync(path.join(dist, 'data.json'), JSON.stringify(data));
console.log(`[build] dist/ พร้อมแล้ว: สินค้า ${data.products.length} รายการ, ${data.dates.length} วัน`);
