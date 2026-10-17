// สร้าง data.json สำหรับหน้าเว็บจากข้อมูลใน store (ย่อเป็นอนุกรมรายสินค้า เก็บแค่ช่วงล่าสุด)
import * as store from './store.js';
import { loadLinks } from './links.js';
import { loadAnalyses } from './analyzer.js';

// 30 วัน + ช่วงเทียบก่อนหน้า 30 วัน + กราฟรายสินค้า 60 วัน — 90 วันพอสำหรับทุกมุมมอง
const KEEP_DAYS = 90;

// ฟิลด์รายวันใน snapshot → ชื่อย่อใน data.json
const FIELDS = { sales: 's', gmv: 'g', liveSales: 'l', videoSales: 'd', creators: 'c', videos: 'n', lives: 'k' };

const OTHER = { id: 'other', name: 'อื่น ๆ', icon: '🛍️' };

// สินค้าจากลิงก์ที่ผู้ใช้กรอกข้อมูลเอง → เพิ่มเป็นสินค้าในตารางอันดับ (หรือเติมข้อมูลให้สินค้าที่มีอยู่แล้ว)
function mergeManualProducts(catalogProducts, links, dates, series, seen) {
  const products = catalogProducts.map((p) => ({ ...p }));
  const byId = new Map(products.map((p) => [p.id, p]));
  const dateIndex = new Map(dates.map((d, i) => [d, i]));

  for (const link of links) {
    const m = link.manual;
    if (link.type !== 'product' || !m) continue;
    let p = byId.get(link.id);
    if (!p) {
      p = { id: link.id, name: link.name, category: m.category || OTHER.id, country: 'TH', price: 0, shop: '', icon: OTHER.icon, image: link.image, images: link.image ? [link.image] : [], url: link.url };
      products.push(p);
      byId.set(p.id, p);
      series[p.id] = { t: null };
      for (const k of Object.values(FIELDS)) series[p.id][k] = new Array(dates.length).fill(0);
    }
    p.manual = true;
    if (m.category) p.category = m.category;
    if (m.price != null) p.price = m.price;
    if (m.shop) p.shop = m.shop;
    if (m.commissionRate != null) p.commissionRate = m.commissionRate;

    // ยอดขายรายวัน = ยอดสะสมที่เพิ่มขึ้นระหว่างการกรอกแต่ละครั้ง (ลงไว้ที่วันที่กรอกครั้งหลัง)
    const entries = m.entries ?? [];
    const sr = series[p.id];
    entries.forEach((e, k) => {
      if (k > 0) {
        const i = dateIndex.get(e.date);
        const delta = Math.max(0, e.soldTotal - entries[k - 1].soldTotal);
        if (i != null) {
          sr.s[i] += delta;
          sr.g[i] += delta * (p.price || 0);
          seen.add('sales');
        }
      }
    });
    if (entries.length) sr.t = entries[entries.length - 1].soldTotal;
  }
  return products;
}

export function buildDataset({ provider, canRefresh, canAnalyze = false }) {
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

  const links = loadLinks();
  const products = mergeManualProducts(catalog.products, links, dates, series, seen);
  const categories = products.some((p) => p.category === OTHER.id) && !catalog.categories.some((c) => c.id === OTHER.id)
    ? [...catalog.categories, OTHER]
    : catalog.categories;

  return {
    provider,
    canRefresh,
    canAnalyze,
    lastUpdated: store.lastUpdated(),
    growthMinSalesPerDay: Number(process.env.GROWTH_MIN_SALES_PER_DAY) || 5,
    // ค่าคอมที่ใช้ประมาณเมื่อแหล่งข้อมูลไม่มี % ค่าคอมของสินค้านั้น (0.10 = 10%)
    defaultCommissionRate: Number(process.env.DEFAULT_COMMISSION_RATE ?? 0.1) || null,
    has: {
      channels: seen.has('liveSales') && seen.has('videoSales'),
      creators: seen.has('creators'),
      videos: seen.has('videos'),
      lives: seen.has('lives'),
      commission: products.some((p) => p.commissionRate != null) || Boolean(Number(process.env.DEFAULT_COMMISSION_RATE ?? 0.1)),
      realCommission: products.some((p) => p.commissionRate != null),
      soldTotal: Object.values(series).some((sr) => sr.t != null),
    },
    categories,
    products,
    // สินค้า/ร้านที่ผู้ใช้เพิ่มจากลิงก์ (แสดงเป็นการ์ดรูป แม้ยังไม่มียอดขาย)
    links,
    // ผลวิเคราะห์ AI ที่เคยทำไว้ { [productId]: { result, analyzedAt, ... } }
    analyses: loadAnalyses(),
    dates,
    series,
  };
}
