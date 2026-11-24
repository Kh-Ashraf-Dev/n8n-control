const REFRESH_MS = 60_000;
const $ = (id) => document.getElementById(id);
const CAT = window.CATALOG || {};
let ov = { workflows: [], executions: [] };
let leads = [];
let leadsError = '';
let leadFilter = 'all';

const fmtDay = (s) => s ? new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'long' }).format(new Date(s)) : '—';
const fmtWhen = (s) => s ? new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }).format(new Date(s)) : '—';
const daysSince = (s) => Math.max(0, Math.floor((Date.now() - Date.parse(s)) / 86400000));
const ago = (s) => {
  if (!s) return '';
  const m = Math.round((Date.now() - Date.parse(s)) / 60000);
  if (m < 1) return 'دلوقتي';
  if (m < 60) return `من ${m} دقيقة`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? 'من ساعة' : `من ${h} ساعة`;
  const d = Math.round(h / 24);
  return d === 1 ? 'إمبارح' : `من ${d} يوم`;
};
const isFail = (s) => s === 'error' || s === 'crashed';

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  });
  kids.flat().forEach((k) => k != null && k !== false && e.append(k));
  return e;
}

async function get(url) {
  const r = await fetch(url);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
  return d;
}

async function load() {
  const [o, l] = await Promise.allSettled([get('/api/overview'), get('/api/leads')]);
  if (o.status === 'rejected') {
    $('verdict').textContent = 'الصفحة مش قادرة توصل لـ n8n دلوقتي. جرّب كمان شوية، ولو فضلت كده كلّم خالد.';
    $('verdict').className = 'verdict bad';
    return;
  }
  ov = o.value;
  if (l.status === 'fulfilled') { leads = l.value.leads; leadsError = ''; } else { leadsError = l.reason.message; }
  $('synced').textContent = 'آخر تحديث ' + fmtWhen(ov.fetchedAt);
  render();
}

// ---------- Lead status in plain words ----------
function leadState(x) {
  switch (x.status) {
    case 'replied': return { key: 'replied', cls: 'good', word: x.replyCategory === 'meeting_booked' ? 'ردّ وحجز ميعاد' : 'ردّ' };
    case 'sent': return { key: 'waiting', cls: 'wait', word: x.sentAt ? `مستنيين رده (بقاله ${daysSince(x.sentAt)} يوم)` : 'اتبعت، مستنيين رده' };
    case 'no_reply': return { key: 'noreply', cls: 'muted', word: 'ما ردّش' };
    case 'failed': return { key: 'failed', cls: 'bad', word: /bounce/i.test(x.failReason || '') ? 'الإيميل رجع (العنوان غلط)' : 'ما اتبعتش' };
    case 'draft': return { key: 'ready', cls: 'muted', word: 'الإيميل جاهز ومستني يتبعت' };
    case 'pending': return { key: 'ready', cls: 'muted', word: 'بيتجهّز له إيميل' };
    default: return { key: 'other', cls: 'muted', word: x.status || '—' };
  }
}
const wasSent = (x) => ['sent', 'replied', 'no_reply'].includes(x.status) || (x.status === 'failed' && /bounce/i.test(x.failReason || ''));

function runsFor(id) {
  return ov.executions.filter((e) => e.workflowId === id).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}
function health(w) {
  const last = runsFor(w.id)[0];
  if (!w.active) return { cls: 'off', last, line: 'متوقف دلوقتي' };
  if (last && isFail(last.status)) return { cls: 'bad', last, line: `آخر مرة اشتغل وقع (${ago(last.startedAt)})` };
  if (last?.status === 'success') return { cls: 'ok', last, line: `شغّال · آخر مرة اشتغل ${ago(last.startedAt)} ونجح` };
  if (last?.status === 'running') return { cls: 'idle', last, line: 'فيه تشغيل جاري دلوقتي' };
  if (last?.status === 'waiting') return { cls: 'idle', last, line: 'آخر تشغيل في الانتظار' };
  if (last?.status === 'canceled') return { cls: 'idle', last, line: 'آخر تشغيل اتلغى' };
  return { cls: 'idle', last, line: last ? 'نتيجة آخر تشغيل غير معروفة' : 'مفعّل في n8n · مفيش تشغيل في السجل المعروض' };
}

