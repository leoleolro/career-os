#!/usr/bin/env node
// Career OS pipeline tracker — CLI over data/pipeline.json (the candidate's applications), via lib/store.mjs.
//
//   node tools/track.mjs list [--status shortlisted] [--json]
//   node tools/track.mjs add <jobId|url> --status shortlisted|applied|screening|interview|offer|closed
//                            [--company X --title Y --url U --note N --due YYYY-MM-DD --next "action" --folder jobs/<slug>]
//   node tools/track.mjs move <id> <status> [--note N --due YYYY-MM-DD --next "action"]
//   node tools/track.mjs note <id> "text"
//   node tools/track.mjs due                     follow-ups due today / overdue / this week
//   node tools/track.mjs remove <id>             drop a record (does not touch data/jobs.json)
//   node tools/track.mjs seed                    add the BCG target roles if missing (idempotent)
//
// Record shape (data/pipeline.json → applications[]):
//   { id, jobId?, company, title, url, status, history:[{at,status,note}], notes:[{at,text}], nextAction?, dueDate?, folder? }
// <id> for move/note/remove may be the record id, its jobId, or a unique prefix/substring of the id.
// When jobId exists in data/jobs.json the job's `status` is kept in sync (mergeJobs preserves it across hunts).
import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPipeline, savePipeline, loadJobs, saveJobs } from '../lib/store.mjs';
import { canonicalUrl } from '../lib/schema.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const STATUSES = ['shortlisted', 'applied', 'screening', 'interview', 'offer', 'closed'];
const DUE_SOON_DAYS = 7;

// Seed targets: the two BCG roles already researched under jobs/ (ids follow sources/phenom.mjs: `phenom:<site>-<jobId>`).
export const SEED = [
  {
    jobId: 'phenom:bcg-57792', company: 'BCG', title: 'Generalist Junior Consultant and Consultants, Perth',
    url: 'https://careers.bcg.com/global/en/job/57792/Generalist-Junior-Consultant-and-Consultants-Perth',
    folder: 'jobs/bcg-57792-junior-consultant-perth', status: 'shortlisted',
    note: 'Seeded from jobs/bcg-57792-junior-consultant-perth/jd.md (experienced-hire portal; JD asks 3+ yrs, level decided at interview)',
    nextAction: 'Tailor resume + cover letter (/tailor jobs/bcg-57792-junior-consultant-perth)',
  },
  {
    jobId: 'phenom:bcg-56601', company: 'BCG', title: 'Forward Deployed AI Scientist — Consulting (Graduate), BCG X',
    url: 'https://careers.bcg.com/global/en/job/56601/Forward-Deployed-AI-Scientist-Consulting-Graduate-BCG-X',
    folder: 'jobs/bcg-56601-fde-ai-scientist-grad-bcgx', status: 'shortlisted',
    note: 'Seeded from jobs/bcg-56601-fde-ai-scientist-grad-bcgx/jd.md (student portal; CV + cover letter + transcript in ONE PDF)',
    nextAction: 'Confirm sports/hobbies for extra-curricular criterion, then /tailor',
  },
];

// ---------- helpers ----------
const nowIso = () => new Date().toISOString();
/** Local calendar date (Perth), not UTC — due dates are human dates. */
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDays(iso, n) { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return localDate(d); }
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
const isUrl = (s) => /^https?:\/\//i.test(String(s || ''));
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(Date.parse(s));

function parseArgs(argv) {
  const pos = [], opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) { opts[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const k = a.slice(2), next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { opts[k] = next; i++; } else opts[k] = true;
    } else pos.push(a);
  }
  return { pos, opts };
}

function assertStatus(s) {
  const v = String(s || '').toLowerCase();
  if (!STATUSES.includes(v)) throw new Error(`status must be one of ${STATUSES.join('|')} (got "${s}")`);
  return v;
}
function assertDate(s) {
  if (s === undefined || s === true) return undefined;
  if (!isDate(s)) throw new Error(`--due must be YYYY-MM-DD (got "${s}")`);
  return s;
}

