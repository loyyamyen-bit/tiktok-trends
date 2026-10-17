// ผู้ให้ข้อมูลจริงผ่าน Apify — รัน actor ค้นหาสินค้า TikTok Shop ตามคีย์เวิร์ดใน config/apify.json
//
// actor ส่วนใหญ่ให้ "ยอดขายสะสม" (sold_count) ไม่ใช่ยอดรายวัน provider นี้จึงคืน soldTotal
// แล้วให้ collector คำนวณยอดรายวันจากผลต่างของแต่ละวัน
//
// ต้องตั้งค่า APIFY_TOKEN (ดูได้ที่ https://console.apify.com/settings/integrations)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, COUNTRIES } from './mockProvider.js';
import { loadLinks } from '../links.js';

// หมวดของสินค้าที่มาจากลิงก์/ร้านที่ผู้ใช้เพิ่มเอง (actor ไม่บอกหมวดตามที่เราแบ่ง)
const OTHER = { id: 'other', name: 'อื่น ๆ', icon: '🛍️' };

const CONFIG_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'config', 'apify.json');
const API_BASE = process.env.APIFY_BASE_URL || 'https://api.apify.com/v2';
const POLL_MS = Number(process.env.APIFY_POLL_MS) || 5000;
const RUN_TIMEOUT_MS = 15 * 60 * 1000;

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}

// แปลงข้อความยอดขาย เช่น "1.2K", "10K+", "1,234", "ขายแล้ว 1.2พัน" ให้เป็นตัวเลข
export function parseCount(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = String(value).replace(/,/g, '').toLowerCase();
  const m = s.match(/(\d+(?:\.\d+)?)\s*(k|m|พัน|หมื่น|แสน|ล้าน)?/);
  if (!m) return null;
  const mult = { k: 1e3, m: 1e6, 'พัน': 1e3, 'หมื่น': 1e4, 'แสน': 1e5, 'ล้าน': 1e6 }[m[2]] ?? 1;
  return Math.round(Number(m[1]) * mult);
}

// "15%", 15 หรือ 0.15 → 0.15
function parseRate(value) {
  const n = parsePrice(value);
  if (n == null) return null;
  return n > 1 ? n / 100 : n;
}