function render() {
  const wf = ov.workflows.map((w) => ({ ...w, c: CAT[w.id] || { group: 'internal', title: w.name, what: w.description } }));
  const sales = wf.filter((w) => w.c.group === 'sales').sort((a, b) => a.c.step - b.c.step);
  const social = wf.filter((w) => w.c.group === 'social').sort((a, b) => b.active - a.active);
  const internal = wf.filter((w) => w.c.group === 'internal');

  // ---------- Alerts: things the CEO should know ----------
  const alerts = [];
  [...sales, ...social].forEach((w) => {
    const h = health(w);
    if (h.cls === 'bad') alerts.push({ cls: 'bad', title: `"${w.c.title}" وقع آخر مرة اشتغل (${ago(h.last.startedAt)})`, body: `ده معناه: ${w.c.ifBroken} خالد يقدر يعيد تشغيله من صفحة التحكم الفنية.` });
  });
  sales.filter((w) => !w.active).forEach((w) => alerts.push({ cls: 'warn', title: `"${w.c.title}" متوقف`, body: `ده معناه: ${w.c.ifBroken}` }));
  const ready = leads.filter((x) => x.status === 'draft');
  if (ready.length >= 10) {
    const oldest = ready.reduce((a, b) => (a.createdAt < b.createdAt ? a : b));
    alerts.push({ cls: 'warn', title: `${ready.length} إيميل جاهزين ومستنيين يتبعتوا`, body: `الإيميلات دي مكتوبة وموجودة كمسودات في Gmail، بس ما بتتبعتش لوحدها: لازم حد يبعتها بإيده. أقدمها مستني من ${fmtDay(oldest.createdAt)}. كل يوم تأخير معناه عملاء ما وصلهمش حاجة.` });
  }
  if (leadsError) alerts.push({ cls: 'warn', title: 'مش قادر أجيب قائمة العملاء', body: leadsError });
  $('alertSection').hidden = alerts.length === 0;
  $('alerts').replaceChildren(...alerts.map((a) => el('li', { class: a.cls }, el('b', {}, a.title), el('p', {}, a.body))));

  // ---------- Verdict ----------
  const broken = alerts.filter((a) => a.cls === 'bad').length;
  const v = $('verdict');
  if (broken) { v.textContent = `فيه ${broken === 1 ? 'نظام واحد وقع' : broken + ' أنظمة وقعت'}. التفاصيل تحت في "محتاج تعرف".`; v.className = 'verdict bad'; }
  else {
    const n = [...sales, ...social].filter((w) => w.active).length;
    v.textContent = `الأنظمة المفعّلة في n8n: ${n.toLocaleString('ar-EG')}. حالة الخدمات الخارجية زي Clay غير متحقّق منها.`;
    v.className = 'verdict';
  }

  // ---------- Numbers ----------
  const sent = leads.filter(wasSent);
  const replied = leads.filter((x) => x.status === 'replied');
  const companies = new Set(leads.map((x) => x.domain || x.company)).size;
  const rate = sent.length ? Math.round((replied.length / sent.length) * 100) : 0;
  const nums = [
    ['شركة', companies, 'لقيناها ومناسبة لينا'],
    ['إيميل جاهز', ready.length + leads.filter((x) => x.status === 'pending').length, 'مكتوب ومستني يتبعت'],
    ['إيميل اتبعت', sent.length, 'وصل للعميل'],
    ['ردّوا', replied.length, sent.length ? `${rate}% من اللي اتبعتلهم` : 'لسه ما اتبعتش حاجة', 'good'],
    ['ما ردّوش', leads.filter((x) => x.status === 'no_reply').length, 'بعد 8 أيام، وبنجرّب حد تاني في شركتهم'],
  ];
  $('nums').replaceChildren(...nums.map(([label, n, sub, cls]) => el('div', { class: 'num ' + (cls || '') }, el('span', { class: 'n' }, n.toLocaleString('ar-EG')), el('b', {}, label), el('small', {}, sub))));

  // ---------- Who replied ----------
  const repliedSorted = replied.slice().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  if (repliedSorted.length) {
    $('replies').replaceChildren(el('ul', { class: 'replies' }, ...repliedSorted.map((x) => el('li', {
      class: 'clickable', tabIndex: 0, onclick: () => openMessage(x), onkeydown: (e) => { if (e.key === 'Enter') openMessage(x); },
    },
      el('div', { class: 'who' }, el('b', {}, x.company), el('span', {}, [x.name, x.title].filter(Boolean).join(' – '))),
      x.replyText ? el('blockquote', { dir: 'auto' }, x.replyText) : null,
      el('small', {}, `${leadState(x).word} · ${fmtDay(x.updatedAt)}`)))));
  } else {
    const waiting = leads.filter((x) => x.status === 'sent');
    const oldest = waiting.filter((x) => x.sentAt).sort((a, b) => (a.sentAt < b.sentAt ? -1 : 1))[0];
    $('replies').replaceChildren(el('p', { class: 'emptybox' },
      sent.length
        ? `لسه محدش ردّ. اتبعت ${sent.length} إيميل، ومستنيين رد ${waiting.length} منهم${oldest ? `، أقدمهم اتبعت ${fmtDay(oldest.sentAt)}` : ''}. أول ما حد يرد هيظهر هنا خلال يوم.`
        : 'لسه ما اتبعتش إيميلات، فمفيش ردود.'));
  }

  // ---------- All leads table ----------
  const groups = [['all', 'الكل'], ['replied', 'ردّوا'], ['waiting', 'مستنيين رد'], ['noreply', 'ما ردّوش'], ['failed', 'رجع / ما اتبعتش'], ['ready', 'جاهز يتبعت']];
  const count = (k) => (k === 'all' ? leads.length : leads.filter((x) => leadState(x).key === k).length);
  $('leadFilters').replaceChildren(...groups.filter(([k]) => k === 'all' || count(k)).map(([k, label]) => el('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(leadFilter === k), textContent: `${label} (${count(k).toLocaleString('ar-EG')})`,
    onclick: () => { leadFilter = k; render(); },
  })));
  const order = { replied: 0, waiting: 1, noreply: 2, failed: 3, ready: 4, other: 5 };
  const rows = leads.map((x) => ({ x, s: leadState(x) }))
    .filter(({ s }) => leadFilter === 'all' || s.key === leadFilter)
    .sort((a, b) => (order[a.s.key] - order[b.s.key]) || String(b.x.sentAt || b.x.createdAt).localeCompare(String(a.x.sentAt || a.x.createdAt)));
  $('leads').replaceChildren(...(rows.length ? rows.map(({ x, s }) => el('tr', {
    class: 'clickable', tabIndex: 0, title: x.status === 'draft' ? 'اعرض الإيميل وابعته' : 'اعرض الإيميل',
    onclick: () => openMessage(x), onkeydown: (e) => { if (e.key === 'Enter') openMessage(x); },
  },
    el('td', { class: 'ltr' }, el('b', {}, x.company), x.industry ? el('small', {}, x.industry) : null),
    el('td', { class: 'ltr' }, x.name || '—', x.title ? el('small', {}, x.title) : null),
    el('td', {}, el('span', { class: 'pill ' + s.cls }, s.word)),
    el('td', { class: 'narrow-hide' }, x.sentAt ? fmtDay(x.sentAt) : '—'))) : [el('tr', {}, el('td', { class: 'empty', colSpan: 4 }, leadsError ? 'القائمة مش متاحة دلوقتي.' : 'مفيش حد هنا.'))]));

  // ---------- System cards ----------
  const card = (w) => {
    const h = health(w);
    return el('article', { class: 'card ' + h.cls },
      el('header', {}, el('span', { class: 'lamp', 'aria-hidden': 'true' }), w.c.step ? el('span', { class: 'step' }, w.c.step.toLocaleString('ar-EG')) : null, el('h4', {}, w.c.title)),
      el('p', { class: 'state' }, h.line),
      el('p', {}, w.c.what),
      w.c.benefit ? el('p', { class: 'gain' }, el('b', {}, 'بنستفيد إيه: '), w.c.benefit) : null,
      h.cls === 'bad' || (h.cls === 'off' && w.c.group === 'sales') ? el('p', { class: 'broken' }, el('b', {}, 'ده معناه دلوقتي: '), w.c.ifBroken) : null,
      h.cls === 'off' && w.c.group !== 'sales' ? el('p', { class: 'muted' }, 'متوقف بقصد، ومش بيأثر على حاجة دلوقتي.') : null);
  };
  $('sales').replaceChildren(...sales.map(card));
  $('social').replaceChildren(...social.map(card));
  $('internalSum').textContent = `أدوات داخلية ونسخ قديمة (${internal.length.toLocaleString('ar-EG')}). مش محتاج تقلق منها`;
  $('internal').replaceChildren(...internal.map((w) => el('li', {}, el('b', {}, w.c.title), w.active ? ' (شغّال)' : ' (متوقف)', w.c.what ? el('span', {}, ' · ' + w.c.what) : null)));
}

