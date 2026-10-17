// ผู้ให้ข้อมูลจำลอง (mock) — สร้างข้อมูลสินค้าและยอดขายรายวันแบบกำหนดได้ (deterministic)
// วันเดียวกันจะได้ตัวเลขเดิมเสมอ ทำให้ย้อนเติมข้อมูลย้อนหลังได้สม่ำเสมอ
//
// ทุก provider ต้องมี:
//   name: string
//   supportsBackfill: boolean   (ขอข้อมูลของวันในอดีตได้หรือไม่)
//   getCatalog(): Promise<{ categories, countries, products }>
//   fetchSnapshot(date): Promise<rows | { products, rows }>
//     rows: Array<{ productId, sales, views, gmv }> หรือ { productId, soldTotal } ถ้ามีแต่ยอดขายสะสม

export const COUNTRIES = [
  { code: 'TH', name: 'ไทย' },
  { code: 'VN', name: 'เวียดนาม' },
  { code: 'ID', name: 'อินโดนีเซีย' },
  { code: 'MY', name: 'มาเลเซีย' },
  { code: 'PH', name: 'ฟิลิปปินส์' },
];

export const CATEGORIES = [
  { id: 'beauty', name: 'ความงาม', icon: '💄' },
  { id: 'women', name: 'แฟชั่นผู้หญิง', icon: '👗' },
  { id: 'men', name: 'แฟชั่นผู้ชาย', icon: '👕' },
  { id: 'food', name: 'อาหารและเครื่องดื่ม', icon: '🍜' },
  { id: 'home', name: 'บ้านและสวน', icon: '🏠' },
  { id: 'electronics', name: 'อิเล็กทรอนิกส์', icon: '🎧' },
  { id: 'health', name: 'สุขภาพ', icon: '💊' },
  { id: 'baby', name: 'แม่และเด็ก', icon: '🍼' },
];

const TEMPLATES = {
  beauty: [
    ['เซรั่มวิตามินซี หน้าใส', 290],
    ['ลิปทินท์ เนื้อแมตต์ ติดทน', 159],
    ['ครีมกันแดด SPF50+ PA++++', 349],
    ['คุชชั่น ปกปิดดี คุมมัน', 399],
    ['มาส์กหน้า ไฮยาลูรอน (10 แผ่น)', 199],
  ],
  women: [
    ['เดรสยาวลายดอก ผ้าชีฟอง', 450],
    ['กางเกงขากว้าง เอวสูง', 329],
    ['เสื้อครอปไหมพรม', 259],
    ['กระเป๋าสะพายข้าง มินิมอล', 590],
    ['รองเท้าผ้าใบ พื้นหนา', 690],
  ],
  men: [
    ['เสื้อโปโล ผ้าคอตตอน', 299],
    ['กางเกงคาร์โก้ ทรงหลวม', 459],
    ['เสื้อเชิ้ตลินิน แขนสั้น', 389],
    ['หมวกแก๊ป ปักโลโก้', 199],
    ['กระเป๋าสตางค์หนังแท้', 490],
  ],
  food: [
    ['หมาล่าแห้ง รสเผ็ดจัด', 89],
    ['กาแฟสำเร็จรูป 3in1 (30 ซอง)', 159],
    ['ขนมเปี๊ยะไส้ทะลัก', 120],
    ['น้ำพริกเผาสูตรโบราณ', 99],
    ['ชาไทยผง ชงง่าย', 139],
  ],
  home: [
    ['ไม้ถูพื้นหมุนได้ 360°', 390],
    ['กล่องเก็บของพับได้', 149],
    ['ผ้าปูที่นอน เย็นสบาย', 590],
    ['เครื่องทำความชื้น อโรมา', 450],
    ['ชั้นวางของ ติดผนัง', 259],
  ],
  electronics: [
    ['หูฟังบลูทูธ ตัดเสียงรบกวน', 890],
    ['พาวเวอร์แบงก์ 20000mAh', 590],
    ['พัดลมพกพา ชาร์จ USB', 259],
    ['ขาตั้งมือถือ ไลฟ์สด', 199],
    ['ไฟริงไลต์ LED 10 นิ้ว', 350],
  ],
  health: [
    ['คอลลาเจนผง ชงดื่ม', 590],
    ['วิตามินรวม (60 เม็ด)', 450],
    ['ปืนนวดกล้ามเนื้อ', 990],
    ['โปรตีนเวย์ รสช็อกโกแลต', 1290],
    ['ไฟเบอร์ ดีท็อกซ์', 390],
  ],
  baby: [
    ['ผ้าอ้อมสำเร็จรูป ไซซ์ L', 459],
    ['ขวดนมคอกว้าง กันโคลิก', 320],
    ['ทิชชู่เปียก สูตรอ่อนโยน', 129],
    ['ของเล่นเสริมพัฒนาการ', 390],
    ['เป้อุ้มเด็ก ระบายอากาศ', 890],
  ],
};

