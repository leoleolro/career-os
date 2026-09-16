#!/usr/bin/env node
// Smoke tests: schema/score/dedupe unit checks + one --dry query per adapter with a timeout. Run: npm test  (network required for adapters; pass --offline to skip them)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeJob, dedupeKey, normalizeCompany, stripHtml, closingDate } from '../lib/schema.mjs';
import { prescore, yearsAsked } from '../lib/score.mjs';
import { sources } from '../sources/index.mjs';
import { readFile } from 'node:fs/promises';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const prefs = JSON.parse(await readFile(ROOT + 'profile/preferences.json', 'utf8'));
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('FAIL:', msg); } };

// unit
const j = normalizeJob({ source: 't', sourceId: '1', title: '  AI  Engineer ', company: 'Acme Pty Ltd', url: 'https://x.com/j/1?utm_source=a&refId=b', location: 'Perth WA', postedAt: '2026-09-01T10:00:00Z', description: '<p>Hello<br>World &amp; co</p>' });
ok(j.id === 't:1' && j.title === 'AI Engineer' && j.url === 'https://x.com/j/1' && j.postedAt === '2026-09-01' && j.description.includes('Hello\nWorld & co'), 'normalizeJob basics');
ok(normalizeCompany('Boston Consulting Group (BCG)') === 'bcg' && normalizeCompany('BCG') === 'bcg' && normalizeCompany('Amazon Web Services (AWS)') === 'aws', 'company aliasing');
ok(dedupeKey({ company: 'BCG', title: 'FDE (Graduate)', location: 'Perth, WA' }) === dedupeKey({ company: 'Boston Consulting Group (BCG)', title: 'FDE (Graduate)', location: 'Perth, Western Australia' }), 'dedupeKey cross-source');
ok(yearsAsked({ title: '', description: 'Founded 35 years ago. You will have 3-5 years experience in analytics' }) === 3, 'yearsAsked ignores company history');
ok(yearsAsked({ title: '', description: 'no experience needed' }) === null, 'yearsAsked null');
const hi = prescore({ title: 'AI Engineer', company: 'BCG', location: 'Perth WA', summary: 'python agentic', postedAt: new Date().toISOString() }, prefs).score;
const lo = prescore({ title: 'Senior AI Engineering Manager', company: 'X', location: 'San Francisco, CA', summary: '', description: '10+ years of experience' }, prefs).score;
ok(hi > 80 && lo < 40, `prescore ordering (hi=${hi}, lo=${lo})`);
ok(stripHtml('<li>a</li><li>b</li>').includes('• a'), 'stripHtml bullets');
ok(closingDate('Applications close 30 September 2026') === '2026-09-30' && closingDate('Closing date: 3/10/2026') === '2026-10-03' && closingDate('nothing') === undefined, 'closingDate');

// adapters (network)
if (!process.argv.includes('--offline')) {
  for (const s of sources) {
    const args = ['hunt.mjs', '--dry', '--source', s.name, '--query', 'AI', '--location', 'Perth WA', '--limit', '3', '--source-timeout', '90000'];
    const out = await new Promise((res) => { const p = spawn(process.execPath, args, { cwd: ROOT }); let o = ''; p.stdout.on('data', (d) => (o += d)); p.on('close', (code) => res({ code, o })); setTimeout(() => { p.kill(); res({ code: -1, o }); }, 100000); });
    let parsed = null; try { parsed = JSON.parse(out.o.slice(out.o.indexOf('{'))); } catch { /* */ }
    const expectEmpty = ['adzuna', 'indeed', 'mckinsey', 'apsjobs'].includes(s.name);
    ok(parsed && (expectEmpty || parsed.fetched > 0) && parsed.errors.length === 0, `adapter ${s.name} (${parsed ? `${parsed.fetched} fetched, ${parsed.errors.length} errors` : 'no JSON'})`);
    console.error(`  ${s.name}: ${parsed ? parsed.fetched : '?'} fetched`);
  }
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
