import { ranking, history } from './lib/analytics.js';

const state = { sort: 'sales', channel: 'all', days: 7, category: '', minCommission: 0, q: '', onlyStarred: false, data: null };
const LINE_COLORS = ['#fe2c55', '#25c2c9', '#f59e0b', '#8b5cf6', '#10b981'];
const POLL_MS = 5 * 60 * 1000;

const SORT_LABEL = {
  sales: ['สินค้าขายดี', 'เรียงตามยอดขายในช่วงที่เลือก'],
  growth: ['สินค้ามาแรง', 'เรียงตามการเติบโตของยอดขายเทียบกับช่วงก่อนหน้า เหมาะกับการจับกระแสก่อนคนอื่น'],
  commission: ['ค่าคอมสูง', 'เรียงตามค่าคอมรวมที่ครีเอเตอร์ได้จากสินค้านี้ (ยอดขาย × ราคา × % ค่าคอม) คือสินค้าที่ทำเงินให้ Affiliate ได้จริง'],
  opportunity: ['คู่แข่งน้อย', 'เรียงตามยอดขายต่อครีเอเตอร์ 1 คน ยิ่งสูงยิ่งดี แปลว่าขายดีแต่คนโปรโมทยังน้อย'],
};
const CHANNEL_LABEL = { all: '', live: ' · Live', video: ' · วิดีโอ' };
const STAGE = {
  rising: ['🌱 เพิ่งเริ่มขึ้น', 'ยอดเพิ่งโตจากระดับปกติ เข้าตอนนี้ได้เปรียบ'],
  peak: ['🔥 กำลังพีค', 'ยอดสูงกว่าปกติมาก คนเริ่มแห่เข้ามา'],
  falling: ['📉 เริ่มขาลง', 'ยอดลดลงจากสัปดาห์ก่อน ควรระวัง'],
  steady: ['💤 ทรงตัว', 'ขายได้สม่ำเสมอ ไม่หวือหวา'],
};
const TAG = {
  hot: ['⚡ กำลังพุ่ง', 'ยอดขายโต 50% ขึ้นไป'],
  highCommission: ['💎 ค่าคอมสูง', 'ค่าคอม 20% ขึ้นไป'],
  lowCompetition: ['🎯 คู่แข่งน้อย', 'ยอดขายต่อครีเอเตอร์อยู่ใน 20% บนสุด'],
  live: ['🔴 เหมาะกับ Live', 'ยอดขายครึ่งหนึ่งขึ้นไปมาจาก Live'],
  video: ['🎬 เหมาะกับวิดีโอ', 'ยอดขายเกินครึ่งมาจากวิดีโอ'],
};

// รายการที่เก็บไว้ + โน้ต เก็บในเบราว์เซอร์นี้ (ไม่ส่งขึ้นเซิร์ฟเวอร์)
const SHORTLIST_KEY = 'tiktok-affiliate-shortlist';
const shortlist = loadShortlist();
function loadShortlist() {
  try {
    return new Map(Object.entries(JSON.parse(localStorage.getItem(SHORTLIST_KEY)) ?? {}));
  } catch {
    return new Map();
  }
}
function saveShortlist() {
  try {
    localStorage.setItem(SHORTLIST_KEY, JSON.stringify(Object.fromEntries(shortlist)));
  } catch {
    // โหมดส่วนตัวหรือบล็อก storage — ใช้ได้จนกว่าจะปิดหน้า
  }
  $('starCount').textContent = shortlist.size;
}
function toggleStar(id) {
  if (shortlist.has(id)) shortlist.delete(id);
  else shortlist.set(id, { note: '', addedAt: new Date().toISOString() });
  saveShortlist();
}

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

function badgesHtml(p) {
  const out = [];
  if (p.stage) out.push(`<span class="badge-sm stage-${p.stage}" title="${STAGE[p.stage][1]}">${STAGE[p.stage][0]}</span>`);
  for (const t of p.tags ?? []) out.push(`<span class="badge-sm" title="${TAG[t][1]}">${TAG[t][0]}</span>`);
  return out.length ? `<div class="badges">${out.join('')}</div>` : '';
}

