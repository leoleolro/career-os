---
name: career-path
description: Analyse the candidate's career pathways (3–5 years), skill gaps, certification sequencing, and which live jobs advance which path. Use when the candidate asks "what should I aim for", "career path", "where is this going", "what to learn next", "/career-path".
---

# /career-path

## Inputs
Run `node tools/insights.mjs` first and read `reports/market-insights-<today>.md` — the gap table and years-asked distribution are the evidence base; cite the numbers.
`profile/career-context.md`, `profile/master-resume.md`, `profile/certifications.md`, `profile/achievements.md`, `profile/preferences.json`, `data/jobs.json` (rated jobs), `data/pipeline.json`. Check what the hunt actually surfaced in the last 30 days — the market data beats theory.

## Output: `reports/career-path-<today>.md`
1. **Where the candidate is now** — one honest paragraph: strengths (Oracle EPM + gen-AI at a Big 4, certified, builds agents, public writing), constraints (~2 years experience, Perth market size, generalist vs specialist tension).
2. **Three pathways** (write each with 12 / 36 / 60-month milestones, typical titles + AU salary ranges you can source, and the "signature proof" needed to move up):
   - **A. AI engineering / forward-deployed** (AI-native firms, BCG X, Palantir-style FDE, consultancies' AI teams).
   - **B. Oracle EPM/ERP specialist → solution architect** (current-employer progression, Oracle partners, in-house at miners).
   - **C. Strategy/tech consulting generalist** (BCG/McKinsey/Bain, Big 4 advisory) with an AI edge.
   Plus the hybrid most people in the candidate's position actually take, and what optionality each path preserves.
3. **Gap analysis table** — skill → current evidence → gap → how to close (free resource / work project / cert) → which path it unlocks.
4. **Certification sequence** — EDMCS (booked) → Claude Certified Architect Foundations → then decide (OCI Architect? AWS ML? none — projects may matter more). Give dates relative to today and hours per week.
5. **Portfolio moves** — 2–3 public artefacts that would change how recruiters read them (e.g. an open-source MCP server for Oracle EPM; a written case study of the your current employer gen-AI MVP with client anonymised; talks/posts cadence).
6. **Live roles mapped to paths** — from `data/jobs.json` ratings: which current postings advance which path, and which to ignore even if they're easy to get.
7. **Decision points** — the 2–3 questions only the candidate can answer (stay at the current employer for promotion vs move now; Perth vs relocate; specialist vs generalist) with the trade-offs laid out neutrally.

Keep it under 3 pages. Then ask the candidate which path resonates and update `career-context.md` with their answer.