// ---------- One email: view, edit, send ----------
// Sending limits are advice, not a block: the person decides, the page warns.
// Above ~20 cold emails a day from one Gmail, or several within minutes, Google starts sending them to spam
// and can limit the account. 30+ a day is where the domain's reputation really gets hurt.
const SEND_SOFT_DAILY = 20;
const SEND_HARD_DAILY = 30;
const SEND_MIN_GAP_MIN = 3;

function toast(msg, isErr = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.className = 'toast'; }, 4000);
}
const cairoDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d);
function sendStats() {
  const today = cairoDay(new Date());
  const sent = leads.filter((x) => x.sentAt && cairoDay(new Date(x.sentAt)) === today);
  const last = sent.reduce((m, x) => Math.max(m, Date.parse(x.sentAt)), 0);
  return { today: sent.length, minsSinceLast: last ? (Date.now() - last) / 60000 : Infinity };
}
function sendWarnings() {
  const s = sendStats();
  const out = [];
  const ar = (n) => n.toLocaleString('ar-EG');
  if (s.today >= SEND_HARD_DAILY) out.push({ level: 'bad', text: `اتبعت النهارده ${ar(s.today)} إيميل. ده كتير جداً على إيميل واحد، وممكن Google يقفل الإرسال أو يحط الإيميلات في الـ spam. الأحسن تكمّل بكرة.` });
  else if (s.today >= SEND_SOFT_DAILY) out.push({ level: 'warn', text: `اتبعت النهارده ${ar(s.today)} إيميل، وده الحد اللي بننصح بيه في اليوم (${ar(SEND_SOFT_DAILY)}). كل إيميل زيادة بيعلّي احتمال إن الإيميلات تروح spam.` });
  if (s.minsSinceLast < SEND_MIN_GAP_MIN) out.push({ level: 'warn', text: `آخر إيميل اتبعت من أقل من ${ar(SEND_MIN_GAP_MIN)} دقايق. لما الإيميلات تتبعت ورا بعض بسرعة بيبان إنها رسايل آلية. استنى شوية بين كل إيميل والتاني.` });
  return { ...s, out };
}
const ERR_WORD = {
  draft_not_found: 'ملقتش المسودة دي في Gmail. غالباً اتبعتت أو اتمسحت من Gmail.',
  not_a_draft: 'الإيميل ده اتبعت قبل كده.',
  lead_not_found: 'الشخص ده مش موجود في القائمة.',
  send_failed: 'Gmail رفض الإرسال. جرّب تاني بعد شوية، ولو فضلت كده كلّم خالد.',
  unauthorized: 'الصفحة مش متوصّلة بـ workflow الإرسال صح. كلّم خالد.',
};
const errText = (m) => ERR_WORD[m] || m;