function parsePrice(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const m = String(value).replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

// รูปสินค้าอาจมาเป็น string, array ของ string หรือ array ของ { url } — เก็บไว้ไม่เกิน 6 รูป
function imageList(item) {
  const raw = item.image_urls ?? item.imageUrls ?? item.images ?? item.image ?? item.cover ?? [];
  return (Array.isArray(raw) ? raw : [raw])
    .map((x) => (typeof x === 'string' ? x : x?.url ?? x?.url_list?.[0]))
    .filter((u) => typeof u === 'string' && /^https?:\/\//.test(u))
    .slice(0, 6);
}

// รองรับชื่อฟิลด์จากหลาย actor
export function normalizeItem(item, country, category) {
  const rawId = item.product_id ?? item.productId ?? item.id;
  const soldTotal = parseCount(item.sold_count ?? item.soldCount ?? item.sold ?? item.sales);
  if (rawId == null || soldTotal == null) return null;
  const images = imageList(item);
  return {
    id: `${country}-${rawId}`,
    name: item.title ?? item.name ?? item.product_name ?? String(rawId),
    category,
    country,
    price: parsePrice(item.price ?? item.price_min ?? item.sale_price) ?? 0,
    shop: item.shop_name ?? item.seller_name ?? item.shopName ?? '',
    icon: [...CATEGORIES, OTHER].find((c) => c.id === category)?.icon ?? '🛍️',
    image: images[0] ?? null,
    images,
    url: item.product_url ?? item.url ?? item.productUrl ?? null,
    shopUrl: item.shop_url ?? item.shopUrl ?? item.seller_url ?? item.sellerUrl ?? item.shopLink ?? null,
    // ฟิลด์สำหรับ Affiliate — มีเฉพาะบาง actor ถ้าไม่มีหน้าเว็บจะซ่อนคอลัมน์นั้นเอง
    commissionRate: parseRate(item.commission_rate ?? item.commissionRate),
    soldTotal,
    creators: parseCount(item.creatorCount ?? item.creator_count),
    videos: parseCount(item.videoCount ?? item.video_count),
  };
}

// input ของ actor แต่ละตัวต่างกัน — เพิ่มตัวใหม่ได้ที่นี่
// job มี keywords (ค้นหา) หรือ productUrls / shopUrls (จากลิงก์ที่ผู้ใช้เพิ่ม)
function buildInput(actorId, country, job, maxItems) {
  if (actorId.startsWith('bovi/')) {
    return {
      ...(job.keywords ? { keywords: job.keywords } : {}),
      ...(job.productUrls ? { productUrls: job.productUrls } : {}),
      ...(job.shopUrls ? { shopUrls: job.shopUrls } : {}),
      maxResults: maxItems,
      proxyConfiguration: {
        useApifyProxy: true,
        apifyProxyGroups: ['RESIDENTIAL'],
        apifyProxyCountry: country,
        countryCode: country,
      },
    };
  }
  if (!job.keywords) return null; // actor นี้ดูสินค้าจากลิงก์ร้านไทยไม่ได้
  return { mode: 'search', region: country.toLowerCase(), search_keywords: job.keywords, max_items: maxItems };
}

async function apify(pathname, token, options = {}) {
  const res = await fetch(`${API_BASE}${pathname}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Apify ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function runActor(actorId, input, token) {
  const actorPath = encodeURIComponent(actorId.replace('/', '~'));
  const { data: run } = await apify(`/acts/${actorPath}/runs`, token, { method: 'POST', body: JSON.stringify(input) });
  const started = Date.now();
  let status = run.status;
  while (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
    if (Date.now() - started > RUN_TIMEOUT_MS) throw new Error(`Apify run ${run.id} ใช้เวลานานเกินไป`);
    await new Promise((r) => setTimeout(r, POLL_MS));
    status = (await apify(`/actor-runs/${run.id}`, token)).data.status;
  }
  if (status !== 'SUCCEEDED') throw new Error(`Apify run ${run.id} จบด้วยสถานะ ${status}`);
  return apify(`/datasets/${run.defaultDatasetId}/items?clean=true&format=json`, token);
}

// รันงานพร้อมกันไม่เกิน limit งาน
async function mapLimit(items, limit, fn) {
  const results = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export const apifyProvider = {
  name: 'apify',
  supportsBackfill: false,

  async getCatalog() {
    const codes = Object.keys(loadConfig().keywords);
    return { categories: [...CATEGORIES, OTHER], countries: COUNTRIES.filter((c) => codes.includes(c.code)), products: [] };
  },

  async fetchSnapshot() {
    const token = process.env.APIFY_TOKEN;
    if (!token) throw new Error('ยังไม่ได้ตั้งค่า APIFY_TOKEN (ใส่ในไฟล์ .env)');
    const config = loadConfig();

    // รัน actor หนึ่งครั้งต่อ (ประเทศ, หมวด) เพื่อให้รู้ว่าสินค้าแต่ละชิ้นอยู่หมวดไหน
    const jobs = Object.entries(config.keywords).flatMap(([country, byCategory]) =>
      Object.entries(byCategory).map(([category, keywords]) => ({ country, category, keywords, max: config.maxItemsPerKeyword * keywords.length })),
    );
    // ลิงก์ที่ผู้ใช้เพิ่ม — ต่อท้ายงานค้นหา เพื่อให้สินค้าที่เจอทั้งสองทางได้หมวดจากการค้นหา
    const links = loadLinks();
    const productUrls = links.filter((l) => l.type === 'product').map((l) => l.url);
    const shopUrls = links.filter((l) => l.type === 'shop').map((l) => l.url);
    if (productUrls.length) jobs.push({ country: 'TH', category: OTHER.id, productUrls, max: productUrls.length });
    if (shopUrls.length) jobs.push({ country: 'TH', category: OTHER.id, shopUrls, max: shopUrls.length * (config.maxItemsPerShop ?? 30) });

    const results = await mapLimit(jobs, config.concurrency ?? 2, async (job) => {
      const input = buildInput(config.actorId, job.country, job, job.max);
      if (!input) {
        console.warn(`[apify] ${config.actorId} ไม่รองรับการดึงจากลิงก์ ข้าม`);
        return [];
      }
      try {
        const items = await runActor(config.actorId, input, token);
        console.log(`[apify] ${job.country}/${job.category}: ได้ ${items.length} รายการ`);
        return items.map((it) => normalizeItem(it, job.country, job.category)).filter(Boolean);
      } catch (err) {
        console.error(`[apify] ${job.country}/${job.category} ล้มเหลว:`, err.message);
        return [];
      }
    });

    const byId = new Map();
    for (const p of results.flat()) if (!byId.has(p.id)) byId.set(p.id, p);
    if (!byId.size) throw new Error('Apify ไม่คืนข้อมูลสินค้าเลย (ตรวจ token, เครดิต หรือ actor)');

    const products = [...byId.values()].map(({ soldTotal, creators, videos, ...p }) => p);
    // videos ของ actor เป็นยอดสะสม จึงไม่ส่งเป็นวิดีโอใหม่รายวัน แต่ creators เป็นจำนวน ณ วันนั้นใช้ได้เลย
    const rows = [...byId.values()].map((p) => ({ productId: p.id, soldTotal: p.soldTotal, creators: p.creators ?? undefined }));
    return { products, rows };
  },
};
