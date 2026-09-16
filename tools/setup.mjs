#!/usr/bin/env node
// First-run setup: copies profile/*.example.* to their live names if missing, creates data/ and reports/, runs the offline tests.
import { copyFile, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const pairs = [['profile/preferences.example.json', 'profile/preferences.json'], ['profile/master-resume.example.md', 'profile/master-resume.md'], ['profile/certifications.example.md', 'profile/certifications.md'], ['profile/story-bank.example.md', 'profile/story-bank.md'], ['profile/career-context.example.md', 'profile/career-context.md']];
for (const d of ['data', 'reports', 'jobs', 'inbox', 'profile/study']) await mkdir(ROOT + d, { recursive: true });
for (const [from, to] of pairs) { try { await access(ROOT + to); console.log('exists ', to); } catch { await copyFile(ROOT + from, ROOT + to); console.log('created', to, '← edit me'); } }
const t = spawnSync(process.execPath, [ROOT + 'tools/test.mjs', '--offline'], { stdio: 'inherit' });
console.log(t.status === 0 ? '\nSetup OK. Next: edit profile/preferences.json and profile/master-resume.md, then `npm run hunt`.' : '\nTests failed — see above.');
