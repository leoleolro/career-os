// Adapter registry. Add a new source by dropping sources/<name>.mjs exporting { name, description, search({query, location, ...}) , details?(job) }
// `search` returns Job[] (normalized). `details` (optional) returns partial fields to merge (description, tags, salary...).
import * as seek from './seek.mjs';
import * as linkedin from './linkedin.mjs';

const registry = [seek, linkedin];

// Optional adapters — loaded if present so a half-built adapter never breaks the hunt.
for (const n of ['phenom', 'workday', 'greenhouse', 'lever', 'ashby', 'oracle-orc', 'smartrecruiters', 'gradconnection', 'mckinsey', 'wagov', 'apsjobs', 'adzuna', 'jooble', 'indeed']) {
  try { const m = await import(`./${n}.mjs`); if (m.search && m.name) registry.push(m); } catch (e) { if (!/Cannot find module|ERR_MODULE_NOT_FOUND/.test(String(e))) console.error(`[sources] ${n} failed to load:`, e.message); }
}

export const sources = registry;
export function getSource(name) { return registry.find((s) => s.name === name); }
