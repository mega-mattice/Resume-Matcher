# Research: applying fixes to a pending preview

Issue #2 (map #1). Findings only, no design. Sources: code in `apps/backend/app`, `apps/frontend`. Paths relative to repo root; line numbers at commit d37aa6ad.

Note: `docs/agent/` (referenced by AGENTS.md/CLAUDE.md) does not exist in this checkout; only `docs/agents/` (`domain.md`, `issue-tracker.md`). No prose docs on the preview pipeline were available, so code is the only source.

## 1. How apply-keywords works today

`apps/backend/app/routers/resumes.py:1742` `apply_keywords_endpoint`:

1. Takes `preview_id` + the client's current `improved_data` (`schemas/writing.py:58` `ApplyKeywordsRequest`).
2. Rejects (409) unless the stored preview matches source id and job id, is unclaimed (`result_resume_id is None`), unexpired, and `preview["payload_hash"] == _hash_improved_data(current)` (:1760-1769).
3. Provenance check: each keyword must be in the job's keyword set, and either in the master text (`keyword_in_text(term, master_text)`) or sent with `attested: true` (:1786-1796; `ForcedKeyword.attested`, `schemas/writing.py:51`).
4. LLM placement via `force_keywords` (`services/keyword_forcing.py`), then `finalize_ai_resume(source, forced, allow_appended_rows=True)` (:1811).
5. Registers a NEW preview via `db.register_preview`, reusing the old `source_hash`/`job_hash`/`improvements`/`source_data` (:1818-1830); `PreviewConflictError` -> 409 if master or job changed. Returns new `preview_id`, re-scored `ats_score`, `keyword_placements`, `forced_keywords`.
6. Nothing is persisted until `/improve/confirm`.

Frontend: `apps/frontend/lib/api/resume.ts:293` `applyKeywords`; `app/(default)/tailor/page.tsx:377` `handleApplyKeywords` replaces `pendingResult` and tracks `forcedKeywords` and `masterSkillsToAdd` (attested + "add to master"), sent at confirm (`page.tsx:253-254`) as `forced_keywords` / `master_skills_to_add` (`schemas/models.py:866-869`).

## 2. preview_hash and confirm re-validation

- `_hash_improved_data` (`resumes.py:263`): canonicalizes through `ResumeData` (fills defaults), NFC-normalizes, sorted-key JSON, sha256. The hash covers the ENTIRE `ResumeData`, including `personalInfo` and `sectionMeta`.
- `claim_preview` (`resumes.py:1888`) requires the posted `improved_data` hash to equal the registered `payload_hash`. A client cannot edit the preview locally and confirm; any change needs a server round trip that calls `register_preview` with the new hash (the apply-keywords pattern). The hash does not record who or what edited.
- Confirm (`resumes.py:1905-1925`), after claiming:
  1. `original = claim.source_data or _get_original_resume_data(resume)`.
  2. `finalize_ai_resume(original, improved_data, allow_appended_rows=True)` must `model_dump()`-equal `improved_data`, else 400 "Registered preview no longer satisfies preservation rules".
  3. `_validate_confirm_payload` (:688): `personalInfo` must equal original field by field (`_normalize_personal_info_value`), then `validate_confirmed_resume`.

## 3. Headline and personalInfo

- Headline = `ResumeData.personalInfo.title` (`schemas/models.py:424`; read by `services/ats.py:188` `compute_title_match`: 100 for exact posting role in headline, 75 if only in visible summary, up to 50 for word overlap).
- `finalize_ai_resume` unconditionally sets `result["personalInfo"] = deepcopy(source["personalInfo"])` (`services/resume_preservation.py:532`). `_preserve_personal_info` (`resumes.py:573`) does the same earlier; AI prompts also exclude personalInfo (`prompts/templates.py:251` etc.).
- Consequence: an edited `personalInfo.title` in a preview (a) is overwritten back to the source headline by `finalize_ai_resume`, including inside `apply_keywords_endpoint` itself (:1811); (b) if it reached confirm, fails the finalize-equality check (step 2) and the explicit `personalInfo fields changed: title` check (step 3). Three layers block it. The `ats.py` recommendation text already says "tailoring does not change it" (:300-304).
- "Source" for comparison is `claim.source_data` (set only when bullet selection ran, `resumes.py:1620`) else the source resume's structured data (the master for master-to-tailored previews).

## 4. Provenance (attested vs master-sourced)