/** Resolve a user-supplied id: exact id → jobId → unique prefix/substring. */
export function resolveApp(pipeline, key) {
  const apps = pipeline.applications;
  const k = String(key || '').trim();
  if (!k) throw new Error('missing <id>');
  let hit = apps.find((a) => a.id === k) || apps.find((a) => a.jobId === k);
  if (hit) return hit;
  const lk = k.toLowerCase();
  const cands = apps.filter((a) => a.id.toLowerCase().startsWith(lk));
  const subs = cands.length ? cands : apps.filter((a) => a.id.toLowerCase().includes(lk));
  if (subs.length === 1) return subs[0];
  if (subs.length > 1) throw new Error(`"${k}" is ambiguous: ${subs.map((a) => a.id).join(', ')}`);
  throw new Error(`no application matches "${k}" — try: node tools/track.mjs list`);
}

function uniqueId(pipeline, base) {
  const taken = new Set(pipeline.applications.map((a) => a.id));
  let id = base || 'application', n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
}

/** Find jobs/<slug> whose name carries the source id (e.g. "bcg-57792" → jobs/bcg-57792-junior-consultant-perth). */
async function findFolder(jobId, sourceId) {
  const dir = path.join(ROOT, 'jobs');
  if (!existsSync(dir)) return undefined;
  const names = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  const keys = [...new Set([sourceId, String(jobId || '').split(':').slice(1).join(':')].filter(Boolean).map((s) => String(s).toLowerCase()))];
  const hit = names.find((n) => { const ln = n.toLowerCase(); return keys.some((k) => ln === k || ln.startsWith(`${k}-`) || (k.length >= 5 && ln.includes(k))); });
  return hit ? `jobs/${hit}` : undefined;
}

/** Keep data/jobs.json in step: returns true when the job exists there. */
async function syncJobStatus(jobId, status) {
  if (!jobId) return false;
  const db = await loadJobs();
  const job = db.jobs?.[jobId];
  if (!job) return false;
  if (job.status !== status) { job.status = status; await saveJobs(db); }
  return true;
}

/** Bucket follow-ups relative to `today` (local date). Shared with tools/dashboard.mjs. */
export function dueBuckets(apps, today = localDate(), soonDays = DUE_SOON_DAYS) {
  const soonEnd = addDays(today, soonDays);
  const out = { overdue: [], today: [], soon: [], later: [], undated: [] };
  for (const a of apps) {
    if (a.status === 'closed') continue;
    if (a.dueDate) {
      if (a.dueDate < today) out.overdue.push(a);
      else if (a.dueDate === today) out.today.push(a);
      else if (a.dueDate <= soonEnd) out.soon.push(a);
      else out.later.push(a);
    } else if (a.nextAction) out.undated.push(a);
  }
  for (const k of ['overdue', 'today', 'soon', 'later']) out[k].sort((x, y) => x.dueDate.localeCompare(y.dueDate) || x.company.localeCompare(y.company));
  return out;
}

const STATUS_RANK = Object.fromEntries(STATUSES.map((s, i) => [s, i]));
const sortApps = (apps) => [...apps].sort((a, b) => (STATUS_RANK[a.status] ?? 99) - (STATUS_RANK[b.status] ?? 99) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.company.localeCompare(b.company));

function table(rows, cols) {
  const width = process.stdout.isTTY ? Math.max(80, process.stdout.columns || 120) : Infinity; // no truncation when piped
  const cut = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const widths = cols.map((c) => Math.min(c.max, Math.max(c.label.length, ...rows.map((r) => String(r[c.key] ?? '').length))));
  const line = (vals) => vals.map((v, i) => cut(v, widths[i]).padEnd(widths[i])).join('  ').slice(0, width).trimEnd();
  const out = [line(cols.map((c) => c.label)), line(widths.map((w) => '-'.repeat(w)))];
  for (const r of rows) out.push(line(cols.map((c) => r[c.key] ?? '')));
  return out.join('\n');
}

const lastNote = (a) => a.notes?.length ? (a.notes[a.notes.length - 1].text ?? a.notes[a.notes.length - 1]) : '';

// ---------- commands ----------
export async function cmdList(pipeline, { status, json }) {
  let apps = sortApps(pipeline.applications);
  if (status && status !== true) { const s = assertStatus(status); apps = apps.filter((a) => a.status === s); }
  if (json) return JSON.stringify(apps, null, 2);
  if (!apps.length) return status ? `No applications with status "${status}".` : 'Pipeline is empty. Add one:\n  node tools/track.mjs add <jobId|url> --status shortlisted --company X --title Y';
  const rows = apps.map((a) => ({ id: a.id, status: a.status, company: a.company, title: a.title, due: a.dueDate || '', next: a.nextAction || '', folder: a.folder || '' }));
  const counts = STATUSES.map((s) => `${s} ${pipeline.applications.filter((a) => a.status === s).length}`).join(' · ');
  return `${table(rows, [
    { key: 'id', label: 'ID', max: 40 }, { key: 'status', label: 'STATUS', max: 11 }, { key: 'company', label: 'COMPANY', max: 22 },
    { key: 'title', label: 'TITLE', max: 44 }, { key: 'due', label: 'DUE', max: 10 }, { key: 'next', label: 'NEXT ACTION', max: 40 }, { key: 'folder', label: 'FOLDER', max: 48 },
  ])}\n\n${apps.length} shown · ${counts}`;
}

