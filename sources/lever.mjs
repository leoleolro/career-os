// Lever Postings API — public, no key. Fetches each configured company board ONCE (whole board, descriptions included)
// and filters locally by title (target roles) and location (Australia / remote / APAC unless `anyLocation`).
// Verified 2026-09-12:
//   list : GET https://api.lever.co/v0/postings/{board}?mode=json
//          → [{ id (uuid), text (title), categories:{ location, team, department, commitment, allLocations[] }, country (ISO-2),
//               workplaceType (remote|hybrid|onsite|unspecified), hostedUrl, applyUrl, createdAt (ms epoch),
//               descriptionPlain (opening + body), lists[{text, content(HTML <li>…)}], additionalPlain (closing), salaryRange? }]
//   job  : GET https://api.lever.co/v0/postings/{board}/{id}?mode=json → same shape, one posting (used by details()).
//   Unknown board → 404 {"ok":false,"error":"Document not found"}; an empty board answers 200 [] (e.g. "mistral").
// Boards live in sources/config/ats-companies.json (see its _comment). Responses are cached 30 min by lib/http.mjs.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fetchJson } from '../lib/http.mjs';
import { normalizeJob, stripHtml } from '../lib/schema.mjs';

export const name = 'lever';
export const description = 'Lever job boards (Palantir, Immutable, Deputy, ...) via api.lever.co/v0/postings; boards in sources/config/ats-companies.json';
export const queryless = true;

const CONFIG_PATH = fileURLToPath(new URL('./config/ats-companies.json', import.meta.url));
const PREFS_PATH = fileURLToPath(new URL('../profile/preferences.json', import.meta.url));
const API = 'https://api.lever.co/v0/postings/';
const MAX_DESC = 20000;

// ---------- config + filters (kept in-file so the adapter stays self-contained) ----------
const DEFAULT_TITLE_WORDS = ['engineer', 'consultant', 'analyst', 'scientist', 'solutions', 'forward deployed', 'developer', 'ai', 'llm', 'genai', 'agentic', 'machine learning', 'graduate'];
const DEFAULT_AU = ['australia', 'aus', 'au', 'perth', 'sydney', 'melbourne', 'brisbane', 'adelaide', 'canberra', 'nsw', 'vic', 'wa', 'qld', 'apac', 'anz'];
const DEFAULT_REMOTE_NOISE = ['remote', 'friendly', 'travel', 'required', 'anywhere', 'worldwide', 'global', 'fully', 'hybrid', 'or', 'from', 'in', 'the', 'work', 'home', 'wfh'];
const DEFAULT_REJECT = ['united states', 'usa', 'us', 'united kingdom', 'uk', 'gb', 'london', 'canada', 'europe', 'eu', 'emea', 'india', 'japan', 'singapore', 'new york', 'san francisco', 'seattle', 'washington'];
const REMOTE_RE = /remote|anywhere|work from home|wfh/i;

let configPromise;
async function loadConfig() {
  if (!configPromise) {
    configPromise = (async () => {
      const cfg = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
      const boards = (cfg[name] || []).filter((b) => b && b.board && b.enabled !== false);
      return { boards, filters: cfg.filters || {} };
    })();
  }
  return configPromise;
}

