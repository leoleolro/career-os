// APSJobs (apsjobs.gov.au) — Australian Public Service vacancies. The site is a Salesforce Lightning app: job data is not in the HTML,
// so this adapter is a placeholder that points /hunt at the browser check. Verified 2026-09-17 (GET /s/job-search returns the app shell).
export const name = 'apsjobs';
export const description = 'APSJobs (federal government) — browser-only';
export const queryless = true;
export async function search() {
  process.stderr.write('[apsjobs] JS-rendered (Salesforce) — check https://www.apsjobs.gov.au/s/job-search?keyword=<query> in the Browser pane (see /hunt step 1b)\n');
  return [];
}
