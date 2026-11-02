# Research: pre-flight master resume scoring

Issue: mega-mattice/Resume-Matcher#3 (parent map #1). Findings only; no design or code changes.
All claims cite code under `apps/backend/app/` at commit d37aa6ad. Latency numbers are estimates, not measurements.

## Question

Can each master resume (max 5) be scored against a JD deterministically before any LLM tailoring run, and how well would that predict the post-tailor ATS score?

## Short answer

- Yes, once the JD keyword dict exists. Scoring is pure Python: no LLM, no I/O.
- The JD keyword dict needs one LLM call (`extract_job_keywords`) the first time a JD is seen. After that it is cached per JD by content hash, so N masters score for free.
- No refactor needed to score a master: the existing scoring functions accept a master dict as-is.
- Pre-score should rank masters well and roughly upper-bound post-tailor keyword score (truthfulness rules). No empirical data exists in the repo to confirm.

## 1. What `compute_ats_score` needs

`services/ats.py::compute_ats_score(refined_resume, job_keywords, keyword_match_percentage, missing_keywords, injectable_keywords)`. Module docstring: "Every component is deterministic (no LLM call)".

| Sub-score (weight) | Inputs | Source |
|---|---|---|
| keyword_match (0.40) | resume text + JD `required_skills`/`preferred_skills`/`keywords` | `refiner.calculate_keyword_match` |
| skills_coverage (0.20) | resume `additional.technicalSkills` + full text vs JD required+preferred skills | `ats._compute_skills_coverage` |
| title_match (0.15) | JD `role` vs `personalInfo.title` (100), summary (75), word overlap (max 50); None if no role | `ats.compute_title_match` |
| section_completeness (0.15) | resume only (contact + summary/experience/education/skills visible) | `ats.compute_section_completeness` |
| date_consistency (0.10) | resume only (`years` fields); None if <2 dates | `ats.compute_date_consistency` |

- Only JD fields `required_skills`, `preferred_skills`, `keywords` and `role` matter. Sections and dates need no JD at all.
- `keyword_match_percentage` is not special: `refiner.calculate_keyword_match(resume, jd_keywords)` = matched distinct terms / total * 100 via `keyword_in_text` (`services/text_match.py`: lowercase, whole-term boundary, CJK substring). Pure function of (resume dict, keyword dict).
- `missing_keywords` / `injectable_keywords` come from `refiner.analyze_keyword_gaps(jd, tailored, master)`. They affect only the returned lists and recommendations, not the numeric overall score.
- Existing wrapper `routers/resumes.py::_score_tailored_data(tailored_data, job_keywords, master_data)` composes all of this. Passing a master as both `tailored_data` and `master_data` works: `injectable` is then always empty and every unmatched term lands in missing. Recommendation wording ("tailored version") would be off for a master (cosmetic).

## 2. Must JD keyword extraction run first?

Yes for keyword_match, skills_coverage, title_match. No deterministic substitute exists in the repo.

- `improver.extract_job_keywords(job_description)` calls `llm.complete_json(..., schema_type="keywords")` with `EXTRACT_KEYWORDS_PROMPT` (`prompts/templates.py`). Output: company, role, required/preferred skills, keywords, requirements, responsibilities, years, seniority.
- Cache: `routers/resumes.py::_cache_job_keywords` stores `job_keywords` + `job_keywords_hash` (sha256 of `job["content"]`) in job metadata via `db.update_job`. `_cached_job_keywords` returns None if missing or hash stale; `_scorable_job_keywords` also rejects dicts with zero terms.
- The cache is written only on the tailoring path (`_improve_preview_flow`, routers/resumes.py ~line 1393; another `extract_job_keywords` call at ~2089). A freshly uploaded job (`routers/jobs.py`, `db.create_jobs`) has no keywords until a tailoring run happens.
- `POST /resumes/{id}/ats-score` returns 409 "The job description has not been analyzed" when the cache is missing. So no existing path scores without a prior tailor run having populated the cache, and that endpoint only accepts tailored resumes (`_tailored_resume_job_link` requires `parent_id`).
- `routers/applications.py::_extract_company_role` calls `extract_job_keywords` for manual-add. Its docstring says "Reuses the cached keyword-extraction pass", but the code calls the extractor directly and neither reads nor writes the job cache; the LLM result is discarded after company/role.
- Extraction is LLM-nondeterministic across fresh calls, but stable per JD once cached by hash. All masters scored against the same JD use the same keyword dict, so they are comparable. Editing the JD invalidates the cache.

