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

function metrics(data, p, end, days, channel) {
  const sr = data.series[p.id] ?? {};
  const key = CHANNEL_KEY[channel] ?? 's';
  const totalSales = sumRange(sr.s, end, days);
  const sales = sumRange(sr[key], end, days);
  const liveSales = sumRange(sr.l, end, days);
  const videoSales = sumRange(sr.d, end, days);
  const creators = sr.c?.[end] ?? 0;
  const rate = p.commissionRate ?? null;
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
    videos: sumRange(sr.n, end, days),
    lives: sumRange(sr.k, end, days),
    soldTotal: sr.t ?? null,
    commissionPerUnit: rate != null ? p.price * rate : null,
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

function matches(p, q) {
  const needle = q?.trim().toLowerCase();
  return !needle || p.name.toLowerCase().includes(needle) || p.shop.toLowerCase().includes(needle);
}

export function ranking(data, { category, q, days = 7, sort = 'sales', channel = 'all', minCommission = 0, limit = 50 }) {
  const end = data.dates.length - 1;
  if (end < 0) return [];
  const products = data.products.filter(
    (p) => (!category || p.category === category) && (!minCommission || (p.commissionRate ?? 0) >= minCommission),
  );
  const current = rankAt(data, products, end, days, sort, channel);
  const prevRank = new Map(rankAt(data, products, end - 1, days, sort, channel).map((r, i) => [r.id, i + 1]));

  // ค้นหาหลังจัดอันดับ เพื่อให้อันดับที่แสดงเป็นอันดับจริงในหมวดนั้น
  return current
    .map((r, i) => ({ ...r, rank: i + 1 }))
    .filter((r) => matches(r, q))
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