const SHOP_PREFIX = ['Shop', 'Store', 'Official', 'Mall', 'House'];
const SHOP_NAME = ['Lala', 'Mimi', 'Nara', 'Sunny', 'Kiko', 'Bloom', 'Momo', 'Pura', 'Zen', 'Joy'];

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// สุ่มตัวเลข 0–1 แบบกำหนดได้จาก seed
function rand(seed) {
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function buildProducts() {
  const products = [];
  for (const country of COUNTRIES) {
    for (const category of CATEGORIES) {
      TEMPLATES[category.id].forEach(([name, price], i) => {
        const id = `${country.code}-${category.id}-${i}`;
        const h = hashString(id);
        products.push({
          id,
          name,
          category: category.id,
          country: country.code,
          price: Math.round(price * (0.85 + rand(h) * 0.3)),
          shop: `${SHOP_NAME[h % SHOP_NAME.length]} ${SHOP_PREFIX[(h >>> 4) % SHOP_PREFIX.length]}`,
          icon: category.icon,
          // พารามิเตอร์รูปแบบแนวโน้ม (ใช้ภายใน provider เท่านั้น)
          _trend: {
            base: 50 + Math.floor(rand(h + 1) * 900),
            amp: 0.2 + rand(h + 2) * 0.6, // ความแรงของคลื่นขึ้น-ลง
            period: 40 + Math.floor(rand(h + 3) * 80), // วัน
            offset: Math.floor(rand(h + 4) * 365),
            viralEvery: 30 + Math.floor(rand(h + 5) * 60), // ไวรัลทุก ๆ กี่วัน
            viralPower: rand(h + 6) < 0.35 ? 2 + rand(h + 7) * 6 : 0,
            viewsPerSale: 40 + Math.floor(rand(h + 8) * 160),
          },
        });
      });
    }
  }
  return products;
}

const PRODUCTS = buildProducts();

function dayNumber(date) {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
}

function salesOn(product, day) {
  const t = product._trend;
  const wave = 1 + t.amp * Math.sin((2 * Math.PI * (day + t.offset)) / t.period);
  // ไวรัล: พุ่งขึ้นแรงแล้วค่อย ๆ ลดลงภายในราว 1–2 สัปดาห์
  const phase = (day + t.offset) % t.viralEvery;
  const viral = t.viralPower ? t.viralPower * Math.exp(-phase / 4) : 0;
  const noise = 0.85 + rand(hashString(product.id) + day * 7919) * 0.3;
  return Math.max(0, Math.round(t.base * (wave + viral) * noise));
}

export const mockProvider = {
  name: 'mock',
  supportsBackfill: true,

  async getCatalog() {
    return {
      categories: CATEGORIES,
      countries: COUNTRIES,
      products: PRODUCTS.map(({ _trend, ...p }) => p),
    };
  },

  async fetchSnapshot(date) {
    const day = dayNumber(date);
    return PRODUCTS.map((p) => {
      const sales = salesOn(p, day);
      return {
        productId: p.id,
        sales,
        views: sales * p._trend.viewsPerSale,
        gmv: sales * p.price,
      };
    });
  },
};
