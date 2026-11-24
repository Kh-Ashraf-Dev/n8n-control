import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { N8N_URL, N8N_API_KEY, DASH_USER, DASH_PASS, PORT = 3000 } = process.env;

const missing = ['N8N_URL', 'N8N_API_KEY', 'DASH_USER', 'DASH_PASS'].filter((k) => !process.env[k]);
if (missing.length) {
  const msg = `Missing settings: ${missing.join(', ')}. Locally: fill them in .env. On Vercel: Project → Settings → Environment Variables, then redeploy.`;
  console.error(msg);
  // Locally, stop. On Vercel, keep the function alive so the page says what's wrong instead of a bare 500.
  if (!process.env.VERCEL) process.exit(1);
}

const app = express();
if (missing.length) app.use((req, res) => res.status(500).type('text/plain; charset=utf-8').send(`Control room is not configured. Missing: ${missing.join(', ')}.`));
const here = path.dirname(fileURLToPath(import.meta.url));
const base = (N8N_URL || '').replace(/\/+$/, '') + '/api/v1';

app.get('/healthz', (req, res) => res.send('ok'));

// ---- Basic auth (constant-time compare) ----
const safeEqual = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};
app.use((req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [user, ...rest] = Buffer.from(encoded, 'base64').toString().split(':');
    if (safeEqual(user, DASH_USER) && safeEqual(rest.join(':'), DASH_PASS)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="n8n control room", charset="UTF-8"');
  res.status(401).send('Login required');
});

app.use(express.json());

// ---- Page files (behind the login above) ----
// Read once at start with literal paths so Vercel bundles them. Not in public/, because Vercel would
// serve public/ from its CDN without the login, and express.static() doesn't run on Vercel.
const PAGES = {
  '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/ops.html': ['ops.html', 'text/html'],
  '/ceo.js': ['ceo.js', 'text/javascript'], '/catalog.js': ['catalog.js', 'text/javascript'],
  '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'],
  '/fekra-house.svg': ['fekra-house.svg', 'image/svg+xml'],
  '/fekra-house-dark.svg': ['fekra-house-dark.svg', 'image/svg+xml'],
  '/fekra-house-tab.svg': ['fekra-house-tab.svg', 'image/svg+xml'],
};
const files = {
  'index.html': fs.readFileSync(new URL('./web/index.html', import.meta.url)),
  'ops.html': fs.readFileSync(new URL('./web/ops.html', import.meta.url)),
  'ceo.js': fs.readFileSync(new URL('./web/ceo.js', import.meta.url)),
  'catalog.js': fs.readFileSync(new URL('./web/catalog.js', import.meta.url)),
  'app.js': fs.readFileSync(new URL('./web/app.js', import.meta.url)),
  'style.css': fs.readFileSync(new URL('./web/style.css', import.meta.url)),
  'fekra-house.svg': fs.readFileSync(new URL('./web/fekra-house.svg', import.meta.url)),
  'fekra-house-dark.svg': fs.readFileSync(new URL('./web/fekra-house-dark.svg', import.meta.url)),
  'fekra-house-tab.svg': fs.readFileSync(new URL('./web/fekra-house-tab.svg', import.meta.url)),
};
const reloadInDev = process.env.NODE_ENV !== 'production' && !process.env.VERCEL;
Object.entries(PAGES).forEach(([route, [file, type]]) => app.get(route, (req, res) => {
  res.type(type + '; charset=utf-8').set('Cache-Control', 'no-cache');
  res.send(reloadInDev ? fs.readFileSync(path.join(here, 'web', file)) : files[file]);
}));

