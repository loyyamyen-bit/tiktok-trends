// ตัวเก็บข้อมูล — ดึง snapshot จาก provider แล้วบันทึกลง store
// เลือก provider ด้วยตัวแปร DATA_PROVIDER (mock | apify) ค่าเริ่มต้นคือ mock
import { mockProvider } from './providers/mockProvider.js';
import { apifyProvider } from './providers/apifyProvider.js';
import * as store from './store.js';

const PROVIDERS = { mock: mockProvider, apify: apifyProvider };

export const provider = PROVIDERS[process.env.DATA_PROVIDER || 'mock'];
if (!provider) {
  throw new Error(`ไม่รู้จัก DATA_PROVIDER="${process.env.DATA_PROVIDER}" (ใช้ได้: ${Object.keys(PROVIDERS).join(', ')})`);
}

export const TIMEZONE = 'Asia/Bangkok';
const BACKFILL_DAYS = 60;

export function today() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });
}

export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// แปลงยอดขายสะสม (soldTotal) เป็นยอดขายของวันนี้ โดยเทียบกับยอดสะสมล่าสุดที่เคยเห็น
// สินค้าที่เพิ่งเห็นครั้งแรกจะได้ยอดวันนี้เป็น 0 (ใช้เป็นฐานสำหรับวันถัดไป)
function toDailyRows(date, rows) {
  return rows.map((r) => {
    if (r.soldTotal == null) return r;
    const last = store.lastTotal(r.productId);
    const sales = last && last.date < date ? Math.max(0, r.soldTotal - last.soldTotal) : 0;
    if (!last || last.date < date) store.setTotal(r.productId, date, r.soldTotal);
    const price = store.getProduct(r.productId)?.price ?? 0;
    return { productId: r.productId, sales, views: r.views ?? 0, gmv: sales * price, soldTotal: r.soldTotal };
  });
}

async function collectDate(date) {
  const result = await provider.fetchSnapshot(date);
  const { products = [], rows } = Array.isArray(result) ? { rows: result } : result;
  if (products.length) store.mergeCatalog({ ...store.getCatalog(), products });
  store.saveSnapshot(date, toDailyRows(date, rows));
}

// เก็บข้อมูลของวันที่ยังขาดจนถึงวันนี้
// provider ที่ย้อนหลังได้ (mock) จะเติมย้อนหลัง BACKFILL_DAYS วัน ส่วนข้อมูลจริงเก็บได้แค่วันนี้
export async function collectMissing() {
  store.mergeCatalog(await provider.getCatalog());

  const end = today();
  const known = store.dates();
  let date = end;
  if (provider.supportsBackfill) {
    date = known.length ? addDays(known[known.length - 1], 1) : addDays(end, -(BACKFILL_DAYS - 1));
  }
  let added = 0;
  for (; date <= end; date = addDays(date, 1)) {
    if (!store.hasSnapshot(date)) {
      await collectDate(date);
      added++;
    }
  }
  console.log(`[collector] provider=${provider.name} เพิ่มข้อมูล ${added} วัน (ล่าสุด ${end})`);
  return added;
}
