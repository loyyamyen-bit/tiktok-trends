// สร้าง data.json สำหรับหน้าเว็บจากข้อมูลใน store (ย่อเป็นอนุกรมรายสินค้า เก็บแค่ช่วงล่าสุด)
import * as store from './store.js';

// 30 วัน + ช่วงเทียบก่อนหน้า 30 วัน + กราฟรายสินค้า 60 วัน — 90 วันพอสำหรับทุกมุมมอง
const KEEP_DAYS = 90;

export function buildDataset({ provider, canRefresh }) {
  const catalog = store.getCatalog() ?? { categories: [], countries: [], products: [] };
  const dates = store.dates().slice(-KEEP_DAYS);

  const series = {};
  for (const p of catalog.products) series[p.id] = { s: [], v: [], g: [], t: null };
  dates.forEach((date, i) => {
    for (const row of store.getSnapshot(date)) {
      const sr = series[row.productId];
      if (!sr) continue;
      sr.s[i] = row.sales;
      sr.v[i] = row.views;
      sr.g[i] = row.gmv;
      if (row.soldTotal != null) sr.t = row.soldTotal;
    }
  });
  // เติมช่องว่าง (วันที่สินค้านั้นไม่อยู่ในผลค้นหา) ด้วย 0
  for (const sr of Object.values(series)) {
    for (const k of ['s', 'v', 'g']) sr[k] = Array.from({ length: dates.length }, (_, i) => sr[k][i] ?? 0);
  }

  return {
    provider,
    canRefresh,
    lastUpdated: store.lastUpdated(),
    growthMinSalesPerDay: Number(process.env.GROWTH_MIN_SALES_PER_DAY) || 5,
    categories: catalog.categories,
    countries: catalog.countries,
    products: catalog.products,
    dates,
    series,
  };
}
