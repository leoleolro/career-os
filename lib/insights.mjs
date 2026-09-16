// Shared market-insights computation over data/jobs.json. Used by tools/insights.mjs (markdown) and tools/dashboard.mjs (charts).
import { yearsAsked } from './score.mjs';

export function computeInsights(jobs, prefs, master) {
  jobs = jobs.filter((j) => (j.prescore ?? 1) > 0); // hard-excluded titles (sales/recruitment 'consultants' etc.) carry prescore 0
  // Geography comes from preferences.json: locations.primary[0] is the home city; locations.country_regex / city_regex override the Australian defaults.
  const HOME = String(prefs.locations?.primary?.[0] || 'Perth').split(/[ ,]/)[0].toLowerCase();
  const AU = new RegExp(prefs.locations?.country_regex || 'perth|sydney|melbourne|brisbane|canberra|adelaide|hobart|darwin|australia|\\bwa\\b|\\bnsw\\b|\\bvic\\b|\\bqld\\b', 'i');
  const CITY = new RegExp(prefs.locations?.city_regex || 'perth|sydney|melbourne|brisbane|canberra|adelaide|hobart|darwin', 'i');
  const city = (l) => (l.match(CITY) || ['other'])[0].toLowerCase();
  const FAMILIES = [
    ['Forward deployed engineer', /forward[- ]deployed/i],
    ['AI / ML / LLM engineer', /\b(ai|ml|llm|genai|generative ai|machine learning|agentic)\b.*\bengineer|\bengineer\b.*\b(ai|ml|llm)\b|applied ai/i],
    ['AI / data consultant', /\b(ai|data)\b.*consult|consult.*\b(ai|data)\b/i],
    ['Solutions engineer / architect', /solutions? (engineer|architect)/i],
    ['Data scientist', /data scien/i],
    ['Business / systems analyst', /business analyst|systems analyst|ict business/i],
    ['Oracle / EPM / ERP', /\boracle\b|\bepm\b|epbcs|edmcs|hyperion|netsuite|\berp\b/i],
    ['Graduate program', /graduate (program|programme)|\bgraduate\b/i],
    ['Generalist consultant', /\b(junior |graduate |associate )?consultant\b/i],
  ];
  const TECH = {
    Python: /\bpython\b/i, TypeScript: /typescript|\bnode(\.js)?\b|\breact\b/i, Java: /\bjava\b(?!script)/i, SQL: /\bsql\b/i, 'C#/.NET': /\bc#|\.net\b/i,
    AWS: /\baws\b|amazon web services/i, 'AWS Bedrock': /bedrock/i, Azure: /\bazure\b/i, 'Azure OpenAI / AI Foundry': /azure openai|ai foundry|azure ai/i, GCP: /\bgcp\b|google cloud|vertex/i, OCI: /oracle cloud infrastructure|\boci\b/i,
    'OpenAI / GPT': /openai|\bgpt/i, 'Anthropic / Claude': /anthropic|\bclaude\b/i, Gemini: /\bgemini\b/i, Copilot: /copilot/i,
    'RAG / vector search': /\brag\b|retrieval[- ]augmented|vector (db|database|store|search)|embedding/i, 'Agents / tool calling': /\bagents?\b|agentic|tool[- ]calling|function calling/i, MCP: /model context protocol|\bmcp\b/i,
    'LangChain / LlamaIndex': /langchain|langgraph|llamaindex|llama index/i, 'Evals / guardrails': /\bevals?\b|evaluation framework|guardrail|hallucination/i, 'Prompt engineering': /prompt engineering|prompting/i,
    'MLOps / LLMOps': /mlops|llmops|ci\/cd|mlflow/i, Kubernetes: /kubernetes|\bk8s\b|docker/i, Databricks: /databricks/i, Snowflake: /snowflake/i, 'Power BI': /power ?bi/i, Tableau: /tableau/i, 'Excel modelling': /financial model|excel/i,
    PyTorch: /pytorch|torch\b/i, TensorFlow: /tensorflow|keras/i, 'scikit-learn / pandas': /scikit|sklearn|pandas|numpy/i, 'Computer vision': /computer vision|\bcv\b|image processing/i, NLP: /\bnlp\b|natural language/i,
    'Oracle EPM / Planning': /oracle epm|epbcs|oracle planning|hyperion|\bepm\b/i, 'Oracle ERP / Fusion': /oracle (erp|fusion|cloud erp)|\bfusion\b/i, 'Oracle APEX': /\bapex\b/i, 'SAP': /\bsap\b/i, 'Anaplan / Workday Adaptive': /anaplan|adaptive (planning|insights)|workday/i, 'Power Platform': /power platform|power apps|power automate/i, 'n8n / automation': /\bn8n\b|zapier|automation workflow/i,
    'Security clearance': /security clearance|baseline clearance|nv1|nv2|agsva/i, 'Mining / resources': /\bmining\b|resources sector|\biron ore\b|oil (and|&) gas|\bbhp\b|\brio tinto\b|fortescue/i, 'Consulting background': /consulting|consultancy|big ?4|big four/i, 'Stakeholder / workshops': /stakeholder|workshop/i,
  };
  const CERTS = { 'AWS certification': /aws certif/i, 'Azure certification': /azure (certif|fundamentals|ai-\d{3})|az-\d{3}/i, 'Oracle certification': /oracle certif/i, 'Google Cloud certification': /google cloud certif|gcp certif/i, 'CA/CPA': /\bca\b|\bcpa\b/i, 'PMP / Prince2 / Agile certs': /pmp|prince2|scrum master|safe\b/i };
  const HAS = { // what master-resume.md already evidences (keys of TECH)
    Python: /python/, TypeScript: /react|javascript/, Java: /\bjava\b/, SQL: /\bsql\b/, AWS: /aws/, Azure: /azure/, OCI: /oracle cloud infrastructure/, 'OpenAI / GPT': /gpt/, 'Anthropic / Claude': /claude/, 'Agents / tool calling': /agent/, MCP: /mcp|model context protocol/, 'Prompt engineering': /prompt engineering/, 'Power BI': /power bi/, 'Excel modelling': /excel/, PyTorch: /pytorch/, 'Oracle EPM / Planning': /oracle epm|planning/, 'Oracle ERP / Fusion': /oracle erp|fusion/, 'Oracle APEX': /apex/, SAP: /sap/, 'n8n / automation': /n8n/, 'Mining / resources': /mining/, 'Consulting background': /consult/, 'Stakeholder / workshops': /stakeholder|workshop/, 'Evals / guardrails': /governance/, 'RAG / vector search': /$^/, 'MLOps / LLMOps': /$^/, Kubernetes: /$^/, 'AWS Bedrock': /$^/, 'Azure OpenAI / AI Foundry': /$^/, 'LangChain / LlamaIndex': /$^/, 'scikit-learn / pandas': /$^/, 'Computer vision': /$^/, NLP: /$^/, Databricks: /$^/, Snowflake: /snowflake/, Tableau: /$^/, GCP: /$^/, Gemini: /$^/, Copilot: /$^/, TensorFlow: /$^/, 'C#/.NET': /$^/, 'Anaplan / Workday Adaptive': /$^/, 'Power Platform': /$^/, 'Security clearance': /$^/ };

  const au = jobs.filter((j) => AU.test(j.location));
  const family = (j) => FAMILIES.find(([, re]) => re.test(j.title))?.[0] || 'other';
  const isAiRole = (j) => ['Forward deployed engineer', 'AI / ML / LLM engineer', 'AI / data consultant', 'Solutions engineer / architect', 'Data scientist'].includes(family(j));
  const aiAu = au.filter(isAiRole);
  const aiPerth = aiAu.filter((j) => city(j.location) === HOME);
  const withDesc = (arr) => arr.filter((j) => j.description);

  const count = (arr, fn) => { const c = {}; for (const x of arr) { const k = fn(x); if (k == null) continue; c[k] = (c[k] || 0) + 1; } return Object.entries(c).sort((a, b) => b[1] - a[1]); };
  const pct = (n, d) => (d ? Math.round((100 * n) / d) : 0);
  const techFreq = (arr) => Object.entries(TECH).map(([k, re]) => [k, arr.filter((j) => re.test(`${j.title} ${j.description}`)).length]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]);
  const salary = (j) => { const m = `${j.salary || ''} ${j.description || ''}`.match(/\$\s?(\d{2,3})[,.]?(\d{3})?\s?(k|,000)?/i); if (!m) return null; let v = Number(m[1] + (m[2] || '')); if (m[3] && /k/i.test(m[3])) v = Number(m[1]) * 1000; if (m[3] === ',000') v = Number(m[1]) * 1000; return v >= 60000 && v <= 400000 ? v : null; };

  const familiesAu = count(au, family);
  const familiesPerth = count(au.filter((j) => city(j.location) === HOME), family);
  const aiByCity = count(aiAu, (j) => city(j.location));
  const yrsAi = count(withDesc(aiAu), (j) => { const y = yearsAsked(j); return y == null ? null : y <= 2 ? '0–2' : y <= 4 ? '3–4' : y <= 7 ? '5–7' : '8+'; });
  const yrsPerthAi = count(withDesc(aiPerth), (j) => { const y = yearsAsked(j); return y == null ? null : y <= 2 ? '0–2' : y <= 4 ? '3–4' : y <= 7 ? '5–7' : '8+'; });
  const techAi = techFreq(withDesc(aiAu));
  const techPerthAi = techFreq(withDesc(aiPerth));
  const certsAi = Object.entries(CERTS).map(([k, re]) => [k, withDesc(aiAu).filter((j) => re.test(j.description)).length]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]);
  const workType = count(aiAu, (j) => /contract|temp|fixed/i.test(`${j.workType || ''} ${j.title}`) ? 'contract / fixed-term' : /full time|permanent/i.test(j.workType || '') ? 'permanent / full-time' : null);
  const salaries = aiAu.map(salary).filter(Boolean).sort((a, b) => a - b);
  const med = (a) => (a.length ? a[Math.floor(a.length / 2)] : null);
  const topCosPerthAi = count(aiPerth, (j) => j.company).slice(0, 15);
  const oracleAu = au.filter((j) => /\boracle\b|\bepm\b|epbcs|edmcs|hyperion|netsuite/i.test(`${j.title} ${j.summary || ''} ${j.description || ''}`));
  const oracleCos = count(oracleAu, (j) => j.company).slice(0, 12);
  const grads = au.filter((j) => family(j) === 'Graduate program' && /2027/.test(`${j.title} ${j.summary || ''}`));
  const gaps = techAi.filter(([k]) => HAS[k] && !HAS[k].test(master)).slice(0, 12);
  const rated = count(jobs.filter((j) => j.rating), (j) => j.rating);

  const n = withDesc(aiAu).length, np = withDesc(aiPerth).length;
  return { HOME, au, aiAu, aiPerth, n, np, familiesAu, familiesPerth, aiByCity, yrsAi, yrsPerthAi, techAi, techPerthAi, certsAi, workType, salaries, med, topCosPerthAi, oracleAu, oracleCos, grads, gaps, rated, HAS, pct, family, isAiRole, city };
}
