---
name: interview-prep
description: Build an interview pack (predicted questions, STAR answers, technical/case drills) for a job folder, then run mock interviews. Use when the candidate says "interview prep", "prepare me for", "mock interview", "what will they ask", "/interview-prep".
---

# /interview-prep <jobs/<slug>> [mock]

## Inputs
`jobs/<slug>/jd.md`, `jobs/<slug>/resume.md` (the version they submitted), `profile/story-bank.md`, `profile/master-resume.md`, `profile/career-context.md`. If any `[FILL: …]` markers in the story bank matter for this role, ask the candidate for them first — answers must be true.

## 1. Classify the interview
- **Consulting (BCG / Big 4 / boutique):** fit + behavioural (BCG "personal experience interview"), case interview (market sizing, profitability, structure), sometimes a written case. BCG X graduate: add a technical screen (Python/ML/coding challenge) and a case.
- **AI engineer / FDE / solutions:** system design for LLM apps, agent architecture, tool/MCP design, evals, prompt engineering, a coding exercise, customer-facing scenario ("client says the model hallucinates — walk us through").
- **Oracle EPM / ERP consulting:** functional depth (Planning forms, rules, Data Management/EDMCS, Smart View), implementation lifecycle, client-handling.
- **Data / analytics:** SQL, Python/pandas, stats, a take-home.

## 2. Write `jobs/<slug>/interview-prep.md`
1. **Role in one paragraph** — what they will probe, based on the JD's "What you'll bring".
2. **Predicted questions (25–40)** grouped: opener/motivation ("why BCG", "why leave your current employer after ~2 years" — prepare this one carefully), behavioural mapped to their competencies, technical, case/scenario, closing.
3. **STAR answers** for the 8–10 most likely behavioural questions, each drawn from a named story in `story-bank.md`; 90–120 seconds spoken; end with the result and what the candidate learned. Mark anything they must verify.
4. **Technical drill sheet** — 10–15 questions with model answers at the depth of the JD (for BCG X: Python data handling, model selection, overfitting, evaluation metrics, deploying a model; for AI engineer: RAG vs fine-tune, tool-calling loops, context management, evals, guardrails).
5. **Case practice** (consulting only) — 3 mini cases with a framework and a worked answer; one mining/energy case (the candidate's client domain).
6. **Gaps to study before the interview** — ranked, with a 1-line resource each (free).
7. **Questions to ask them** — 6, specific to this team.
8. **Logistics** — format/rounds from the JD or the company's known process, what to bring.

## 3. Mock mode (`mock`)
Ask one question at a time. Wait for the candidate's answer. Score 1–5 on structure / evidence / concision / relevance, give a 3-line improvement, show a tightened version of their answer, then ask the next. After 6–8 questions, summarise patterns and save a short note to `jobs/<slug>/notes.md` with date + weakest areas. Never answer for them unprompted; never invent facts about their experience.