async function loadPrefs(prefs) {
  if (prefs) return prefs;
  try { return JSON.parse(await readFile(PREFS_PATH, 'utf8')); } catch { return {}; }
}

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whole-word/phrase alternation; lookarounds instead of \b so entries like "u.s." or "head," work. */
function wordsRe(list) {
  const items = [...new Set(list.map((w) => String(w || '').toLowerCase().trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  return items.length ? new RegExp(`(?<![a-z0-9])(?:${items.map(esc).join('|')})(?![a-z0-9])`, 'i') : /$^/;
}

/** Title filter derived from prefs.target_roles (whole phrase or head noun) + config title_words, minus senior/exec titles. */
function buildTitleFilter(prefs, filters) {
  const roles = (prefs.target_roles || []).map((r) => String(r).toLowerCase().trim()).filter(Boolean);
  const heads = roles.map((r) => r.split(/\s+/).pop()).filter((w) => w && w.length > 2);
  const keepRe = wordsRe([...roles, ...heads, ...(filters.title_words || DEFAULT_TITLE_WORDS)]);
  const hard = wordsRe(prefs.hard_exclude_titles || []);
  const drop = filters.drop_senior_titles === false ? /$^/ : wordsRe([...(prefs.keywords_penalty || []), ...(filters.drop_title_words || [])]);
  return (title) => keepRe.test(title) && !hard.test(title) && !drop.test(title);
}

/**
 * Location filter over the posting's location parts (one per office). A part passes when it names no rejected place AND
 * either mentions Australia/APAC, or is "bare remote" — remote/anywhere with no other place name once noise words are removed
 * ("Remote", "Remote-Friendly (Travel-Required)", "Remote - Anywhere" pass; "Remote - California", "Remote in the US" do not).
 */
function buildLocationFilter(filters) {
  const loc = filters.location || {};
  const au = wordsRe(loc.au || DEFAULT_AU);
  const reject = wordsRe(loc.reject || DEFAULT_REJECT);
  const auG = new RegExp(au.source, 'gi');
  const noise = new Set((loc.remote_noise || DEFAULT_REMOTE_NOISE).map((w) => String(w).toLowerCase()));
  const bareRemote = (p) => REMOTE_RE.test(p) && p.toLowerCase().replace(auG, ' ').split(/[^a-z]+/).filter((w) => w && !noise.has(w)).length === 0;
  return (parts) => parts.some((p) => p && !reject.test(p) && (au.test(p) || bareRemote(p)));
}

/** hunt.mjs collapses same company+title postings and keeps the FIRST seen — so emit Perth, then other AU/remote, then the rest. */
function localRank(parts, locationOk) {
  if (/perth|western australia/i.test(parts.join(' '))) return 2;
  return locationOk(parts) ? 1 : 0;
}

const WORKPLACE = { remote: 'remote', hybrid: 'hybrid', onsite: 'onsite' };

function salaryText(r) {
  if (!r || (!r.min && !r.max)) return undefined;
  const fmt = (n) => Number(n).toLocaleString('en-AU');
  const range = r.min && r.max ? `${fmt(r.min)}–${fmt(r.max)}` : fmt(r.min || r.max);
  return [r.currency, range, r.interval ? `per ${String(r.interval).replace(/-/g, ' ')}` : ''].filter(Boolean).join(' ');
}

/** Lever splits a posting into opening/body (descriptionPlain), bullet lists and a closing (additionalPlain). */
function fullText(j) {
  const lists = (j.lists || []).map((l) => [l?.text, stripHtml(l?.content || '')].filter(Boolean).join('\n')).filter(Boolean);
  return [j.descriptionPlain || stripHtml(j.description || ''), ...lists, j.additionalPlain || stripHtml(j.additional || '')].filter(Boolean).join('\n\n').slice(0, MAX_DESC);
}

function locationParts(j) {
  const c = j.categories || {};
  const parts = Array.isArray(c.allLocations) && c.allLocations.length ? [...c.allLocations] : [c.location].filter(Boolean);
  const country = String(j.country || '').trim();
  // country is an ISO code ("AU", "US", "GB") — appending it lets the au/reject hints see it
  const remote = String(j.workplaceType).toLowerCase() === 'remote';
  // a remote posting is still tied to its listed places ("Remote - United Kingdom"), so tag each part rather than adding a bare "Remote"
  const tagged = parts.map((p) => `${p}${country ? `, ${country}` : ''}${remote ? ' (Remote)' : ''}`);
  if (!tagged.length && remote) tagged.push(country ? `Remote, ${country}` : 'Remote');
  return { display: parts.join('; '), filter: tagged };
}

function toJob(j, board) {
  const c = j.categories || {};
  const loc = locationParts(j);
  return normalizeJob({
    source: name,
    sourceId: `${board.board}/${j.id}`,
    title: j.text,
    company: board.company || board.board,
    location: loc.display,
    url: j.hostedUrl || `https://jobs.lever.co/${board.board}/${j.id}`,
    applyUrl: j.applyUrl || undefined,
    postedAt: j.createdAt,
    salary: salaryText(j.salaryRange),
    workType: c.commitment || undefined,
    remote: WORKPLACE[String(j.workplaceType || '').toLowerCase()] || undefined,
    description: fullText(j) || undefined,
    tags: [c.department, c.team, c.commitment].filter(Boolean),
    raw: { board: board.board, id: j.id, country: j.country, workplaceType: j.workplaceType, team: c.team, department: c.department, createdAt: j.createdAt },
  });
}

/**
 * search({prefs}) → Job[] across every configured Lever board. `query`/`location` are ignored (queryless).
 * A board that fails logs one stderr line and is skipped; throws only if every board failed.
 */
export async function search({ prefs } = {}) {
  const { boards, filters } = await loadConfig();
  if (!boards.length) { console.error(`[${name}] no boards configured in sources/config/ats-companies.json`); return []; }
  const p = await loadPrefs(prefs);
  const titleOk = buildTitleFilter(p, filters);
  const locationOk = buildLocationFilter(filters);
  const out = []; // [{ rank, job }]
  const summary = [];
  let failed = 0, lastErr;
  for (const board of boards) {
    let jobs;
    try {
      const d = await fetchJson(`${API}${encodeURIComponent(board.board)}?mode=json`, { minGapMs: 1000, cacheTtlMs: 30 * 60 * 1000, timeoutMs: 45000 });
      jobs = Array.isArray(d) ? d : [];
    } catch (e) {
      failed++; lastErr = e;
      console.error(`[${name}] ${board.board}: ${String(e.message).slice(0, 140)}`);
      continue;
    }
    let kept = 0;
    for (const j of jobs) {
      try {
        if (!j?.text || !titleOk(j.text)) continue;
        const rank = localRank(locationParts(j).filter, locationOk);
        if (!board.anyLocation && rank === 0) continue;
        // anyLocation boards (Anthropic, OpenAI) are huge: keep only client-facing / deployment / graduate roles unless the role is in AU/remote
        if (board.anyLocation && rank === 0 && filters.anyLocation_title_re && !new RegExp(filters.anyLocation_title_re, 'i').test(j.title || j.text || '')) continue;
        out.push({ rank, job: toJob(j, board) });
        kept++;
      } catch { /* skip malformed record */ }
    }
    summary.push(`${board.board} ${jobs.length}→${kept}`);
  }
  if (failed && failed === boards.length) throw new Error(`all ${boards.length} Lever boards failed: ${lastErr?.message}`);
  if (summary.length) console.error(`[${name}] ${summary.join(', ')}`);
  return out.sort((a, b) => b.rank - a.rank).map((x) => x.job);
}

/** Full description for one posting via the per-posting endpoint (search() already fills it; this covers records that lack one). */
export async function details(job) {
  const m = String(job.sourceId || '').match(/^([^/]+)\/([0-9a-f-]{20,})$/i);
  if (!m) return {};
  const { boards } = await loadConfig();
  const board = boards.find((b) => b.board === m[1]) || { board: m[1] };
  const j = await fetchJson(`${API}${encodeURIComponent(m[1])}/${m[2]}?mode=json`, { minGapMs: 1000, cacheTtlMs: 24 * 3600 * 1000 });
  if (!j?.id) return {};
  const full = toJob(j, board);
  return { description: full.description, tags: full.tags, salary: full.salary || job.salary, workType: full.workType || job.workType };
}