export async function cmdAdd(pipeline, pos, opts) {
  const key = pos[0];
  if (!key) throw new Error('usage: add <jobId|url> --status <status> [--company --title --url --note --due --next --folder]');
  const status = assertStatus(opts.status || 'shortlisted');
  const dueDate = assertDate(opts.due);
  const db = await loadJobs();
  let job, jobId, url;
  if (isUrl(key)) {
    url = canonicalUrl(key);
    job = Object.values(db.jobs || {}).find((j) => canonicalUrl(j.url) === url || (j.applyUrl && canonicalUrl(j.applyUrl) === url));
    jobId = job?.id;
  } else {
    jobId = key;
    job = db.jobs?.[jobId];
    url = job?.url || (isUrl(opts.url) ? canonicalUrl(opts.url) : '');
  }
  if (isUrl(opts.url)) url = canonicalUrl(opts.url);
  const dup = pipeline.applications.find((a) => (jobId && a.jobId === jobId) || (url && a.url === url));
  if (dup) throw new Error(`already tracked as "${dup.id}" (${dup.status}) — use: move ${dup.id} <status>`);

  const company = (opts.company && opts.company !== true ? opts.company : job?.company) || '(unknown company)';
  const title = opts.title && opts.title !== true ? opts.title : job?.title;
  if (!title) throw new Error(`"${key}" is not in data/jobs.json — pass --title (and --company, --url) to track it anyway`);
  const folder = opts.folder && opts.folder !== true ? String(opts.folder).replace(/\/+$/, '') : await findFolder(jobId, job?.sourceId);
  const id = uniqueId(pipeline, folder ? path.basename(folder) : slug(`${company} ${title}`));
  const at = nowIso();
  const note = opts.note && opts.note !== true ? String(opts.note) : '';
  const app = {
    id, jobId: jobId || undefined, company, title, url: url || '', status,
    history: [{ at, status, note: note || 'added' }],
    notes: note ? [{ at, text: note }] : [],
    nextAction: opts.next && opts.next !== true ? String(opts.next) : undefined,
    dueDate, folder,
    createdAt: at, updatedAt: at,
  };
  if (!app.url) process.stderr.write(`  warning: no URL known for ${id} — pass --url to record one\n`);
  pipeline.applications.push(app);
  await savePipeline(pipeline);
  const synced = await syncJobStatus(jobId, status);
  return `added ${id} [${status}] ${company} — ${title}${folder ? ` · ${folder}` : ''}${synced ? ' · data/jobs.json status updated' : jobId ? ' · (jobId not in data/jobs.json)' : ''}`;
}

export async function cmdMove(pipeline, pos, opts) {
  const [key, statusArg] = pos;
  if (!key || !statusArg) throw new Error('usage: move <id> <status> [--note N --due YYYY-MM-DD --next "action"]');
  const app = resolveApp(pipeline, key);
  const status = assertStatus(statusArg);
  const dueDate = assertDate(opts.due);
  const at = nowIso();
  const note = opts.note && opts.note !== true ? String(opts.note) : '';
  const from = app.status;
  app.status = status;
  app.history.push({ at, status, note: note || (from === status ? 'touched' : `${from} → ${status}`) });
  if (note) app.notes.push({ at, text: note });
  if (dueDate) app.dueDate = dueDate;
  if (opts.next && opts.next !== true) app.nextAction = String(opts.next);
  if (status === 'closed' && !(opts.next && opts.next !== true)) app.nextAction = undefined;
  app.updatedAt = at;
  await savePipeline(pipeline);
  const synced = await syncJobStatus(app.jobId, status);
  return `moved ${app.id}: ${from} → ${status}${dueDate ? ` · due ${dueDate}` : ''}${app.nextAction ? ` · next: ${app.nextAction}` : ''}${synced ? ' · data/jobs.json status updated' : ''}`;
}