// ---- n8n API helper ----
async function n8n(method, url, body) {
  const r = await fetch(base + url, {
    method,
    headers: { 'X-N8N-API-KEY': N8N_API_KEY, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!r.ok) {
    const err = new Error(data.message || `n8n answered ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return data;
}

// Follow n8n cursors so we get every page.
async function listAll(url, max = 1000) {
  const out = [];
  let cursor;
  do {
    const sep = url.includes('?') ? '&' : '?';
    const page = await n8n('GET', url + (cursor ? `${sep}cursor=${encodeURIComponent(cursor)}` : ''));
    out.push(...(page.data || []));
    cursor = page.nextCursor;
  } while (cursor && out.length < max);
  return out;
}

const wrap = (fn) => async (req, res) => {
  try { res.json(await fn(req)); }
  catch (e) { res.status(e.status && e.status < 500 ? e.status : 502).json({ error: e.message }); }
};

const isId = (s) => /^[A-Za-z0-9_-]{1,64}$/.test(s);

// ---- Routes ----
app.get('/api/overview', wrap(async () => {
  const [workflows, executions] = await Promise.all([
    listAll('/workflows?limit=250'),
    listAll('/executions?limit=250', 250),
  ]);
  return {
    fetchedAt: new Date().toISOString(),
    workflows: workflows.map((w) => ({
      id: w.id, name: w.name, active: w.active, description: w.description || '',
      updatedAt: w.updatedAt, tags: (w.tags || []).map((t) => t.name),
    })),
    executions: executions.map((e) => ({
      id: e.id, workflowId: e.workflowId, status: e.status || (e.finished ? 'success' : 'error'),
      mode: e.mode, startedAt: e.startedAt, stoppedAt: e.stoppedAt,
    })),
  };
}));

// ---- Leads (who we emailed, who replied) from the n8n data table ----
const LEADS_TABLE = process.env.LEADS_TABLE || 'outbound_leads';
let leadsTableId;
async function findLeadsTable() {
  if (leadsTableId) return leadsTableId;
  const tables = await listAll('/data-tables?limit=250');
  const t = tables.find((x) => x.id === LEADS_TABLE || x.name === LEADS_TABLE);
  if (!t) throw Object.assign(new Error(`Data table "${LEADS_TABLE}" not found in n8n`), { status: 404 });
  return (leadsTableId = t.id);
}
const isTestRow = (r) => /^test\b/i.test(r.company_name || '') || /^test row/i.test(r.contact_notes || '');
const clip = (s, n) => (s ? String(s).split(/\n\s*On .+wrote:/)[0].trim().slice(0, n) : '');

app.get('/api/leads', wrap(async () => {
  const id = await findLeadsTable();
  const rows = await listAll(`/data-tables/${id}/rows?limit=250`, 5000);
  return {
    fetchedAt: new Date().toISOString(),
    // Only what the page shows: no email addresses or email bodies leave the server.
    leads: rows.filter((r) => !isTestRow(r)).map((r) => ({
      id: r.id, company: r.company_name, domain: r.company_domain, industry: r.industry, persona: r.persona,
      name: r.contact_name, title: r.contact_title, status: r.status, companyStatus: r.company_status,
      replyCategory: r.reply_category, replyText: clip(r.reply_text, 400), failReason: r.fail_reason,
      sentAt: r.sent_at, seqStep: r.seq_step, createdAt: r.createdAt, updatedAt: r.updatedAt,
    })),
  };
}));

// ---- One email: view it, and send it if it is still a draft ----
// Drafts live in Gmail, so reading and sending them goes through the n8n workflow
// "Control Room – View & Send Draft" (webhook protected by N8N_SEND_SECRET).
const DRAFT_HOOK = process.env.N8N_DRAFT_WEBHOOK || (N8N_URL || '').replace(/\/+$/, '') + '/webhook/control-room-draft';
async function draftHook(payload) {
  if (!process.env.N8N_SEND_SECRET) throw Object.assign(new Error('N8N_SEND_SECRET is missing in .env'), { status: 500 });
  const r = await fetch(DRAFT_HOOK, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-control-secret': process.env.N8N_SEND_SECRET },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.ok) throw Object.assign(new Error(data.error || `n8n answered ${r.status}`), { status: r.status >= 400 && r.status < 500 ? r.status : 502 });
  return data;
}
async function getLeadRow(id) {
  const tableId = await findLeadsTable();
  const rows = await listAll(`/data-tables/${tableId}/rows?limit=250`, 5000);
  const row = rows.find((r) => String(r.id) === String(id));
  if (!row || isTestRow(row)) throw Object.assign(new Error('Lead not found'), { status: 404 });
  return row;
}
const leadId = (req) => {
  if (!/^\d{1,9}$/.test(req.params.id)) throw Object.assign(new Error('Bad lead id'), { status: 400 });
  return Number(req.params.id);
};

app.get('/api/leads/:id/message', wrap(async (req) => {
  const row = await getLeadRow(leadId(req));
  const base = { id: row.id, status: row.status, company: row.company_name, name: row.contact_name, title: row.contact_title,
    replyText: clip(row.reply_text, 2000), sentAt: row.sent_at };
  if (row.status === 'draft') {
    const d = await draftHook({ action: 'get', row_id: row.id });
    return { ...base, to: d.to, subject: d.subject, body: d.text, canSend: true };
  }
  return { ...base, to: row.contact_email, subject: row.email_subject || '', body: row.email_body || '', canSend: false };
}));

app.post('/api/leads/:id/send', wrap(async (req) => {
  const id = leadId(req);
  const { subject, body } = req.body || {};
  if (typeof subject !== 'string' || typeof body !== 'string' || !subject.trim() || body.trim().length < 20) {
    throw Object.assign(new Error('Subject and body are required'), { status: 400 });
  }
  const r = await draftHook({ action: 'send', row_id: id, subject: subject.slice(0, 300), body: body.slice(0, 8000) });
  console.log(`[${new Date().toISOString()}] sent lead ${id}${r.edited ? ' (edited)' : ''} → message ${r.message_id}`);
  return { ok: true, edited: r.edited };
}));

app.post('/api/workflows/:id/:action(activate|deactivate)', wrap(async (req) => {
  if (!isId(req.params.id)) throw Object.assign(new Error('Bad workflow id'), { status: 400 });
  const w = await n8n('POST', `/workflows/${req.params.id}/${req.params.action}`);
  console.log(`[${new Date().toISOString()}] ${req.params.action} ${w.id} "${w.name}"`);
  return { id: w.id, active: w.active };
}));

app.post('/api/executions/:id/retry', wrap(async (req) => {
  if (!isId(req.params.id)) throw Object.assign(new Error('Bad execution id'), { status: 400 });
  const e = await n8n('POST', `/executions/${req.params.id}/retry`, { loadWorkflow: true });
  console.log(`[${new Date().toISOString()}] retry execution ${req.params.id} → ${e.id}`);
  return { id: e.id, status: e.status };
}));

// On Vercel the exported app is the function. Locally and in Docker we listen on a port.
if (!process.env.VERCEL) app.listen(PORT, () => console.log(`Control room on http://localhost:${PORT}  →  ${N8N_URL}`));

export default app;