function money(x) {
  return x >= 10000 ? fmtCompact.format(x) : fmt.format(Math.round(x));
}

function commissionHtml(p) {
  if (p.rate == null) return '–';
  const rate = p.commissionEstimated
    ? `<span class="com-rate" title="แหล่งข้อมูลไม่มี % ค่าคอม ใช้ค่าเริ่มต้นแทน">~${pct(p.rate)}</span> <span class="est">ประมาณ</span>`
    : `<span class="com-rate">${pct(p.rate)}</span>`;
  const earn = [
    p.earnPerVideo != null ? `คลิป ~฿${money(p.earnPerVideo)}` : '',
    p.earnPerLive != null ? `ไลฟ์ ~฿${money(p.earnPerLive)}` : '',
  ].filter(Boolean).join(' · ');
  return `${rate}<span class="sub-val">฿${fmt.format(Math.round(p.commissionPerUnit))}/ชิ้น</span>${earn ? `<span class="sub-val">${earn}</span>` : ''}`;
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

function safeUrl(u) {
  return /^https?:\/\//.test(u ?? '') ? u : null;
}

// ปุ่มลิงก์สินค้า / คัดลอกลิงก์ / ลิงก์ร้าน
function linkButtonsHtml({ url, shopUrl }, small = false) {
  const cls = `btn${small ? ' sm' : ''}`;
  const out = [];
  if (safeUrl(url)) {
    out.push(`<a class="${cls}" href="${escapeHtml(url)}" target="_blank" rel="noopener" data-stop>เปิดใน TikTok ↗</a>`);
    out.push(`<button type="button" class="${cls}" data-copy="${escapeHtml(url)}">📋 คัดลอกลิงก์</button>`);
  }
  if (safeUrl(shopUrl)) out.push(`<a class="${cls}" href="${escapeHtml(shopUrl)}" target="_blank" rel="noopener" data-stop>🏪 ร้านค้า ↗</a>`);
  return out.join('');
}

async function copyText(btn) {
  try {
    await navigator.clipboard.writeText(btn.dataset.copy);
    const label = btn.textContent;
    btn.textContent = '✓ คัดลอกแล้ว';
    setTimeout(() => { btn.textContent = label; }, 1500);
  } catch {
    prompt('คัดลอกลิงก์นี้', btn.dataset.copy);
  }
}

// ---------- วิเคราะห์ด้วย AI ----------
const FORMAT_LABEL = { live: '🔴 เหมาะกับไลฟ์มากกว่า', video: '🎬 เหมาะกับคลิปมากกว่า', both: '✨ ทำได้ทั้งไลฟ์และคลิป' };

function analysisOf(id) {
  return state.data.analyses?.[id] ?? null;
}

// ปุ่มวิเคราะห์ — ถ้ามีผลแล้วเปิดดูได้เสมอ ถ้ายังไม่มีต้องรันในเครื่องที่ตั้ง API key ไว้
function analyzeButtonHtml(id, small = false) {
  const has = analysisOf(id);
  if (!has && !state.data.canAnalyze) return '';
  return `<button type="button" class="btn ai${small ? ' sm' : ''}" data-analyze="${escapeHtml(id)}">${has ? '🤖 ดูผลวิเคราะห์' : '🤖 วิเคราะห์ด้วย AI'}</button>`;
}

function miniScoresHtml(id) {
  const a = analysisOf(id)?.result;
  return a ? `<div class="an-mini">🔴 ไลฟ์ <b>${a.live.score}</b>/10 · 🎬 คลิป <b>${a.video.score}</b>/10</div>` : '';
}

function listHtml(items, ordered = false) {
  if (!items?.length) return '<p class="muted">–</p>';
  const tag = ordered ? 'ol' : 'ul';
  return `<${tag}>${items.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</${tag}>`;
}

function findItem(id) {
  return state.data.products.find((p) => p.id === id) ?? state.data.links?.find((l) => l.id === id);
}

function showAnalysis(id) {
  const rec = analysisOf(id);
  const item = findItem(id);
  const a = rec.result;
  $('aTitle').textContent = item?.name ?? id;
  $('aImg').innerHTML = item?.image ? `<img src="${escapeHtml(item.image)}" alt="" referrerpolicy="no-referrer">` : (item?.icon ?? '🛍️');
  const score = (key, label) => `<div class="an-score ${a.bestFormat === key || a.bestFormat === 'both' ? 'best' : ''}">
      <div class="top"><span>${label}</span><span class="num">${a[key].score}<span class="muted">/10</span></span></div>
      <div class="bar"><span style="width:${a[key].score * 10}%"></span></div>
      <p>${escapeHtml(a[key].reason)}</p>
    </div>`;
  $('aBody').innerHTML = `
    <div class="an-summary"><b>${FORMAT_LABEL[a.bestFormat] ?? ''}</b><br>${escapeHtml(a.summary)}</div>
    <div class="an-scores">${score('live', '🔴 ไลฟ์')}${score('video', '🎬 คลิปสั้น')}</div>
    <div class="an-grid">
      <div class="an-sec"><h4>🎯 กลุ่มเป้าหมาย</h4>${listHtml(a.targetAudience)}</div>
      <div class="an-sec"><h4>💪 จุดขาย</h4>${listHtml(a.sellingPoints)}</div>
      <div class="an-sec full"><h4>🪝 Hook 3 วินาทีแรก</h4>${listHtml(a.hooks, true)}</div>
      <div class="an-sec"><h4>💡 ไอเดียคอนเทนต์</h4>${listHtml(a.contentIdeas)}</div>
      <div class="an-sec"><h4>🎙️ โครงไลฟ์</h4>${listHtml(a.liveOutline, true)}</div>
      <div class="an-sec warn full"><h4>⚠️ ข้อควรระวัง</h4>${listHtml(a.cautions)}</div>
      <div class="an-sec"><h4>✅ เช็กก่อนรับงาน</h4>${listHtml(a.checklist)}</div>
      <div class="an-sec"><h4>📊 ความเห็นต่อตัวเลข</h4><p>${escapeHtml(a.dataNote)}</p></div>
    </div>`;
  const when = new Date(rec.analyzedAt).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
  $('aMeta').textContent = `วิเคราะห์เมื่อ ${when}${rec.withSalesData ? ' · ใช้ข้อมูลยอดขายประกอบ' : ' · ยังไม่มีข้อมูลยอดขาย'}${rec.costUsd != null ? ` · ค่าใช้จ่าย ~$${rec.costUsd}` : ''}`;
  $('aRedo').hidden = !state.data.canAnalyze;
  $('aRedo').onclick = () => runAnalysis(id, $('aRedo'), true);
  if (!$('analysis').open) $('analysis').showModal();
}

async function runAnalysis(id, btn, force = false) {
  if (!force && analysisOf(id)) return showAnalysis(id);
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ กำลังวิเคราะห์… (~30 วินาที)';
  try {
    const rec = await api(`api/analyze/${encodeURIComponent(id)}${force ? '?force=1' : ''}`, { method: 'POST' });
    state.data.analyses = { ...state.data.analyses, [id]: rec };
    render();
    showAnalysis(id);
    btn.textContent = '🤖 ดูผลวิเคราะห์';
  } catch (err) {
    alert(`วิเคราะห์ไม่สำเร็จ: ${err.message}`);
    btn.textContent = label;
  } finally {
    btn.disabled = false;
  }
}

// การ์ดสินค้า/ร้านที่เพิ่มจากลิงก์ — ถ้าสินค้านั้นมีข้อมูลยอดขายแล้ว แสดงตัวเลขและกดดูรายละเอียดได้
function renderLinks() {
  const links = state.data.links ?? [];
  const canEdit = state.data.canRefresh;
  $('linksCard').hidden = !canEdit && links.length === 0;
  $('linkForm').hidden = !canEdit;
  $('linkCount').textContent = links.length ? `(${links.length})` : '';
  const metrics = new Map(ranking(state.data, { days: 7, limit: 100000 }).map((r) => [r.id, r]));

  $('linkCards').innerHTML = links.length
    ? links.map((l) => {
      const m = metrics.get(l.id);
      const img = l.image ?? m?.image;
      const stats = m
        ? `<div class="lcard-stats">฿${fmt.format(m.price)} · ขาย 7 วัน <b>${fmt.format(m.sales)}</b> ชิ้น${m.rate != null ? ` · คอม ${m.commissionEstimated ? '~' : ''}${pct(m.rate)}` : ''}</div>${badgesHtml(m)}`
        : `<div class="lcard-stats">${l.type === 'shop' ? 'ร้านค้า · ' : ''}รอข้อมูลราคาและยอดขาย${state.data.provider === 'mock' ? ' (ต้องใช้ข้อมูลจริงจาก Apify)' : ' (เก็บข้อมูลครั้งถัดไป)'}</div>`;
      return `<div class="lcard ${m ? 'has-data' : ''}" data-link="${escapeHtml(l.id)}">
        <div class="lcard-img">${img ? `<img src="${escapeHtml(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith('${l.type === 'shop' ? '🏪' : '🛍️'}')">` : (l.type === 'shop' ? '🏪' : '🛍️')}</div>
        <div class="lcard-body">
          <div class="lcard-name" title="${escapeHtml(l.name)}">${escapeHtml(l.name)}</div>
          ${stats}
          ${miniScoresHtml(l.id)}
          ${l.type === 'product' && !analysisOf(l.id) && canEdit && !state.data.canAnalyze
            ? '<div class="lcard-stats">🤖 ยังวิเคราะห์ด้วย AI ไม่ได้: ต้องใส่ ANTHROPIC_API_KEY ในไฟล์ .env ก่อน</div>'
            : ''}
        </div>
        <div class="lcard-actions">
          ${l.type === 'product' ? analyzeButtonHtml(l.id, true) : ''}
          ${linkButtonsHtml({ url: l.url, shopUrl: m?.shopUrl }, true)}
          ${canEdit ? `<button type="button" class="btn sm" data-unlink="${escapeHtml(l.id)}" aria-label="ลบ">✕</button>` : ''}
        </div>
      </div>`;
    }).join('')
    : '<p class="muted">ยังไม่มีลิงก์ ลองวางลิงก์สินค้าจากแอป TikTok ด้านบน</p>';
}

function showLinkMsg(text, ok) {
  $('linkMsg').hidden = false;
  $('linkMsg').textContent = text;
  $('linkMsg').className = `link-msg ${ok ? 'ok' : 'err'}`;
}

async function submitLink(e) {
  e.preventDefault();
  $('linkAdd').disabled = true;
  try {
    const { item, added } = await api('api/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: $('linkInput').value }),
    });
    $('linkInput').value = '';
    await loadData();
    renderLinks();
    // มี API key → วิเคราะห์ให้ทันทีโดยไม่ต้องกดปุ่ม
    const autoBtn = item.type === 'product' && state.data.canAnalyze && !analysisOf(item.id)
      ? document.querySelector(`[data-analyze="${CSS.escape(item.id)}"]`)
      : null;
    showLinkMsg(`${added ? `เพิ่ม "${item.name.slice(0, 60)}" แล้ว` : 'ลิงก์นี้มีอยู่แล้ว'}${autoBtn ? ' · กำลังวิเคราะห์ด้วย AI…' : ''}`, true);
    if (autoBtn) runAnalysis(item.id, autoBtn);
  } catch (err) {
    showLinkMsg(err.message, false);
  } finally {
    $('linkAdd').disabled = false;
  }
}

