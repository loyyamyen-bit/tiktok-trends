// คำนวณอันดับสินค้าสำหรับสาย Affiliate จาก data.json — ใช้ได้ทั้งในเบราว์เซอร์และ Node
//
// รูปแบบ data.series[productId] (ค่าเรียงตาม data.dates):
//   s ยอดขาย, g ยอดขาย (บาท), l ยอดขายจาก Live, d ยอดขายจากวิดีโอ,
//   c จำนวนครีเอเตอร์ที่โปรโมท, n วิดีโอใหม่, k จำนวนไลฟ์, t ยอดขายสะสมล่าสุด

const SPARK_DAYS = 14;
// ช่องทางที่ใช้นับยอดขาย
const CHANNEL_KEY = { all: 's', live: 'l', video: 'd' };

function sumRange(arr = [], end, days) {
  let total = 0;
  for (let i = Math.max(0, end - days + 1); i <= end; i++) total += arr[i] ?? 0;
  return total;
}

function growthPct(current, previous) {
  if (!previous) return current ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

// ช่วงของกระแส จากยอดขาย 7 วันล่าสุดเทียบกับ 7 วันก่อนหน้า และระดับปกติ (วันที่ 15–28 ย้อนหลัง)
//   rising  🌱 เพิ่งเริ่มขึ้น — โตแรงจากระดับปกติ เข้าตอนนี้ได้เปรียบ
//   peak    🔥 กำลังพีค     — ยอดสูงกว่าปกติมาก คนเริ่มแห่เข้ามา
//   falling 📉 เริ่มขาลง
//   steady  💤 ทรงตัว
export function trendStage(arr = [], end) {
  if (end < 27) return null; // ข้อมูลไม่พอ
  const recent = sumRange(arr, end, 7);
  const prev = sumRange(arr, end - 7, 7);
  const base = sumRange(arr, end - 14, 14) / 2;
  if (!prev || !base) return recent ? 'rising' : null;
  const g = recent / prev - 1;
  if (g > 0.2) return prev <= base * 1.2 ? 'rising' : 'peak';
  if (g < -0.15) return 'falling';
  if (recent >= base * 1.3) return 'peak';
  return 'steady';
}

function metrics(data, p, end, days, channel) {
  const sr = data.series[p.id] ?? {};
  const key = CHANNEL_KEY[channel] ?? 's';
  const totalSales = sumRange(sr.s, end, days);
  const sales = sumRange(sr[key], end, days);
  const liveSales = sumRange(sr.l, end, days);
  const videoSales = sumRange(sr.d, end, days);
  const creators = sr.c?.[end] ?? 0;
  // ไม่มี % ค่าคอมจากแหล่งข้อมูล → ใช้ค่าเริ่มต้น (ค่าประมาณ)
  const rate = p.commissionRate ?? data.defaultCommissionRate ?? null;
  const commissionPerUnit = rate != null ? p.price * rate : null;
  const videos = sumRange(sr.n, end, days);
  const lives = sumRange(sr.k, end, days);
  return {
    ...p,
    sales, // ยอดขายของช่องทางที่เลือก
    totalSales,
    gmv: sumRange(sr.g, end, days),
    liveSales,
    videoSales,
    liveShare: totalSales ? liveSales / totalSales : 0,
    videoShare: totalSales ? videoSales / totalSales : 0,
    creators,
    videos,
    lives,
    soldTotal: sr.t ?? null,
    rate,
    commissionEstimated: p.commissionRate == null,
    commissionPerUnit,
    // ค่าคอมเฉลี่ยที่ครีเอเตอร์ได้ต่อคลิป / ต่อไลฟ์ 1 ครั้ง
    earnPerVideo: commissionPerUnit != null && videos ? (videoSales / videos) * commissionPerUnit : null,
    earnPerLive: commissionPerUnit != null && lives ? (liveSales / lives) * commissionPerUnit : null,
    stage: trendStage(sr.s, end),
    // ค่าคอมที่ครีเอเตอร์ทั้งหมดได้จากช่องทางที่เลือกในช่วงนี้ — บอกว่าสินค้านี้ "ทำเงิน" ให้ Affiliate แค่ไหน
    commissionTotal: rate != null ? sales * p.price * rate : null,
    // ยอดขายต่อครีเอเตอร์ — สูง = ขายดีแต่คนโปรโมทยังน้อย (โอกาส)
    salesPerCreator: creators ? sales / creators : null,
    growth: growthPct(sales, sumRange(sr[key], end - days, days)),
  };
}

export const SORTS = {
  sales: (a, b) => b.sales - a.sales || (b.soldTotal ?? 0) - (a.soldTotal ?? 0),
  growth: (a, b) => b.growth - a.growth,
  commission: (a, b) => (b.commissionTotal ?? -1) - (a.commissionTotal ?? -1),
  opportunity: (a, b) => (b.salesPerCreator ?? -1) - (a.salesPerCreator ?? -1),
};

function rankAt(data, products, end, days, sort, channel) {
  let rows = products.map((p) => metrics(data, p, end, days, channel));
  // ตัดสินค้าที่ยอดน้อยมากออกจากมุมมองที่เป็นอัตราส่วน เพื่อไม่ให้ตัวเลขหลอกตา
  if (sort === 'growth' || sort === 'opportunity') {
    const minSales = (data.growthMinSalesPerDay ?? 5) * days;
    rows = rows.filter((r) => r.sales >= minSales);
  }
  return rows.sort(SORTS[sort] ?? SORTS.sales);
}

// ป้ายสรุปจุดเด่น — เกณฑ์ "คู่แข่งน้อย" เทียบกับสินค้าอื่นในมุมมองเดียวกัน (20% บนสุด)
function tagger(rows, data) {
  const spc = rows.map((r) => r.salesPerCreator).filter((x) => x != null).sort((a, b) => b - a);
  const spcTop = spc[Math.floor(spc.length * 0.2)] ?? Infinity;
  const minSales = (data.growthMinSalesPerDay ?? 5) * 7;
  return (r) => {
    const tags = [];
    if (r.growth >= 50 && r.sales >= minSales) tags.push('hot');
    if (!r.commissionEstimated && r.rate >= 0.2) tags.push('highCommission');
    if (r.salesPerCreator != null && r.salesPerCreator >= spcTop && r.sales >= minSales) tags.push('lowCompetition');
    if (data.has?.channels && r.liveShare >= 0.5) tags.push('live');
    if (data.has?.channels && r.videoShare >= 0.55) tags.push('video');
    return tags;
  };
}

function matches(p, q) {
  const needle = q?.trim().toLowerCase();
  return !needle || p.name.toLowerCase().includes(needle) || p.shop.toLowerCase().includes(needle);
}

export function ranking(data, { category, q, only, days = 7, sort = 'sales', channel = 'all', minCommission = 0, limit = 50 }) {
  const end = data.dates.length - 1;
  if (end < 0) return [];
  const products = data.products.filter(
    (p) =>
      (!category || p.category === category) &&
      (!minCommission || (p.commissionRate ?? data.defaultCommissionRate ?? 0) >= minCommission),
  );
  const current = rankAt(data, products, end, days, sort, channel);
  const prevRank = new Map(rankAt(data, products, end - 1, days, sort, channel).map((r, i) => [r.id, i + 1]));

  const tags = tagger(current, data);

  // ค้นหา/กรองรายการที่เก็บไว้หลังจัดอันดับ เพื่อให้อันดับที่แสดงเป็นอันดับจริงในหมวดนั้น
  return current
    .map((r, i) => ({ ...r, rank: i + 1, tags: tags(r) }))
    .filter((r) => matches(r, q) && (!only || only.has(r.id)))
    .slice(0, limit)
    .map((r) => ({
      ...r,
      prevRank: end > 0 ? prevRank.get(r.id) ?? null : r.rank,
      spark: history(data, r.id, SPARK_DAYS).map((h) => h[channel === 'live' ? 'liveSales' : channel === 'video' ? 'videoSales' : 'sales']),
    }));
}

export function history(data, productId, days = 30) {
  const sr = data.series[productId] ?? {};
  const start = Math.max(0, data.dates.length - days);
  return data.dates.slice(start).map((date, k) => {
    const i = start + k;
    return {
      date,
      sales: sr.s?.[i] ?? 0,
      gmv: sr.g?.[i] ?? 0,
      liveSales: sr.l?.[i] ?? 0,
      videoSales: sr.d?.[i] ?? 0,
      creators: sr.c?.[i] ?? 0,
      videos: sr.n?.[i] ?? 0,
      lives: sr.k?.[i] ?? 0,
    };
  });
}
