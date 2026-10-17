// ที่เก็บข้อมูลแบบไฟล์ JSON — เก็บแคตตาล็อกสินค้าและ snapshot ยอดขายรายวัน
// แยกไฟล์ตาม provider (data/store-mock.json, data/store-apify.json) เพื่อไม่ให้ข้อมูลปนกัน
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ตั้ง DATA_DIR ให้ชี้ไปที่ disk ถาวรเมื่อ deploy (เช่น /data) เพื่อไม่ให้ข้อมูลหายตอน deploy ใหม่
const DATA_DIR = process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

let dataFile;
let state;

function emptyState() {
  // totals: ยอดขายสะสมล่าสุดที่เห็นของแต่ละสินค้า { [productId]: { date, soldTotal } }
  return { catalog: null, snapshots: {}, totals: {}, lastUpdated: null };
}

export function load(providerName) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  dataFile = path.join(DATA_DIR, `store-${providerName}.json`);
  state = fs.existsSync(dataFile) ? { ...emptyState(), ...JSON.parse(fs.readFileSync(dataFile, 'utf8')) } : emptyState();
}

function save() {
  const tmp = `${dataFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, dataFile);
}

// ตั้งหมวดหมู่/ประเทศ และรวมรายการสินค้าเข้ากับที่มีอยู่ (สินค้าใหม่ถูกเพิ่ม สินค้าเดิมถูกอัปเดต)
export function mergeCatalog({ categories, countries, products = [] }) {
  const existing = new Map((state.catalog?.products ?? []).map((p) => [p.id, p]));
  for (const p of products) existing.set(p.id, { ...existing.get(p.id), ...p });
  state.catalog = { categories, countries, products: [...existing.values()] };
  save();
}

export function getCatalog() {
  return state.catalog;
}

export function getProduct(id) {
  return state.catalog?.products.find((p) => p.id === id);
}

export function hasSnapshot(date) {
  return Boolean(state.snapshots[date]);
}

export function saveSnapshot(date, rows) {
  state.snapshots[date] = rows;
  state.lastUpdated = new Date().toISOString();
  save();
}

// วันที่ทั้งหมดเรียงจากเก่าไปใหม่
export function dates() {
  return Object.keys(state.snapshots).sort();
}

export function getSnapshot(date) {
  return state.snapshots[date] || [];
}

export function lastTotal(productId) {
  return state.totals[productId];
}

export function setTotal(productId, date, soldTotal) {
  state.totals[productId] = { date, soldTotal };
}

export function lastUpdated() {
  return state.lastUpdated;
}
