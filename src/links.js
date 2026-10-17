// สินค้า/ร้านที่ผู้ใช้เพิ่มเองจากลิงก์ TikTok Shop (เก็บใน DATA_DIR/links.json)
//
// ลิงก์แชร์จากแอป (vt.tiktok.com/...) จะ redirect ไปหน้าสินค้า โดยใน URL มี og_info (ชื่อ + รูป) ติดมา
// เราอ่านแค่ URL ปลายทาง ไม่โหลดหน้าสินค้า (หน้าสินค้าติด captcha) และตัดพารามิเตอร์ติดตาม/ข้อมูลบัญชีทิ้ง
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const LINKS_FILE = path.join(DATA_DIR, 'links.json');

// โฮสต์ที่ยอมให้ตามลิงก์ — กันไม่ให้ใช้ฟีเจอร์นี้ยิงไปที่อื่น
const ALLOWED_HOSTS = new Set(['vt.tiktok.com', 'vm.tiktok.com', 'www.tiktok.com', 'tiktok.com', 'm.tiktok.com', 'shop.tiktok.com']);
const MAX_REDIRECTS = 4;

export function loadLinks() {
  try {
    return JSON.parse(fs.readFileSync(LINKS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveLinks(links) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LINKS_FILE, `${JSON.stringify(links, null, 2)}\n`);
}

function checkHost(url) {
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error('รองรับเฉพาะลิงก์ TikTok Shop (tiktok.com)');
  }
}

// ตามลิงก์ย่อทีละขั้นจนถึงหน้าสินค้า/ร้าน โดยไม่โหลดเนื้อหาหน้าปลายทาง
async function resolveUrl(input) {
  let url = new URL(input.trim());
  checkHost(url);
  for (let i = 0; i < MAX_REDIRECTS; i++) {
    if (/\/(pdp|product|store)\//.test(url.pathname)) return url;
    const res = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(10000) });
    const location = res.headers.get('location');
    if (!location) break;
    url = new URL(location, url);
    checkHost(url);
  }
  return url;
}

// รูปจาก og_info เป็นขนาด 260px — ขอขนาด 600px เพื่อให้ดูชัดบนการ์ด
function largerImage(src) {
  return src?.replace(/resize-webp:\d+:\d+/, 'resize-webp:600:600') ?? null;
}

export function parseShopUrl(url) {
  let og = {};
  try {
    og = JSON.parse(url.searchParams.get('og_info') ?? '{}');
  } catch {
    // ไม่มีหรืออ่านไม่ได้ — ใช้แค่ id
  }
  const region = (url.pathname.match(/^\/(?:shop\/)?([a-z]{2})\//)?.[1] ?? url.searchParams.get('share_region') ?? '').toUpperCase();
  const productId = url.pathname.match(/\/(?:pdp|product)\/(?:[^/]+\/)?(\d{8,})/)?.[1];
  const storeId = url.pathname.match(/\/store\/(?:[^/]+\/)?(\d{8,})/)?.[1];
  if (productId) {
    return {
      type: 'product',
      id: `TH-${productId}`,
      productId,
      region,
      name: og.title || `สินค้า ${productId}`,
      image: largerImage(og.image),
      url: `https://shop.tiktok.com/${region.toLowerCase() || 'th'}/pdp/${productId}`,
    };
  }
  if (storeId) {
    return {
      type: 'shop',
      id: `shop-${storeId}`,
      storeId,
      region,
      name: og.title || `ร้าน ${storeId}`,
      image: largerImage(og.image),
      url: `${url.origin}${url.pathname}`,
    };
  }
  return null;
}

export async function addLink(input) {
  let url;
  try {
    url = await resolveUrl(input);
  } catch (err) {
    if (err instanceof TypeError) throw new Error('ลิงก์ไม่ถูกต้อง');
    throw err;
  }
  const item = parseShopUrl(url);
  if (!item) throw new Error('ไม่พบสินค้าหรือร้านในลิงก์นี้');
  if (item.region && item.region !== 'TH') throw new Error('รองรับเฉพาะร้านไทย (ลิงก์นี้เป็นร้านต่างประเทศ)');

  const links = loadLinks();
  const existing = links.find((l) => l.id === item.id);
  if (existing) return { item: existing, added: false };
  const saved = { ...item, addedAt: new Date().toISOString() };
  links.unshift(saved);
  saveLinks(links);
  console.log(`[links] เพิ่ม ${saved.id} (${saved.name.slice(0, 40)})`);
  return { item: saved, added: true };
}

export function removeLink(id) {
  const links = loadLinks();
  const next = links.filter((l) => l.id !== id);
  saveLinks(next);
  console.log(`[links] ลบ ${id}`);
  return links.length !== next.length;
}

// ข้อมูลที่ผู้ใช้กรอกเองจากแอป (ฟรี ไม่ต้องใช้ Apify)
//   manual: { price, commissionRate, shop, category, entries: [{ date, soldTotal }] }
// กรอก "ขายแล้ว X ชิ้น" ซ้ำในวันถัดไป → ระบบคำนวณยอดขายรายวันจากผลต่าง
export function updateManual(id, input, date) {
  const links = loadLinks();
  const link = links.find((l) => l.id === id);
  if (!link) throw new Error('ไม่พบลิงก์');
  const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const manual = link.manual ?? { entries: [] };

  const price = num(input.price);
  const rate = num(input.commissionPercent);
  const sold = num(input.soldTotal);
  if (price != null && price < 0) throw new Error('ราคาต้องไม่ติดลบ');
  if (rate != null && (rate < 0 || rate > 100)) throw new Error('% ค่าคอมต้องอยู่ระหว่าง 0–100');
  if (sold != null && sold < 0) throw new Error('ยอดขายต้องไม่ติดลบ');

  manual.price = price;
  manual.commissionRate = rate != null ? rate / 100 : null;
  manual.shop = typeof input.shop === 'string' ? input.shop.trim().slice(0, 80) : manual.shop ?? '';
  manual.category = typeof input.category === 'string' && input.category ? input.category : manual.category ?? 'other';
  if (sold != null) {
    // กรอกซ้ำในวันเดียวกัน → ใช้ค่าล่าสุดของวันนั้น
    manual.entries = [...manual.entries.filter((e) => e.date !== date), { date, soldTotal: Math.round(sold) }]
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  link.manual = manual;
  saveLinks(links);
  console.log(`[links] กรอกข้อมูล ${id}`);
  return link;
}
