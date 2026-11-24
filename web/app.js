const REFRESH_MS = 30_000;
const $ = (id) => document.getElementById(id);
let state = { workflows: [], executions: [] };
let filter = 'all';

const fmtWhen = (s) => s ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(s)) : '—';
const ago = (s) => {
  if (!s) return '—';
  const m = Math.round((Date.now() - Date.parse(s)) / 60000);
  if (m < 1) return 'دلوقتي';
  if (m < 60) return `من ${m} دقيقة`;
  const h = Math.round(m / 60);
  if (h < 24) return `من ${h} ساعة`;
  return `من ${Math.round(h / 24)} يوم`;
};
const dur = (a, b) => {
  if (!a || !b) return '—';
  const s = Math.round((Date.parse(b) - Date.parse(a)) / 1000);
  return s < 60 ? `${s} ث` : s < 3600 ? `${Math.round(s / 60)} د` : `${(s / 3600).toFixed(1)} س`;
};
const WORD = { success: 'نجح', error: 'فشل', crashed: 'وقع', canceled: 'اتلغى', running: 'شغّال دلوقتي', waiting: 'مستني', new: 'جديد' };
const isFail = (s) => s === 'error' || s === 'crashed';

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  });
  kids.flat().forEach((k) => k != null && e.append(k));
  return e;
}

function toast(msg, isErr = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.className = 'toast'; }, 3500);
}

async function api(method, url) {
  const r = await fetch(url, { method });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
  return data;
}

async function load() {
  try {
    const d = await api('GET', '/api/overview');
    state = d;
    $('synced').textContent = 'آخر تحديث ' + fmtWhen(d.fetchedAt);
    render();
  } catch (e) {
    $('verdict').textContent = 'مش قادر أوصل لـ n8n: ' + e.message;
    $('verdict').className = 'verdict bad';
  }
}

function runsFor(id) {
  return state.executions.filter((e) => e.workflowId === id).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

function render() {
  const { workflows, executions } = state;
  const live = workflows.filter((w) => w.active);
  // A workflow is "failing" if its latest run failed.
  const failing = workflows.filter((w) => { const r = runsFor(w.id)[0]; return r && isFail(r.status); });

  const v = $('verdict');
  if (failing.length) {
    v.textContent = `${failing.length} workflow آخر تشغيل ليهم فشل — شوفهم تحت.`;
    v.className = 'verdict bad';
  } else {
    v.textContent = `${live.length} من ${workflows.length} workflow مفعّلين في n8n. حالة الخدمات الخارجية زي Clay غير متحقّق منها.`;
    v.className = 'verdict';
  }

  // Pipeline: "Outbound N" workflows, active ones only, in order.
  const stages = live
    .map((w) => ({ w, m: w.name.match(/^Outbound\s+(\d+)([a-z]?)/i) }))
    .filter((x) => x.m)
    .sort((a, b) => (+a.m[1] - +b.m[1]) || a.m[2].localeCompare(b.m[2]));
  $('pipeline').replaceChildren(...stages.map(({ w, m }) => {
    const last = runsFor(w.id)[0];
    const cls = last && isFail(last.status) ? 'bad' : last?.status === 'success' ? 'ok' : '';
    const label = w.name.replace(/^Outbound\s+\d+[a-z]?\s*[–-]\s*/i, '');
    return el('li', { class: 'stage ' + cls },
      el('span', { class: 'lamp', 'aria-hidden': 'true' }),
      el('span', { class: 'n' }, m[1] + m[2]),
      el('span', { class: 'name' }, label),
      el('span', { class: 'meta' }, last ? `${WORD[last.status] || last.status} · ${ago(last.startedAt)}` : 'مفيش تشغيل في السجل المعروض'));
  }));

  // Failed runs (latest 10), with retry.
  const fails = executions.filter((e) => isFail(e.status)).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)).slice(0, 10);
  $('failSection').hidden = fails.length === 0;
  const nameOf = (id) => (workflows.find((w) => w.id === id) || {}).name || id;
  $('fails').replaceChildren(...fails.map((e) => {
    const btn = el('button', { class: 'btn', type: 'button', textContent: 'شغّلها تاني' });
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { const r = await api('POST', `/api/executions/${e.id}/retry`); toast(`اتشغّلت تاني (تشغيل #${r.id})`); setTimeout(load, 2500); }
      catch (err) { toast('ما اشتغلتش: ' + err.message, true); btn.disabled = false; }
    });
    return el('li', {},
      el('div', {}, el('div', { class: 'what' }, nameOf(e.workflowId)), el('div', { class: 'when' }, `تشغيل #${e.id} · ${fmtWhen(e.startedAt)}`)),
      btn);
  }));

  // Workflow table
  const q = $('q').value.trim().toLowerCase();
  const rows = workflows
    .filter((w) => filter === 'all' || (filter === 'on' ? w.active : !w.active))
    .filter((w) => !q || w.name.toLowerCase().includes(q))
    .sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name));
  $('wf').replaceChildren(...(rows.length ? rows.map((w) => {
    const runs = runsFor(w.id);
    const last = runs[0];
    const sw = el('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(w.active), 'aria-label': (w.active ? 'وقّف ' : 'شغّل ') + w.name });
    sw.addEventListener('click', () => toggle(w, sw));
    return el('tr', {},
      el('td', { class: 'wname' }, el('b', {}, w.name), w.description ? el('small', {}, w.description) : null),
      el('td', {}, sw),
      el('td', {}, last ? ago(last.startedAt) : '—'),
      el('td', { class: 'narrow-hide ' + (last ? 'st-' + last.status : '') }, last ? (WORD[last.status] || last.status) : '—'),
      el('td', { class: 'narrow-hide' }, String(runs.length)));
  }) : [el('tr', {}, el('td', { class: 'empty', colSpan: 5 }, 'مفيش workflows بالفلتر ده.'))]));

  // Log
  const recent = executions.slice().sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)).slice(0, 40);
  $('log').replaceChildren(...recent.map((e) => el('tr', {},
    el('td', {}, e.id),
    el('td', { class: 'wname' }, nameOf(e.workflowId)),
    el('td', { class: 'st-' + e.status }, WORD[e.status] || e.status),
    el('td', {}, fmtWhen(e.startedAt)),
    el('td', { class: 'narrow-hide' }, dur(e.startedAt, e.stoppedAt)))));
}

async function toggle(w, sw) {
  const turningOff = w.active;
  if (turningOff && !confirm(`متأكد إنك عايز توقّف "${w.name}"؟ مش هيشتغل تاني لحد ما تشغّله.`)) return;
  sw.disabled = true;
  try {
    const r = await api('POST', `/api/workflows/${w.id}/${turningOff ? 'deactivate' : 'activate'}`);
    w.active = r.active;
    toast(r.active ? `"${w.name}" اشتغل` : `"${w.name}" وقف`);
    render();
  } catch (e) {
    toast('ما اتغيرش: ' + e.message, true);
    sw.disabled = false;
  }
}

document.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
  filter = c.dataset.f;
  document.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', String(x === c)));
  render();
}));
$('q').addEventListener('input', render);
$('refresh').addEventListener('click', load);
load();
setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
