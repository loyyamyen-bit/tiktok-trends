import { ranking, history } from './lib/analytics.js';

const state = { sort: 'sales', days: 7, country: '', category: '', q: '', data: null, items: [] };
const LINE_COLORS = ['#fe2c55', '#25c2c9', '#f59e0b', '#8b5cf6', '#10b981'];
const POLL_MS = 5 * 60 * 1000;

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('th-TH');
const fmtCompact = new Intl.NumberFormat('th-TH', { notation: 'compact', maximumFractionDigits: 1 });
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
function countryName(code) {
  return state.data.countries.find((c) => c.code === code)?.name ?? code;
}
function isLive() {
  return state.data.provider !== 'mock';
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

function thumbHtml(p) {
  return p.image
    ? `<span class="thumb"><img src="${escapeHtml(p.image)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>`
    : `<span class="thumb">${p.icon}</span>`;
}

function nameHtml(p) {
  const name = escapeHtml(p.name);
  if (!/^https?:\/\//.test(p.url ?? '')) return name;
  return `<a href="${escapeHtml(p.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${name}</a>`;
}

// โหลด data.json (ทั้งในเครื่องและบน GitHub Pages) แล้วคำนวณทุกอย่างในเบราว์เซอร์
async function loadData() {
  state.data = await api(`data.json?t=${Date.now()}`);
  const live = isLive();
  $('providerBadge').hidden = false;
  $('providerBadge').textContent = live ? `ข้อมูลจริง · ${state.data.provider}` : 'ข้อมูลจำลอง';
  $('providerBadge').classList.toggle('live', live);
  $('refresh').hidden = !state.data.canRefresh;
  document.querySelectorAll('.col-total').forEach((el) => { el.hidden = !live; });
  $('updated').textContent = state.data.lastUpdated
    ? `อัปเดต ${new Date(state.data.lastUpdated).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}`
    : '';
}

function fillSelects() {
  for (const c of state.data.countries) $('country').add(new Option(c.name, c.code));
  for (const c of state.data.categories) $('category').add(new Option(`${c.icon} ${c.name}`, c.id));
}

function currentFilters(limit) {
  const { country, category, q, days, sort } = state;
  return { country, category, q, days, sort, limit };
}

function render() {
  const items = ranking(state.data, currentFilters(50));
  state.items = items;

  const label = state.sort === 'growth' ? 'สินค้ามาแรง' : 'สินค้าขายดี';
  $('tableTitle').textContent = `${label} · ${state.days} วันล่าสุด`;
  const live = isLive();
  $('empty').hidden = items.length > 0;
  const noDaily = live && items.length > 0 && items.every((p) => p.sales === 0);
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
            <div class="pmeta">${escapeHtml(p.shop)} · ${categoryName(p.category)} · ${countryName(p.country)} · ฿${fmt.format(p.price)}</div>
          </div>
        </div>
      </td>
      <td class="num">${fmt.format(p.sales)}</td>
      <td class="num hide-sm">฿${fmtCompact.format(p.gmv)}</td>
      ${live ? `<td class="num hide-sm">${p.soldTotal == null ? '–' : fmt.format(p.soldTotal)}</td>` : ''}
      <td class="num">${growthHtml(p.growth)}</td>
      <td class="hide-sm">${sparkline(p.spark)}</td>
    </tr>`).join('');

  renderTrendChart(items.slice(0, 5));
}

function renderTrendChart(top) {
  const series = top.map((p) => history(state.data, p.id, 30));
  const labels = series[0]?.map((h) => shortDate(h.date)) ?? [];
  const datasets = top.map((p, i) => ({
    label: p.name,
    data: series[i].map((h) => h.sales),
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

  const hasViews = hist.some((h) => h.views > 0);
  $('dTitle').textContent = `${product.icon} ${product.name}`;
  $('dMeta').textContent = `${product.shop} · ${categoryName(product.category)} · ${countryName(product.country)} · ราคา ฿${fmt.format(product.price)}`;
  $('dKpis').innerHTML = [
    ['ยอดขาย 7 วัน', `${fmt.format(sum(last7, 'sales'))} ชิ้น`],
    ['ยอดขาย 7 วัน (บาท)', `฿${fmtCompact.format(sum(last7, 'gmv'))}`],
    ...(hasViews ? [['ยอดวิว 7 วัน', fmtCompact.format(sum(last7, 'views'))]] : []),
    ['ขายสูงสุด/วัน', `${fmt.format(Math.max(...hist.map((h) => h.sales)))} ชิ้น`],
  ].map(([l, v]) => `<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('');

  const options = lineOptions();
  options.scales.y1 = {
    position: 'right', beginAtZero: true, grid: { display: false },
    ticks: { callback: (v) => fmtCompact.format(v) },
  };
  const data = {
    labels: hist.map((h) => shortDate(h.date)),
    datasets: [
      { label: 'ยอดขาย (ชิ้น)', data: hist.map((h) => h.sales), borderColor: LINE_COLORS[0], backgroundColor: LINE_COLORS[0], yAxisID: 'y' },
      { label: 'ยอดวิว', data: hist.map((h) => h.views), borderColor: LINE_COLORS[1], backgroundColor: LINE_COLORS[1], yAxisID: 'y1', borderDash: [4, 4] },
    ],
  };
  if (!hasViews) {
    data.datasets.pop();
    delete options.scales.y1;
  }
  detailChart?.destroy();
  $('detail').showModal();
  detailChart = new Chart($('detailChart'), { type: 'line', data, options });
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
  const live = isLive();
  const items = ranking(state.data, currentFilters(10000));
  const d = state.days;
  const rows = items.map((p) => ({
    'อันดับ': p.rank,
    'อันดับเมื่อวาน': p.prevRank ?? '',
    'สินค้า': p.name,
    'ร้าน': p.shop,
    'หมวดหมู่': categoryName(p.category),
    'ประเทศ': countryName(p.country),
    'ราคา (บาท)': p.price,
    [`ยอดขาย ${d} วัน (ชิ้น)`]: p.sales,
    [`ยอดขาย ${d} วัน (บาท)`]: p.gmv,
    'เติบโต (%)': Math.round(p.growth * 10) / 10,
    ...(live ? { 'ยอดขายสะสม': p.soldTotal ?? '' } : { 'ยอดวิว': p.views }),
    'ลิงก์': p.url ?? '',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [6, 12, 40, 18, 18, 10, 10, 16, 16, 10, 14, 40].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, state.sort === 'growth' ? 'สินค้ามาแรง' : 'สินค้าขายดี');
  const date = state.data.dates[state.data.dates.length - 1] ?? 'empty';
  XLSX.writeFile(wb, `tiktok-${state.sort === 'growth' ? 'trending' : 'bestsellers'}-${date}.xlsx`);
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
  bindSeg('days', 'days');
  $('country').addEventListener('change', (e) => { state.country = e.target.value; render(); });
  $('category').addEventListener('change', (e) => { state.category = e.target.value; render(); });
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
