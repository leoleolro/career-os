// Polite HTTP helper: browser-like headers, per-host pacing, retries with backoff, on-disk cache.
// No dependencies. Node >= 22 (global fetch).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha1 } from './schema.mjs';

const CACHE_DIR = fileURLToPath(new URL('../data/cache/', import.meta.url));
const lastHit = new Map(); // host -> timestamp

export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * fetchText(url, {method, headers, body, minGapMs, retries, cacheTtlMs, timeoutMs})
 * - paces requests per host (default 1200ms between hits)
 * - retries 429/5xx/network errors with exponential backoff
 * - caches GET responses on disk for cacheTtlMs (default 0 = no cache)
 * returns { status, text, headers, fromCache }
 */
export async function fetchText(url, opts = {}) {
  const {
    method = 'GET', headers = {}, body, minGapMs = 1200, retries = 3, cacheTtlMs = 0, timeoutMs = 25000,
  } = opts;
  const host = new URL(url).host;
  const cacheKey = method === 'GET' && cacheTtlMs > 0 ? path.join(CACHE_DIR, sha1(url) + '.json') : null;

  if (cacheKey && existsSync(cacheKey)) {
    try {
      const c = JSON.parse(await readFile(cacheKey, 'utf8'));
      if (Date.now() - c.at < cacheTtlMs) return { status: c.status, text: c.text, headers: c.headers, fromCache: true };
    } catch { /* ignore corrupt cache */ }
  }

  let attempt = 0, lastErr;
  while (attempt <= retries) {
    const gap = minGapMs - (Date.now() - (lastHit.get(host) || 0));
    if (gap > 0) await sleep(gap);
    lastHit.set(host, Date.now());
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: { 'user-agent': UA, 'accept-language': 'en-AU,en;q=0.9', accept: 'application/json, text/html;q=0.9, */*;q=0.8', ...headers },
        body,
        signal: ctrl.signal,
        redirect: 'follow',
      });
      const text = await res.text();
      const hdrs = Object.fromEntries(res.headers.entries());
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const wait = Math.min(30000, 1500 * 2 ** attempt) + Math.floor(Math.random() * 500);
        await sleep(wait); attempt++; continue;
      }
      if (cacheKey && res.ok) {
        await mkdir(CACHE_DIR, { recursive: true });
        await writeFile(cacheKey, JSON.stringify({ at: Date.now(), status: res.status, text, headers: hdrs }));
      }
      return { status: res.status, text, headers: hdrs, fromCache: false };
    } catch (err) {
      lastErr = err;
      if (attempt >= retries) break;
      await sleep(1500 * 2 ** attempt); attempt++;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`fetchText failed for ${url}: ${lastErr?.message || lastErr}`);
}

export async function fetchJson(url, opts = {}) {
  const r = await fetchText(url, { ...opts, headers: { accept: 'application/json', ...(opts.headers || {}) } });
  if (r.status >= 400) throw new Error(`HTTP ${r.status} for ${url}: ${r.text.slice(0, 200)}`);
  try { return JSON.parse(r.text); } catch (e) { throw new Error(`Non-JSON from ${url}: ${r.text.slice(0, 200)}`); }
}
