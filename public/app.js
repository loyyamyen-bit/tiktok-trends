import { ranking, history } from './lib/analytics.js';

const state = { sort: 'sales', channel: 'all', days: 7, category: '', minCommission: 0, q: '', data: null };
const LINE_COLORS = ['#fe2c55', '#25c2c9', '#f59e0b', '#8b5cf6', '#10b981'];
const POLL_MS = 5 * 60 * 1000;

const SORT_LABEL = {
  sales: ['สินค้าขายดี', 'เรียงตามยอดขายในช่วงที่เลือก'],
  growth: ['สินค้ามาแรง', 'เรียงตามการเติบโตของยอดขายเทียบกับช่วงก่อนหน้า เหมาะกับการจับกระแสก่อนคนอื่น'],
  commission: ['ค่าคอมสูง', 'เรียงตามค่าคอมรวมที่ครีเอเตอร์ได้จากสินค้านี้ (ยอดขาย × ราคา × % ค่าคอม) คือสินค้าที่ทำเงินให้ Affiliate ได้จริง'],
  opportunity: ['คู่แข่งน้อย', 'เรียงตามยอดขายต่อครีเอเตอร์ 1 คน ยิ่งสูงยิ่งดี แปลว่าขายดีแต่คนโปรโมทยังน้อย'],
};
const CHANNEL_LABEL = { all: '', live: ' · Live', video: ' · วิดีโอ' };

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('th-TH');
const fmtCompact = new Intl.NumberFormat('th-TH', { notation: 'compact', maximumFractionDigits: 1 });
const pct = (x) => `${Math.round(x * 100)}%`;
let trendChart;
let detailChart;

async function api(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

function categoryName(id) {
  return state.data.categories.find((c) => c.id === id)?.name ?? id;
}
function shortDate(date) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
}
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function has(key) {
  return Boolean(state.data.has?.[key]);
}

function growthHtml(g) {
  const cls = g > 0 ? 'up' : g < 0 ? 'down' : '';
  const sign = g > 0 ? '▲' : g < 0 ? '▼' : '';
  return `<span class="${cls}">${sign} ${Math.abs(g).toFixed(1)}%</span>`;
}

function rankMoveHtml(rank, prevRank) {
  if (prevRank == null) return '<span class="rank-move up">ใหม่</span>';
  const diff = prevRank - rank;
  if (diff > 0) return `<span class="rank-move up">▲${diff}</span>`;
  if (diff < 0) return `<span class="rank-move down">▼${-diff}</span>`;
  return '<span class="rank-move muted">–</span>';
}

function sparkline(values) {
  const w = 96, h = 28;
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1 || 1)) * w;
    const y = h - 2 - ((v - min) / (max - min || 1)) * (h - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const color = values[values.length - 1] >= values[0] ? cssVar('--up') : cssVar('--down');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline fill="none" stroke="${color}" stroke-width="1.75" stroke-linejoin="round" points="${pts.join(' ')}"/></svg>`;
}

function channelHtml(p) {
  const other = Math.max(0, 1 - p.liveShare - p.videoShare);
  return `<div class="chbar" title="Live ${pct(p.liveShare)} · วิดีโอ ${pct(p.videoShare)} · อื่น ๆ ${pct(other)}">
      <span class="ch-live" style="width:${p.liveShare * 100}%"></span>
      <span class="ch-video" style="width:${p.videoShare * 100}%"></span>
    </div>
    <span class="chlabel"><span class="dot ch-live"></span>Live ${pct(p.liveShare)} · <span class="dot ch-video"></span>วิดีโอ ${pct(p.videoShare)}</span>`;
}

function chartDefaults() {
  Chart.defaults.font.family = "'IBM Plex Sans Thai', system-ui, sans-serif";
  Chart.defaults.color = cssVar('--muted');
  Chart.defaults.borderColor = cssVar('--border');
}

function lineOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true } },
      tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmt.format(c.parsed.y)}` } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } },
      y: { beginAtZero: true, ticks: { callback: (v) => fmtCompact.format(v) } },
    },
    elements: { point: { radius: 0, hoverRadius: 4 }, line: { tension: 0.3, borderWidth: 2 } },
  };
}

// ลิงก์รูปจาก TikTok อาจหมดอายุ — ถ้าโหลดไม่ได้ให้แสดงไอคอนหมวดแทน
function thumbHtml(p) {
  return p.image
    ? `<span class="thumb"><img src="${escapeHtml(p.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith('${p.icon}')"></span>`
    : `<span class="thumb">${p.icon}</span>`;
}