async function unlink(id) {
  const name = state.data.links?.find((l) => l.id === id)?.name ?? '';
  if (!confirm(`ลบ "${name.slice(0, 50)}" ออกจากรายการที่ติดตาม?`)) return;
  await api(`api/links/${encodeURIComponent(id)}`, { method: 'DELETE' });
  await loadData();
  renderLinks();
}

function renderGallery(product) {
  const images = product.images?.length ? product.images : product.image ? [product.image] : [];
  $('dGallery').hidden = images.length === 0;
  if (!images.length) return;
  const show = (i) => {
    $('dMainImg').src = images[i];
    $('dThumbs').querySelectorAll('button').forEach((b, k) => b.classList.toggle('active', k === i));
  };
  $('dThumbs').innerHTML = images.length > 1
    ? images.map((src) => `<button type="button"><img src="${escapeHtml(src)}" alt="" referrerpolicy="no-referrer"></button>`).join('')
    : '';
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
  return { category, minCommission, q, days, sort, channel, limit, only: state.onlyStarred ? new Set(shortlist.keys()) : null };
}

function render() {
  const items = ranking(state.data, currentFilters(50));
  const [label, help] = SORT_LABEL[state.sort];
  const ch = CHANNEL_LABEL[state.channel];
  $('tableTitle').textContent = `${label}${ch} · ${state.days} วันล่าสุด`;
  $('chartTitle').textContent = `แนวโน้มยอดขาย${ch} 5 อันดับแรก`;
  $('salesHead').textContent = state.channel === 'live' ? 'ยอดขาย Live' : state.channel === 'video' ? 'ยอดขายวิดีโอ' : 'ยอดขาย';
  $('sortHelp').textContent = has('realCommission')
    ? help
    : `${help} · ค่าคอมที่แสดงเป็นค่าประมาณ ${pct(state.data.defaultCommissionRate)} เพราะแหล่งข้อมูลไม่มี % ค่าคอมจริง`;

  $('empty').hidden = items.length > 0;
  $('empty').textContent = state.onlyStarred && !shortlist.size
    ? 'ยังไม่มีสินค้าที่เก็บไว้ กด ☆ หน้าสินค้าเพื่อเก็บ'
    : 'ไม่พบสินค้าตามตัวกรองนี้';
  const noDaily = has('soldTotal') && items.length > 0 && items.every((p) => p.sales === 0);
  $('notice').hidden = !noDaily;
  $('notice').textContent = 'ตอนนี้มีข้อมูลแค่วันเดียว ยอดขายรายวันคำนวณจากยอดสะสมที่เพิ่มขึ้น จึงจะเริ่มแสดงหลังเก็บข้อมูลครั้งถัดไป ระหว่างนี้ตารางเรียงตามยอดขายสะสมแทน';

  $('rows').innerHTML = items.map((p) => `
    <tr data-id="${escapeHtml(p.id)}">
      <td class="star-col"><button class="star ${shortlist.has(p.id) ? 'on' : ''}" data-star="${escapeHtml(p.id)}" aria-label="เก็บไว้">${shortlist.has(p.id) ? '★' : '☆'}</button></td>
      <td class="num"><span class="rank">${p.rank}</span>${rankMoveHtml(p.rank, p.prevRank)}</td>
      <td>
        <div class="product">
          ${thumbHtml(p)}
          <div>
            <div class="pname">${nameHtml(p)}</div>
            <div class="pmeta">${escapeHtml(p.shop)} · ${categoryName(p.category)} · ฿${fmt.format(p.price)}</div>
            ${badgesHtml(p)}
          </div>
        </div>
      </td>
      <td class="num">${fmt.format(p.sales)} ชิ้น<span class="sub-val">฿${fmtCompact.format(p.gmv)}</span></td>
      ${has('commission') ? `<td class="num">${commissionHtml(p)}</td>` : ''}
      ${has('channels') ? `<td class="hide-sm">${channelHtml(p)}</td>` : ''}
      ${has('creators') ? `<td class="num hide-sm">${fmt.format(p.creators)} คน<span class="sub-val">${p.salesPerCreator != null ? `${fmt.format(Math.round(p.salesPerCreator))} ชิ้น/คน` : ''}</span></td>` : ''}
      ${has('soldTotal') ? `<td class="num hide-sm">${p.soldTotal == null ? '–' : fmt.format(p.soldTotal)}</td>` : ''}
      <td class="num">${growthHtml(p.growth)}</td>
      <td class="hide-sm">${sparkline(p.spark)}</td>
    </tr>`).join('');

  renderTrendChart(items.slice(0, 5));
  renderLinks();
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
  // ตัวชี้วัดของสินค้านี้ (7 วัน ทุกช่องทาง) สำหรับป้ายและรายได้ต่อคลิป/ไลฟ์
  const m = ranking(state.data, { days: 7, limit: 1000 }).find((r) => r.id === id);
  const hist = history(state.data, id, 60);
  const last7 = hist.slice(-7);
  const sum = (arr, k) => arr.reduce((s, h) => s + h[k], 0);
  const sales7 = sum(last7, 'sales');
  const rate = m?.rate ?? null;

  $('dTitle').textContent = product.image ? product.name : `${product.icon} ${product.name}`;
  $('dMeta').textContent = `${product.shop} · ${categoryName(product.category)} · ราคา ฿${fmt.format(product.price)}`;
  renderGallery(product);
  $('dLinks').innerHTML = analyzeButtonHtml(id) + linkButtonsHtml(product);
  $('dBadges').innerHTML = m ? badgesHtml(m).replace('<div class="badges">', '').replace(/<\/div>$/, '') : '';
  const syncStar = () => { $('dStar').textContent = shortlist.has(id) ? '★ เก็บไว้แล้ว' : '☆ เก็บไว้'; };
  syncStar();
  $('dStar').onclick = () => { toggleStar(id); syncStar(); renderNote(id); render(); };
  renderNote(id);

  const kpis = [['ยอดขาย 7 วัน', `${fmt.format(sales7)} ชิ้น`]];
  if (rate != null) {
    kpis.push([m.commissionEstimated ? 'ค่าคอม (ประมาณ)' : 'ค่าคอม', `${m.commissionEstimated ? '~' : ''}${pct(rate)} · ฿${fmt.format(Math.round(product.price * rate))}/ชิ้น`]);
    kpis.push(['ค่าคอมรวม 7 วัน', `฿${fmtCompact.format(sum(last7, 'gmv') * rate)}`]);
    if (m.earnPerVideo != null) kpis.push(['ได้เฉลี่ยต่อคลิป', `~฿${money(m.earnPerVideo)}`]);
    if (m.earnPerLive != null) kpis.push(['ได้เฉลี่ยต่อไลฟ์', `~฿${money(m.earnPerLive)}`]);
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

function renderNote(id) {
  const starred = shortlist.has(id);
  $('dNoteWrap').hidden = !starred;
  if (!starred) return;
  $('dNote').value = shortlist.get(id).note ?? '';
  $('dNote').oninput = (e) => {
    shortlist.get(id).note = e.target.value;
    saveShortlist();
  };
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
    'เก็บไว้': shortlist.has(p.id) ? '⭐' : '',
    'สินค้า': p.name,
    'ร้าน': p.shop,
    'หมวดหมู่': categoryName(p.category),
    'ราคา (บาท)': p.price,
    [`ยอดขาย ${d} วัน (ชิ้น)`]: p.sales,
    [`ยอดขาย ${d} วัน (บาท)`]: p.gmv,
    'ช่วงกระแส': p.stage ? STAGE[p.stage][0].replace(/^\S+ /, '') : '',
    'จุดเด่น': p.tags.map((t) => TAG[t][0].replace(/^\S+ /, '')).join(', '),
    ...(has('commission') ? {
      'ค่าคอม (%)': p.rate != null ? Math.round(p.rate * 1000) / 10 : '',
      'ค่าคอมเป็นค่าประมาณ': p.commissionEstimated ? 'ใช่' : '',
      'ค่าคอม/ชิ้น (บาท)': p.commissionPerUnit != null ? Math.round(p.commissionPerUnit) : '',
      [`ค่าคอมรวม ${d} วัน (บาท)`]: p.commissionTotal != null ? Math.round(p.commissionTotal) : '',
      ...(has('videos') ? { 'ได้เฉลี่ยต่อคลิป (บาท)': p.earnPerVideo != null ? Math.round(p.earnPerVideo) : '' } : {}),
      ...(has('lives') ? { 'ได้เฉลี่ยต่อไลฟ์ (บาท)': p.earnPerLive != null ? Math.round(p.earnPerLive) : '' } : {}),
    } : {}),
    ...(has('channels') ? { 'ขายผ่าน Live (%)': Math.round(p.liveShare * 100), 'ขายผ่านวิดีโอ (%)': Math.round(p.videoShare * 100) } : {}),
    ...(has('creators') ? { 'ครีเอเตอร์': p.creators, 'ยอดขาย/ครีเอเตอร์': p.salesPerCreator != null ? Math.round(p.salesPerCreator) : '' } : {}),
    ...(has('videos') ? { [`วิดีโอใหม่ ${d} วัน`]: p.videos } : {}),
    ...(has('lives') ? { [`ไลฟ์ ${d} วัน`]: p.lives } : {}),
    ...(has('soldTotal') ? { 'ยอดขายสะสม': p.soldTotal ?? '' } : {}),
    'เติบโต (%)': Math.round(p.growth * 10) / 10,
    'ลิงก์': p.url ?? '',
    'ลิงก์ร้าน': p.shopUrl ?? '',
    'AI: เหมาะกับ': analysisOf(p.id) ? FORMAT_LABEL[analysisOf(p.id).result.bestFormat].replace(/^\S+ /, '') : '',
    'AI: คะแนนไลฟ์': analysisOf(p.id)?.result.live.score ?? '',
    'AI: คะแนนคลิป': analysisOf(p.id)?.result.video.score ?? '',
    'AI: สรุป': analysisOf(p.id)?.result.summary ?? '',
    'โน้ต': shortlist.get(p.id)?.note ?? '',
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
  $('starFilter').addEventListener('click', () => {
    state.onlyStarred = !state.onlyStarred;
    $('starFilter').setAttribute('aria-pressed', state.onlyStarred);
    render();
  });
  $('rows').addEventListener('click', (e) => {
    const star = e.target.closest('[data-star]');
    if (star) {
      toggleStar(star.dataset.star);
      render();
      return;
    }
    const tr = e.target.closest('tr[data-id]');
    if (tr) openDetail(tr.dataset.id);
  });
  $('refresh').addEventListener('click', refresh);
  $('export').addEventListener('click', exportExcel);
  $('linkForm').addEventListener('submit', submitLink);
  // ปุ่มคัดลอก/ลบ/เปิดลิงก์ ใช้ได้ทั้งในการ์ดลิงก์และหน้ารายละเอียด
  document.addEventListener('click', (e) => {
    const copy = e.target.closest('[data-copy]');
    if (copy) { e.stopPropagation(); copyText(copy); return; }
    if (e.target.closest('[data-stop]')) { e.stopPropagation(); return; }
    const an = e.target.closest('[data-analyze]');
    if (an) { e.stopPropagation(); runAnalysis(an.dataset.analyze, an); return; }
    const un = e.target.closest('[data-unlink]');
    if (un) { e.stopPropagation(); unlink(un.dataset.unlink); return; }
    const card = e.target.closest('.lcard.has-data');
    if (card) openDetail(card.dataset.link);
  }, true);
  saveShortlist();
  render();
  startPolling();
}

init().catch((err) => {
  console.error(err);
  $('empty').hidden = false;
  $('empty').textContent = `โหลดข้อมูลไม่สำเร็จ: ${err.message}`;
});
