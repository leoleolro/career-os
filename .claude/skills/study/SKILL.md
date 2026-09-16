---
name: study
description: Quiz the candidate for a certification exam from a question bank, grade, explain, and track weak topics. Use when the candidate says "study", "quiz me", "practice exam", "EDMCS", "Oracle exam", "Claude architect exam", "/study".
---

# /study [bank | topic] [n]

## Banks
- `profile/study/<exam>-question-bank.txt` — practice questions with `[x]`-marked answers.
- EDMCS (Enterprise Data Management) — no bank yet. Ask the candidate to drop one in `inbox/` (docx/pdf/txt → convert with `textutil -convert txt` or pypdf) and move it to `profile/study/`. Until then, generate questions from the official exam topics (WebSearch "Oracle Enterprise Data Management 2025 Implementation Professional exam topics" and cite the page) — label them as generated, not official.
- Claude Certified Architect – Foundations — domains: Agentic Architecture 27%, Claude Code Workflows 20%, Prompt Engineering 20%, Tool Design & MCP 18%, Context Management 15%. Generate scenario questions at that weighting; ground answers in the Claude docs (WebFetch docs.claude.com) rather than memory when unsure.

## Session
1. Ask n (default 10) questions **one at a time**, exam wording, options A–E, never show the `[x]` marks. Multi-select questions say "choose N".
2. After each answer: correct/incorrect, the right answer, a 2–4 line explanation of *why* (and why the distractors are wrong).
3. End: score, list of missed topics, and append to `data/study.json`: `{date, bank, asked, correct, weakTopics:[…]}` (create the file if missing). Next session, start with the weak topics.
4. Offer a 5-minute "teach-back": the candidate explains a weak topic in their own words; you correct gently.

Don't pad with trivia; exam-style only. If a bank question is malformed or its marked answer looks wrong, say so rather than teaching an error.