async function openMessage(x) {
  const dlg = $('msg');
  $('msgWho').textContent = `${x.name || '—'} · ${x.company}`;
  $('msgMeta').textContent = [x.title, leadState(x).word].filter(Boolean).join(' · ');
  $('msgBody').replaceChildren(el('p', { class: 'hint' }, x.status === 'draft' ? 'بجيب الإيميل من Gmail…' : 'بيحمّل…'));
  if (!dlg.open) dlg.showModal();
  let m;
  try { m = await get(`/api/leads/${x.id}/message`); }
  catch (e) { $('msgBody').replaceChildren(el('p', { class: 'warnline bad' }, 'مقدرتش أجيب الإيميل: ' + errText(e.message))); return; }

  const parts = [];
  if (m.replyText) parts.push(el('div', { class: 'replybox' }, el('b', {}, 'ردّه:'), el('blockquote', { dir: 'auto' }, m.replyText)));

  if (!m.canSend) {
    parts.push(
      el('p', { class: 'field' }, el('b', {}, 'إلى: '), el('span', { dir: 'ltr' }, m.to || '—')),
      el('p', { class: 'field' }, el('b', {}, 'الموضوع: '), el('span', { dir: 'auto' }, m.subject || '—')),
      m.sentAt ? el('p', { class: 'field' }, el('b', {}, 'اتبعت: '), fmtWhen(m.sentAt)) : null,
      el('pre', { class: 'mailtext', dir: 'auto' }, m.body || 'نص الإيميل مش متسجل.'));
    $('msgBody').replaceChildren(...parts);
    return;
  }

  const subj = el('input', { type: 'text', value: m.subject, dir: 'auto', 'aria-label': 'الموضوع' });
  const body = el('textarea', { rows: 14, dir: 'auto', 'aria-label': 'نص الإيميل' });
  body.value = m.body;
  const w = sendWarnings();
  const warnBox = w.out.length ? el('div', { class: 'warns' }, ...w.out.map((x) => el('p', { class: 'warnline ' + x.level }, x.text))) : null;
  const counter = el('p', { class: 'hint' }, (w.today ? `اتبعت النهارده ${w.today.toLocaleString('ar-EG')} إيميل.` : 'لسه ما اتبعتش إيميلات النهارده.') + ` الحد المنصوح بيه ${SEND_SOFT_DAILY.toLocaleString('ar-EG')} إيميل في اليوم.`);
  const btn = el('button', { class: 'btn', type: 'button', textContent: 'ابعت الإيميل ده' });
  const edited = () => subj.value.trim() !== m.subject.trim() || body.value.trim() !== m.body.trim();
  const NOTE = 'تقدر تعدّل الموضوع والنص قبل ما تبعت. لوجو فكرة هاوس بيتحط تحت التوقيع لوحده.';
  const editNote = el('p', { class: 'hint' }, NOTE);
  [subj, body].forEach((f) => f.addEventListener('input', () => {
    editNote.textContent = edited() ? 'عدّلت في الإيميل. هيتبعت بالتعديل بتاعك، والمسودة القديمة في Gmail هتتمسح.' : NOTE;
  }));

  btn.addEventListener('click', async () => {
    const now = sendWarnings();
    let q = `هيتبعت الإيميل ده دلوقتي لـ ${m.name || ''} (${m.to}) في ${m.company}.`;
    if (edited()) q += '\nهيتبعت بالتعديلات بتاعتك.';
    if (now.out.length) q += '\n\nتحذير:\n' + now.out.map((x) => '• ' + x.text).join('\n') + '\n\nمتأكد إنك عايز تكمّل؟';
    else q += '\n\nأبعت؟';
    if (!confirm(q)) return;
    btn.disabled = true; btn.textContent = 'بيتبعت…';
    try {
      await fetch(`/api/leads/${x.id}/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subject: subj.value, body: body.value }) })
        .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `Error ${r.status}`); return d; });
      toast(`اتبعت لـ ${m.name || m.to}`);
      $('msg').close();
      x.status = 'sent'; x.sentAt = new Date().toISOString();
      render();
      setTimeout(load, 1500);
    } catch (e) {
      toast('ما اتبعتش: ' + errText(e.message), true);
      btn.disabled = false; btn.textContent = 'ابعت الإيميل ده';
    }
  });

  parts.push(
    el('p', { class: 'field' }, el('b', {}, 'إلى: '), el('span', { dir: 'ltr' }, m.to)),
    el('label', { class: 'lbl' }, 'الموضوع', subj),
    el('label', { class: 'lbl' }, 'النص', body),
    editNote, warnBox, counter,
    el('div', { class: 'msg-actions' }, btn));
  $('msgBody').replaceChildren(...parts);
}

$('refresh').addEventListener('click', load);
load();
setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
