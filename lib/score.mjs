// Deterministic pre-score (0-100) so hunt reports rank sensibly BEFORE Claude reads them.
// Claude does the real fit assessment in-session; this just orders the queue and filters noise.
export function prescore(job, prefs) {
  const text = `${job.title} ${job.summary || ''} ${job.description || ''}`.toLowerCase();
  const title = job.title.toLowerCase();
  const reasons = [];
  let s = 30;

  for (const t of prefs.hard_exclude_titles || []) if (title.includes(t.toLowerCase())) return { score: 0, reasons: [`excluded title: ${t}`] };

  // title match against target roles
  let best = 0;
  for (const role of prefs.target_roles || []) {
    const r = role.toLowerCase();
    if (title.includes(r)) best = Math.max(best, 35);
    else {
      const words = r.split(/\s+/).filter((w) => w.length > 2);
      const hit = words.filter((w) => title.includes(w)).length;
      if (words.length && hit / words.length >= 0.6) best = Math.max(best, 18);
    }
  }
  if (best) { s += best; reasons.push(`title~target(+${best})`); }

  // keyword boosts (capped)
  let boost = 0;
  for (const k of prefs.keywords_boost || []) {
    const re = new RegExp(`\\b${k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(text)) boost += title.match(re) ? 4 : 2;
  }
  boost = Math.min(boost, 25);
  if (boost) { s += boost; reasons.push(`keywords(+${boost})`); }

  // seniority penalty
  let pen = 0;
  for (const k of prefs.keywords_penalty || []) {
    const re = new RegExp(`\\b${k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(title)) pen += 15; else if (re.test(text)) pen += 3;
  }
  pen = Math.min(pen, 40);
  if (pen) { s -= pen; reasons.push(`seniority(-${pen})`); }

  // location
  const loc = (job.location || '').toLowerCase();
  const overseas = /\b(us|usa|united states|uk|united kingdom|canada|europe|emea|france|germany|india|singapore|japan|tokyo|london|paris|new york|san francisco|seattle|ontario|dublin|zurich)\b/.test(loc) && !/australia|perth|sydney|melbourne|brisbane|canberra|adelaide/.test(loc);
  const isRemote = !overseas && (job.remote === 'remote' || /remote/.test(loc));
  const primary = (prefs.locations?.primary || []).some((l) => loc.includes(l.toLowerCase().split(' ')[0]));
  const reloc = (prefs.locations?.relocate_for_right_role || []).some((l) => loc.includes(l.toLowerCase().split(' ')[0]));
  if (primary) { s += 10; reasons.push('location:primary(+10)'); }
  else if (isRemote) { s += 6; reasons.push('location:remote(+6)'); }
  else if (reloc) { s += 0; reasons.push('location:relocate(0)'); }
  else if (overseas) { s -= 18; reasons.push('location:overseas(-18)'); }
  else if (loc) { s -= 12; reasons.push('location:other(-12)'); }

  // generic titles (no AI/Oracle/consulting signal in the title itself) sit below specific ones
  const specific = /\b(ai|ml|llm|agent|agentic|generative|gen-?ai|oracle|epm|planning|apex|erp|consultant|consulting|forward deployed|solutions? engineer|data scientist|machine learning)\b/i.test(job.title);
  if (!specific) { s -= 8; reasons.push('generic-title(-8)'); }

  // dream company
  const comp = (job.company || '').toLowerCase();
  if ((prefs.dream_companies || []).some((c) => comp.includes(c.toLowerCase()))) { s += 12; reasons.push('dream-company(+12)'); }

  // years-of-experience asked (first explicit mention) vs the candidate's max comfortable band
  const yrs = yearsAsked(job);
  if (yrs != null) {
    const max = prefs.seniority?.max_years ?? 4;
    // the candidate's rule (2026-09-15): a years line is a preference, not a wall. Only 8+ is treated as a real filter.
    if (yrs >= max + 4) { s -= 18; reasons.push(`asks ${yrs}+yrs(-18)`); }
    else if (yrs > max) { s -= 6; reasons.push(`asks ${yrs}+yrs(-6)`); }
    else if (yrs <= 3) { s += 4; reasons.push(`asks ${yrs}yrs(+4)`); }
  }
  // graduate programs: only worth it while the candidate is inside the window (graduated Dec 2023)
  if (/\bgraduate (program|programme)\b|\b(2026|2027) graduate\b/i.test(job.title) && prefs.candidate?.graduated) {
    const yearsSince = (Date.now() - Date.parse(prefs.candidate.graduated + '-01')) / (365.25 * 86400000);
    if (yearsSince > 3) { s -= 15; reasons.push('grad-window-passed(-15)'); }
  }

  // freshness
  if (job.postedAt) {
    const age = (Date.now() - Date.parse(job.postedAt)) / 86400000;
    if (age <= 3) { s += 5; reasons.push('fresh(+5)'); }
    else if (age > (prefs.max_days_old || 30)) { s -= 10; reasons.push('stale(-10)'); }
  }

  return { score: Math.max(0, Math.min(100, Math.round(s))), reasons };
}

/** First explicit "N+ years" / "N-M years" ask in title+description, or null. Ignores "years" in company-history sentences. */
export function yearsAsked(job) {
  const text = `${job.title} ${job.description || job.summary || ''}`;
  const re = /(\d{1,2})\s*(?:\+|plus)?\s*(?:-|–|to)?\s*(\d{1,2})?\s*\+?\s*(?:years?|yrs?)(?:'|’)?\s*(?:of\s+)?(?:[a-z ,-]{0,40})?(?:experience|exp\b|in\b|as\b|working|delivering|building|hands-on|industry|professional|relevant|commercial|consulting|software|engineering)/gi;
  let m; while ((m = re.exec(text))) {
    const before = text.slice(Math.max(0, m.index - 60), m.index).toLowerCase().split(/[.!?\n]/).pop();
    if (/(founded|established|over the (last|past)|for (over|more than)|celebrat|history|heritage|century|since)/.test(before)) continue;
    const n = Number(m[1]); if (n >= 0 && n <= 25) return n;
  }
  return null;
}

/** Upside 0-100 + priority P1/P2/P3: is this role worth the candidate's effort? (brand/trajectory, interest alignment, pay) — independent of fit. */
export function upside(job, prefs) {
  const pm = prefs.priority_model || {}; const tiers = pm.company_tiers || {}; const it = pm.interest || {};
  const title = job.title.toLowerCase(); const co = (job.company || '').toLowerCase(); const text = `${title} ${co}`;
  const reasons = []; let u = 20;
  const inTier = (list = []) => list.some((c) => co.includes(c.toLowerCase()));
  if (inTier(tiers.tier1)) { u += 45; reasons.push('brand: step up(+45)'); }
  else if (inTier(tiers.tier2)) { u += 20; reasons.push('brand: lateral(+20)'); }
  else if (inTier(tiers.tier3)) { u += 0; reasons.push('brand: step down from Big 4(0)'); }
  else { u -= 5; reasons.push('brand: unknown(-5)'); }
  const hit = (arr = []) => arr.some((re) => new RegExp(re, 'i').test(text));
  if (hit(it.high)) { u += 30; reasons.push('interest:high(+30)'); }
  else if (hit(it.medium)) { u += 12; reasons.push('interest:medium(+12)'); }
  else if (hit(it.low)) { u -= 10; reasons.push('interest:low(-10)'); }
  // pay: stated salary vs current package (if known) or a generic AU consultant band
  const m = `${job.salary || ''} ${job.description || ''}`.match(/\$\s?(\d{2,3})[,.]?(\d{3})?\s?(k|,000)?/i);
  let pay = null; if (m) { pay = Number(m[1] + (m[2] || '')); if (m[3] && /k/i.test(m[3])) pay = Number(m[1]) * 1000; if (m[3] === ',000') pay = Number(m[1]) * 1000; if (pay < 50000 || pay > 400000) pay = null; }
  const base = pm.current_package_aud || 95000;
  if (pay) { if (pay >= base * 1.25) { u += 15; reasons.push(`pay ${pay}(+15)`); } else if (pay >= base * 1.05) { u += 6; reasons.push(`pay ${pay}(+6)`); } else { u -= 8; reasons.push(`pay ${pay}(-8)`); } }
  if (/contract|temp|fixed[- ]term|daily rate/i.test(`${job.workType || ''} ${job.salary || ''} ${title}`)) { u -= 12; reasons.push('contract(-12)'); }
  if (/graduate program/i.test(title) && !inTier(tiers.tier1)) { u -= 10; reasons.push('grad-program pay(-10)'); }
  u = Math.max(0, Math.min(100, Math.round(u)));
  const priority = u >= 70 ? 'P1' : u >= 45 ? 'P2' : 'P3';
  return { upside: u, priority, reasons };
}