function nameHtml(p) {
  const name = escapeHtml(p.name);
  if (!/^https?:\/\//.test(p.url ?? '')) return name;
  return `<a href="${escapeHtml(p.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${name}</a>`;
}

function renderGallery(product) {
  const images = product.images?.length ? product.images : product.image ? [product.image] : [];
  $('dGallery').hidden = images.length === 0;
  if (!images.length) return;
  const show = (i) => {
    $('dMainImg').src = images[i];
    $('dThumbs').querySelectorAll('button').forEach((b, k) => b.classList.toggle('active', k === i));
  };
  const link = /^https?:\/\//.test(product.url ?? '')
    ? `<a class="btn" href="${escapeHtml(product.url)}" target="_blank" rel="noopener">ดูสินค้าบน TikTok ↗</a>`
    : '';
  $('dThumbs').innerHTML = (images.length > 1
    ? images.map((src) => `<button type="button"><img src="${escapeHtml(src)}" alt="" referrerpolicy="no-referrer"></button>`).join('')
    : '') + link;
  $('dThumbs').querySelectorAll('button').forEach((b, i) => b.addEventListener('click', () => show(i)));
  $('dMainImg').onerror = () => { $('dGallery').hidden = true; };
  show(0);
}

// โหลด data.json (ทั้งในเครื่องและบน GitHub Pages) แล้วคำนวณทุกอย่างในเบราว์เซอร์
async function loadData() {
  state.data = await api(`data.json?t=${Date.now()}`);
  const live = state.data.provider !== 'mock';
  $('providerBadge').hidden = false;
  $('providerBadge').textContent = live ? `ข้อมูลจริง · ${state.data.provider}` : 'ข้อมูลจำลอง';
  $('providerBadge').classList.toggle('live', live);
  $('refresh').hidden = !state.data.canRefresh;
  // ซ่อนส่วนที่แหล่งข้อมูลปัจจุบันไม่มีให้
  document.querySelectorAll('[data-needs]').forEach((el) => { el.hidden = !has(el.dataset.needs); });
  if (!has('channels')) state.channel = 'all';
  $('updated').textContent = state.data.lastUpdated
    ? `อัปเดต ${new Date(state.data.lastUpdated).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}`
    : '';
}

function fillSelects() {
  for (const c of state.data.categories) $('category').add(new Option(`${c.icon} ${c.name}`, c.id));
}

function currentFilters(limit) {
  const { category, minCommission, q, days, sort, channel } = state;
  return { category, minCommission, q, days, sort, channel, limit };
}

function render() {
  const items = ranking(state.data, currentFilters(50));
  const [label, help] = SORT_LABEL[state.sort];
  const ch = CHANNEL_LABEL[state.channel];
  $('tableTitle').textContent = `${label}${ch} · ${state.days} วันล่าสุด`;
  $('chartTitle').textContent = `แนวโน้มยอดขาย${ch} 5 อันดับแรก`;
  $('salesHead').textContent = state.channel === 'live' ? 'ยอดขาย Live' : state.channel === 'video' ? 'ยอดขายวิดีโอ' : 'ยอดขาย';
  $('sortHelp').textContent = help;

  $('empty').hidden = items.length > 0;
  const noDaily = has('soldTotal') && items.length > 0 && items.every((p) => p.sales === 0);
  $('notice').hidden = !noDaily;
  $('notice').textContent = 'ตอนนี้มีข้อมูลแค่วันเดียว ยอดขายรายวันคำนวณจากยอดสะสมที่เพิ่มขึ้น จึงจะเริ่มแสดงหลังเก็บข้อมูลครั้งถัดไป ระหว่างนี้ตารางเรียงตามยอดขายสะสมแทน';

  $('rows').innerHTML = items.map((p) => `
    <tr data-id="${escapeHtml(p.id)}">
      <td class="num"><span class="rank">${p.rank}</span>${rankMoveHtml(p.rank, p.prevRank)}</td>
      <td>
        <div class="product">
          ${thumbHtml(p)}
          <div>
            <div class="pname">${nameHtml(p)}</div>
            <div class="pmeta">${escapeHtml(p.shop)} · ${categoryName(p.category)} · ฿${fmt.format(p.price)}</div>
          </div>
        </div>
      </td>
      <td class="num">${fmt.format(p.sales)} ชิ้น<span class="sub-val">฿${fmtCompact.format(p.gmv)}</span></td>
      ${has('commission') ? `<td class="num">${p.commissionRate != null
        ? `<span class="com-rate">${pct(p.commissionRate)}</span><span class="sub-val">฿${fmt.format(Math.round(p.commissionPerUnit))}/ชิ้น</span>`
        : '–'}</td>` : ''}
      ${has('channels') ? `<td class="hide-sm">${channelHtml(p)}</td>` : ''}
      ${has('creators') ? `<td class="num hide-sm">${fmt.format(p.creators)} คน<span class="sub-val">${p.salesPerCreator != null ? `${fmt.format(Math.round(p.salesPerCreator))} ชิ้น/คน` : ''}</span></td>` : ''}
      ${has('soldTotal') ? `<td class="num hide-sm">${p.soldTotal == null ? '–' : fmt.format(p.soldTotal)}</td>` : ''}
      <td class="num">${growthHtml(p.growth)}</td>
      <td class="hide-sm">${sparkline(p.spark)}</td>
    </tr>`).join('');

  renderTrendChart(items.slice(0, 5));
}

function renderTrendChart(top) {
  const field = state.channel === 'live' ? 'liveSales' : state.channel === 'video' ? 'videoSales' : 'sales';
  const series = top.map((p) => history(state.data, p.id, 30));
  const labels = series[0]?.map((h) => shortDate(h.date)) ?? [];
  const datasets = top.map((p, i) => ({
    label: `${p.name} (${p.shop})`,
    data: series[i].map((h) => h[field]),
    borderColor: LINE_COLORS[i],
    backgroundColor: LINE_COLORS[i],
  }));
  if (trendChart) {
    trendChart.data = { labels, datasets };
    trendChart.update();
  } else {
    trendChart = new Chart($('trendChart'), { type: 'line', data: { labels, datasets }, options: lineOptions() });
  }
}

function openDetail(id) {
  const product = state.data.products.find((p) => p.id === id);
  const hist = history(state.data, id, 60);
  const last7 = hist.slice(-7);
  const sum = (arr, k) => arr.reduce((s, h) => s + h[k], 0);
  const sales7 = sum(last7, 'sales');
  const rate = product.commissionRate;

  $('dTitle').textContent = product.image ? product.name : `${product.icon} ${product.name}`;
  $('dMeta').textContent = `${product.shop} · ${categoryName(product.category)} · ราคา ฿${fmt.format(product.price)}`;
  renderGallery(product);

  const kpis = [['ยอดขาย 7 วัน', `${fmt.format(sales7)} ชิ้น`]];
  if (rate != null) {
    kpis.push(['ค่าคอม', `${pct(rate)} · ฿${fmt.format(Math.round(product.price * rate))}/ชิ้น`]);
    kpis.push(['ค่าคอมรวม 7 วัน', `฿${fmtCompact.format(sum(last7, 'gmv') * rate)}`]);
  }
  if (has('channels') && sales7) {
    kpis.push(['ขายผ่าน Live', pct(sum(last7, 'liveSales') / sales7)]);
    kpis.push(['ขายผ่านวิดีโอ', pct(sum(last7, 'videoSales') / sales7)]);
  }
  if (has('creators')) kpis.push(['ครีเอเตอร์ที่โปรโมท', `${fmt.format(hist[hist.length - 1]?.creators ?? 0)} คน`]);
  if (has('videos')) kpis.push(['วิดีโอใหม่ 7 วัน', fmt.format(sum(last7, 'videos'))]);
  if (has('lives')) kpis.push(['ไลฟ์ 7 วัน', fmt.format(sum(last7, 'lives'))]);
  $('dKpis').innerHTML = kpis.map(([l, v]) => `<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('');

  const options = lineOptions();
  const labels = hist.map((h) => shortDate(h.date));
  let datasets;
  if (has('channels')) {
    // แท่งซ้อน: ยอดขายแยกช่องทาง + เส้นจำนวนครีเอเตอร์
    options.scales.x.stacked = true;
    options.scales.y.stacked = true;
    datasets = [
      { type: 'bar', label: 'Live', data: hist.map((h) => h.liveSales), backgroundColor: '#fe2c55', stack: 's' },
      { type: 'bar', label: 'วิดีโอ', data: hist.map((h) => h.videoSales), backgroundColor: '#25c2c9', stack: 's' },
      { type: 'bar', label: 'อื่น ๆ', data: hist.map((h) => Math.max(0, h.sales - h.liveSales - h.videoSales)), backgroundColor: cssVar('--border'), stack: 's' },
    ];
    if (has('creators')) {
      options.scales.y1 = { position: 'right', beginAtZero: true, grid: { display: false }, ticks: { callback: (v) => fmtCompact.format(v) } };
      datasets.push({ type: 'line', label: 'ครีเอเตอร์', data: hist.map((h) => h.creators), borderColor: '#f59e0b', backgroundColor: '#f59e0b', yAxisID: 'y1' });
    }
  } else {
    datasets = [{ type: 'line', label: 'ยอดขาย (ชิ้น)', data: hist.map((h) => h.sales), borderColor: LINE_COLORS[0], backgroundColor: LINE_COLORS[0] }];
  }
  detailChart?.destroy();
  $('detail').showModal();
  detailChart = new Chart($('detailChart'), { data: { labels, datasets }, options });
}

function bindSeg(id, key) {
  $(id).addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    $(id).querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
    state[key] = key === 'days' ? Number(btn.dataset.value) : btn.dataset.value;
    render();
  });
}

async function refresh() {
  $('refresh').disabled = true;
  try {
    await api('api/refresh', { method: 'POST' });
    await loadData();
    render();
  } catch (err) {
    alert(err.message);
  } finally {
    $('refresh').disabled = false;
  }
}

// ส่งออกอันดับตามตัวกรองปัจจุบันเป็นไฟล์ Excel (สร้างในเบราว์เซอร์ด้วย SheetJS)
function exportExcel() {
  const items = ranking(state.data, currentFilters(10000));
  const d = state.days;
  const rows = items.map((p) => ({
    'อันดับ': p.rank,
    'สินค้า': p.name,
    'ร้าน': p.shop,
    'หมวดหมู่': categoryName(p.category),
    'ราคา (บาท)': p.price,
    [`ยอดขาย ${d} วัน (ชิ้น)`]: p.sales,
    [`ยอดขาย ${d} วัน (บาท)`]: p.gmv,
    ...(has('commission') ? {
      'ค่าคอม (%)': p.commissionRate != null ? Math.round(p.commissionRate * 1000) / 10 : '',
      'ค่าคอม/ชิ้น (บาท)': p.commissionPerUnit != null ? Math.round(p.commissionPerUnit) : '',
      [`ค่าคอมรวม ${d} วัน (บาท)`]: p.commissionTotal != null ? Math.round(p.commissionTotal) : '',
    } : {}),
    ...(has('channels') ? { 'ขายผ่าน Live (%)': Math.round(p.liveShare * 100), 'ขายผ่านวิดีโอ (%)': Math.round(p.videoShare * 100) } : {}),
    ...(has('creators') ? { 'ครีเอเตอร์': p.creators, 'ยอดขาย/ครีเอเตอร์': p.salesPerCreator != null ? Math.round(p.salesPerCreator) : '' } : {}),
    ...(has('videos') ? { [`วิดีโอใหม่ ${d} วัน`]: p.videos } : {}),
    ...(has('lives') ? { [`ไลฟ์ ${d} วัน`]: p.lives } : {}),
    ...(has('soldTotal') ? { 'ยอดขายสะสม': p.soldTotal ?? '' } : {}),
    'เติบโต (%)': Math.round(p.growth * 10) / 10,
    'ลิงก์': p.url ?? '',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = Object.keys(rows[0] ?? {}).map((k) => ({ wch: k === 'สินค้า' || k === 'ลิงก์' ? 40 : Math.max(10, k.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, SORT_LABEL[state.sort][0]);
  const date = state.data.dates[state.data.dates.length - 1] ?? 'empty';
  XLSX.writeFile(wb, `tiktok-affiliate-${state.sort}-${state.channel}-${date}.xlsx`);
}

// ตรวจทุก 5 นาทีว่ามีข้อมูลใหม่หรือยัง (หลัง cron/GitHub Actions ทำงาน)
function startPolling() {
  setInterval(async () => {
    const before = state.data.lastUpdated;
    await loadData();
    if (state.data.lastUpdated !== before) render();
  }, POLL_MS);
}

async function init() {
  chartDefaults();
  await loadData();
  fillSelects();
  bindSeg('sort', 'sort');
  bindSeg('channel', 'channel');
  bindSeg('days', 'days');
  $('category').addEventListener('change', (e) => { state.category = e.target.value; render(); });
  $('minCommission').addEventListener('change', (e) => { state.minCommission = Number(e.target.value); render(); });
  let searchTimer;
  $('search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.q = e.target.value.trim(); render(); }, 200);
  });
  $('rows').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) openDetail(tr.dataset.id);
  });
  $('refresh').addEventListener('click', refresh);
  $('export').addEventListener('click', exportExcel);
  render();
  startPolling();
}

init().catch((err) => {
  console.error(err);
  $('empty').hidden = false;
  $('empty').textContent = `โหลดข้อมูลไม่สำเร็จ: ${err.message}`;
});