## 3. Latency and cost

- LLM: one `complete_json` per new JD (default `max_tokens=4096`, up to 2 app-level retries on malformed/truncated JSON; `llm.py::complete_json`). Prompt = short template + JD; output is a small JSON object. Cost is one short completion per JD regardless of master count (`MAX_MASTER_RESUMES = 5`, database.py). Seconds/tokens depend on provider; not measured.
- Scoring: per master, a text flatten plus (terms x regex search) twice, plus a few regexes for dates/title. Tens of terms x 5 masters is milliseconds in CPython (estimate, not benchmarked).
- DB: `db.list_master_resumes()` returns all masters (oldest first); `get_master_resume()` returns only the default.

## 4. Master vs tailored input differences

- Two text flatteners:
  - `refiner._extract_all_text` (keyword_match): summary, work title/company/description, education, projects, technicalSkills/certs/languages/awards, custom sections. It does not read `personalInfo.title` and ignores `sectionMeta` visibility.
  - `ats._extract_all_text` over `_rendered_content` (skills_coverage, title): all strings minus hidden sections and `sectionMeta`; condensed work entries print only title/company/years.
  keyword_match and skills_coverage can therefore disagree on hidden sections and the headline. Same for master and tailored, so no ranking bias, but worth knowing.
- `_get_original_resume_data(resume)` yields the scoring dict for masters and tailored alike. `_grounding_master_data` already treats a master as its own truth source.

## 5. How well would pre-tailor predict post-tailor?

No empirical evidence in the repo: no tests/evals compare master vs tailored scores, and `docs/agent/` (referenced by `.claude/CLAUDE.md`) does not exist in this checkout. Mechanistic analysis:

- Tailoring is truthfulness-bounded. `refine_resume` injects only `injectable_keywords` (JD terms missing from tailored but present in master text; `analyze_keyword_gaps`). `CRITICAL_TRUTHFULNESS_RULES_TEMPLATE` forbids adding skills not in the original, and `validate_master_alignment` / `fix_alignment_violations` strip fabrications. So post-tailor keyword coverage is roughly bounded by terms the master already contains: pre keyword_match is approximately an upper bound on post keyword_match. Exceptions: terms the LLM legitimately paraphrases into existence, and generic words in `keywords` that match incidentally.
- Direction: post >= pre is expected, since injection recovers master-supported terms the first diff missed. Size of the gap depends on how much of the master the diff omits; not quantified.
- title_match: the recommendation text says tailoring does not change the headline, so pre ~ post for the headline tiers; the summary tier (75) can rise if the rewritten summary includes the role.
- section_completeness, date_consistency: tailoring restores original dates (`_restore_original_dates`, `restore_dates_from_markdown`) and preserves personal info, so these should be near-equal pre and post.
- Net: pre-score should predict the ranking among masters well for the keyword-driven ~75% of weight; absolute post score ~ pre + a gap bounded by injectable terms. Unverified.
- There is no stored master baseline. `RefinementStats.initial_match` is computed on the LLM-diff output just before refinement (resumes.py ~1555), not on the master, so it is not a ground truth for a master pre-score.

## 6. Existing data usable for validation

- `improvements.ats_score` (`db.set_ats_score`, `db.get_ats_scores`) holds tailored scores; the improvement/application rows carry `master_resume_id`. Recomputing each parent master's score against the cached `job_keywords` and comparing would give pre vs post correlation using only existing functions. Local data volume unknown.

## 7. Gaps and notes for the parent map

- GLOSSARY.md defines "ATS score" as for a tailored resume against its job and says avoid "match score / resume score". A score on a master needs a name decision.
- No standalone JD-analysis endpoint exists; `_cache_job_keywords` is only on the tailoring path.
- `_extract_company_role` docstring claims caching that does not exist (section 2).
- Backend tests were not read; not checked whether score functions have tests with master-shaped inputs.

## Files read

`services/ats.py`, `services/refiner.py`, `services/improver.py` (`extract_job_keywords`, `_validate_keyword_result`), `services/text_match.py`, `prompts/templates.py` (`EXTRACT_KEYWORDS_PROMPT`), `routers/resumes.py`, `routers/applications.py`, `database.py`, `llm.py` (`complete_json`), `GLOSSARY.md`, `docs/agents/*`.