- Only keywords have provenance. Master-sourced = `keyword_in_text` over `_extract_all_text(master)`, master = `_grounding_master_data(resume)` (:334). Attested = request flag `attested`, enforced server-side per keyword. Persisted: `forced_keywords` (flat string list on the job link, `db.complete_preview(forced_keywords=...)`) and `master_skills_to_add` (`_add_master_skills`). `forced_keywords` also feed interview prep and the Builder "forced" highlight (`resume-builder.tsx:659,2176`).
- Stored provenance does not record field/path, fix kind, or attested vs master-sourced. Placements (`keyword_placements`) are returned per apply but held client-side only.
- Nothing exists for a headline attest: no request field, storage, or validation. Title match compares against the job's `role` (from analyzed job keywords, `_scorable_job_keywords`), not a master-resume fact. A "master-sourced" test for a title would be a new notion (e.g. role appears in master job titles); the code has none.
- `validate_confirmed_resume` skips the extras check for `additional.technicalSkills` only, so attested skills can be added without tripping validation; other `additional` lists reject extras.

## 5. Date normalization

- Score: `compute_date_consistency` (`ats.py:224`) collects each visible entry's `years` string (workExperience, education, personalProjects, visible customSections items; `_collect_date_strings`), classifies via `_DATE_PATTERN` (iso `2020-05`, numeric `05/2020`, name_year `May 2020`, name_short_year `May '20`, bare year); score = dominant-style share. "Present"/"Current" ignored; fewer than 2 dates -> None. Only English month names are recognized (`ats.py:56-58` comment).
- `years` is a protected field (`_PROTECTED_FIELDS`, `resume_preservation.py:21`): `_merge_entries` overwrites it from source (:391-395); `validate_confirmed_resume` flags `*.identity` if it differs. A changed date string is reverted by finalize or rejected at confirm.
- Determinism: a pure string transform is feasible for the four month/year styles (month name <-> number is lossless; patterns are month-year only, so no day/month-first ambiguity). Unsafe or undefined: non-English month names (read as bare year), bare years mixed with month dates (cannot invent a month; collapsing to year loses data), free-text ranges (`Summer 2019`), and the rule for choosing the target style. Open question for the spec.

## 6. Section unhide

- Visibility: `sectionMeta[].isVisible` (`ats.py:101` `_is_section_visible`). Hidden sections score as absent and are dropped from `_rendered_content`. `compute_section_completeness` (:243) counts a section only if it has content AND is visible; unhide cannot add missing content.
- `finalize_ai_resume` copies `sectionMeta` from source (`resume_preservation.py:549-550`), reverting any unhide in a preview. `validate_confirmed_resume` does not check `sectionMeta`, but finalize-equality (confirm step 2) would still reject a changed one.
- Unhide is deterministic (flip a boolean for a key) and adds no new facts. Side effect: changes what renders/exports; the user hid it deliberately in the master.

## 7. Saved resumes (Builder) vs previews

- Preview: ephemeral server row (`register_preview`, TTL `settings.preview_ttl_seconds`), hash-bound, single-claim, re-validated against source on confirm; score returned inline on each preview/apply response. The fix loop exists only here, only for keywords.
- Saved resume: `PATCH /resumes/{id}` (`resumes.py:2381`) takes full `ResumeData` and stores it with NO preservation, personalInfo or hash checks. Headline (`components/builder/forms/personal-info-form.tsx`), dates and section visibility are freely editable.
- Score for saved: `GET/POST /resumes/{id}/ats-score` (`resumes.py:3073,3081`) recomputes deterministically from saved data + cached job keywords (409 if the job was not analyzed; master via `_grounding_master_data`) and stores via `db.set_ats_score`. Builder panel (`components/builder/ats-score-panel.tsx`) recalculates on demand and waits for saved edits. Only tailored resumes (with `parent_id` + improvement link) qualify; masters get 400.
- So the same fix (e.g. headline) is a trivial PATCH + rescore on a saved resume but blocked on a preview by sections 3, 5, 6. Confirm (`complete_preview`) is where a preview becomes a saved resume; it also stores the initial `ats_score` and creates a tracker application.

## 8. Constraints the spec must resolve

1. Headline, `years`, `sectionMeta` are each force-reset by `finalize_ai_resume` and rejected at confirm; a preview fix needs a defined exception to those rules, or the fix applies post-confirm.
2. Any preview edit must go through a server endpoint that registers a new hash (apply-keywords pattern).
3. Provenance is keyword-only and flat; no headline attest, no per-fix record.
4. Date normalization is deterministic only for recognized English month styles; target-style rule undefined.
5. Unhide is deterministic but only helps when content exists.
6. Saved-resume path has no guards; score recompute already exists.
7. Not verified: whether `_matching_source_index` depends on `years`; whether `claim.source_data` equals the dict `finalize` uses for tailored-from-tailored previews.
