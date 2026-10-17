// สร้าง data.json สำหรับหน้าเว็บจากข้อมูลใน store (ย่อเป็นอนุกรมรายสินค้า เก็บแค่ช่วงล่าสุด)
import * as store from './store.js';

// 30 วัน + ช่วงเทียบก่อนหน้า 30 วัน + กราฟรายสินค้า 60 วัน — 90 วันพอสำหรับทุกมุมมอง
const KEEP_DAYS = 90;

// ฟิลด์รายวันใน snapshot → ชื่อย่อใน data.json
const FIELDS = { sales: 's', gmv: 'g', liveSales: 'l', videoSales: 'd', creators: 'c', videos: 'n', lives: 'k' };

export function buildDataset({ provider, canRefresh }) {
  const catalog = store.getCatalog() ?? { categories: [], countries: [], products: [] };
  const dates = store.dates().slice(-KEEP_DAYS);
  // แหล่งข้อมูลแต่ละแบบมีฟิลด์ไม่เท่ากัน — บอกหน้าเว็บว่ามีอะไรบ้างเพื่อซ่อนคอลัมน์ที่ไม่มีข้อมูล
  const seen = new Set();

  const series = {};
  for (const p of catalog.products) {
    series[p.id] = { t: null };
    for (const k of Object.values(FIELDS)) series[p.id][k] = new Array(dates.length).fill(0);
  }
  dates.forEach((date, i) => {
    for (const row of store.getSnapshot(date)) {
      const sr = series[row.productId];
      if (!sr) continue;
      for (const [field, k] of Object.entries(FIELDS)) {
        if (row[field] != null) {
          sr[k][i] = row[field];
          seen.add(field);
        }
      }
      if (row.soldTotal != null) sr.t = row.soldTotal;
    }
  });

  return {
    provider,
    canRefresh,
    lastUpdated: store.lastUpdated(),
    growthMinSalesPerDay: Number(process.env.GROWTH_MIN_SALES_PER_DAY) || 5,
    has: {
      channels: seen.has('liveSales') && seen.has('videoSales'),
      creators: seen.has('creators'),
      videos: seen.has('videos'),
      lives: seen.has('lives'),
      commission: catalog.products.some((p) => p.commissionRate != null),
      soldTotal: Object.values(series).some((sr) => sr.t != null),
    },
    categories: catalog.categories,
    products: catalog.products,
    dates,
    series,
  };
}
