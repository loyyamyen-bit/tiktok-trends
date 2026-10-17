// คำนวณอันดับสินค้าและแนวโน้มจาก data.json — ใช้ได้ทั้งในเบราว์เซอร์และ Node
//
// รูปแบบ data:
//   { dates: ['YYYY-MM-DD', ...], products: [...], growthMinSalesPerDay,
//     series: { [productId]: { s: [ยอดขาย], v: [ยอดวิว], g: [ยอดขายบาท], t: ยอดขายสะสมล่าสุด | null } } }
//   ค่าใน s/v/g เรียงตาม dates

const SPARK_DAYS = 14;
const EMPTY = { s: [], v: [], g: [], t: null };

function sumRange(arr, end, days) {
  let total = 0;
  for (let i = Math.max(0, end - days + 1); i <= end; i++) total += arr[i] ?? 0;
  return total;
}

function growthPct(current, previous) {
  if (!previous) return current ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

// จัดอันดับสินค้า ณ ตำแหน่งวันที่ end
function rankAt(data, products, end, days, sort) {
  const rows = products.map((p) => {
    const sr = data.series[p.id] ?? EMPTY;
    const sales = sumRange(sr.s, end, days);
    return {
      ...p,
      sales,
      views: sumRange(sr.v, end, days),
      gmv: sumRange(sr.g, end, days),
      soldTotal: sr.t ?? null,
      growth: growthPct(sales, sumRange(sr.s, end - days, days)),
    };
  });
  // "มาแรง" เรียงตามการเติบโต แต่ตัดสินค้าที่ยอดน้อยมากออกเพื่อไม่ให้ % หลอกตา
  if (sort === 'growth') {
    const minSales = (data.growthMinSalesPerDay ?? 5) * days;
    return rows.filter((r) => r.sales >= minSales).sort((a, b) => b.growth - a.growth);
  }
  // ยอดเท่ากัน (เช่น วันแรกของข้อมูลจริงที่ยังไม่มียอดรายวัน) ให้ใช้ยอดขายสะสมตัดสิน
  return rows.sort((a, b) => b.sales - a.sales || (b.soldTotal ?? 0) - (a.soldTotal ?? 0));
}

function matches(p, q) {
  const needle = q?.trim().toLowerCase();
  return !needle || p.name.toLowerCase().includes(needle) || p.shop.toLowerCase().includes(needle);
}

export function ranking(data, { country, category, q, days = 7, sort = 'sales', limit = 50 }) {
  const end = data.dates.length - 1;
  if (end < 0) return [];
  const products = data.products.filter(
    (p) => (!country || p.country === country) && (!category || p.category === category),
  );
  const current = rankAt(data, products, end, days, sort);
  const prevRank = new Map(rankAt(data, products, end - 1, days, sort).map((r, i) => [r.id, i + 1]));

  // ค้นหาหลังจัดอันดับ เพื่อให้อันดับที่แสดงเป็นอันดับจริงในประเทศ/หมวดนั้น
  return current
    .map((r, i) => ({ ...r, rank: i + 1 }))
    .filter((r) => matches(r, q))
    .slice(0, limit)
    .map((r) => ({
      ...r,
      prevRank: end > 0 ? prevRank.get(r.id) ?? null : r.rank,
      spark: history(data, r.id, SPARK_DAYS).map((h) => h.sales),
    }));
}

export function history(data, productId, days = 30) {
  const sr = data.series[productId] ?? EMPTY;
  const start = Math.max(0, data.dates.length - days);
  return data.dates.slice(start).map((date, k) => {
    const i = start + k;
    return { date, sales: sr.s[i] ?? 0, views: sr.v[i] ?? 0, gmv: sr.g[i] ?? 0 };
  });
}