export async function cmdNote(pipeline, pos) {
  const [key, ...rest] = pos;
  const text = rest.join(' ').trim();
  if (!key || !text) throw new Error('usage: note <id> "text"');
  const app = resolveApp(pipeline, key);
  const at = nowIso();
  app.notes.push({ at, text });
  app.updatedAt = at;
  await savePipeline(pipeline);
  return `noted on ${app.id} (${app.notes.length} notes): ${text}`;
}

export async function cmdDue(pipeline, { json }) {
  const today = localDate();
  const b = dueBuckets(pipeline.applications, today);
  if (json) return JSON.stringify({ today, ...b }, null, 2);
  const fmt = (a) => `  ${a.dueDate || '          '}  ${a.id.padEnd(40).slice(0, 40)}  ${a.status.padEnd(11)} ${a.company} — ${a.title}${a.nextAction ? `\n              → ${a.nextAction}` : ''}`;
  const section = (label, arr) => (arr.length ? `${label} (${arr.length})\n${arr.map(fmt).join('\n')}` : '');
  const parts = [
    section('OVERDUE', b.overdue), section('DUE TODAY', b.today), section(`DUE WITHIN ${DUE_SOON_DAYS} DAYS`, b.soon),
    section('LATER', b.later), section('NO DATE (next action set)', b.undated),
  ].filter(Boolean);
  return parts.length ? `Follow-ups as of ${today}\n\n${parts.join('\n\n')}` : `Nothing due as of ${today}. Set one with: move <id> <status> --due YYYY-MM-DD --next "action"`;
}

export async function cmdRemove(pipeline, pos) {
  const app = resolveApp(pipeline, pos[0]);
  pipeline.applications = pipeline.applications.filter((a) => a !== app);
  await savePipeline(pipeline);
  return `removed ${app.id} (${app.status}) — data/jobs.json untouched`;
}

export async function cmdSeed(pipeline) {
  const out = [];
  for (const s of SEED) {
    if (pipeline.applications.some((a) => a.jobId === s.jobId || a.url === s.url)) { out.push(`skip ${s.jobId} (already tracked)`); continue; }
    const at = nowIso();
    const id = uniqueId(pipeline, path.basename(s.folder));
    pipeline.applications.push({
      id, jobId: s.jobId, company: s.company, title: s.title, url: s.url, status: s.status,
      history: [{ at, status: s.status, note: 'seeded' }], notes: [{ at, text: s.note }],
      nextAction: s.nextAction, dueDate: undefined, folder: s.folder, createdAt: at, updatedAt: at,
    });
    await syncJobStatus(s.jobId, s.status);
    out.push(`seeded ${id} [${s.status}]`);
  }
  await savePipeline(pipeline);
  return out.join('\n');
}

const USAGE = `Career OS pipeline tracker — data/pipeline.json
  list [--status X] [--json]      show applications
  add <jobId|url> --status X      track a job (options: --company --title --url --note --due YYYY-MM-DD --next "action" --folder jobs/<slug>)
  move <id> <status> [--note ...] change status (also --due, --next)
  note <id> "text"                append a note
  due [--json]                    follow-ups due / overdue / this week
  remove <id>                     drop a record
  seed                            add the BCG target roles if missing
Statuses: ${STATUSES.join(' → ')}`;

export async function main(argv = process.argv.slice(2)) {
  const { pos, opts } = parseArgs(argv);
  const cmd = pos.shift();
  if (!cmd || cmd === 'help' || opts.help) return USAGE;
  const pipeline = await loadPipeline();
  if (!Array.isArray(pipeline.applications)) pipeline.applications = [];
  switch (cmd) {
    case 'list': case 'ls': return cmdList(pipeline, opts);
    case 'add': return cmdAdd(pipeline, pos, opts);
    case 'move': case 'mv': return cmdMove(pipeline, pos, opts);
    case 'note': return cmdNote(pipeline, pos);
    case 'due': return cmdDue(pipeline, opts);
    case 'remove': case 'rm': return cmdRemove(pipeline, pos);
    case 'seed': return cmdSeed(pipeline);
    default: throw new Error(`unknown command "${cmd}"\n${USAGE}`);
  }
}

// Run only when invoked directly (dashboard.mjs imports the helpers above).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(await main());
  } catch (e) {
    console.error(`track: ${e.message}`);
    process.exit(1);
  }
}
