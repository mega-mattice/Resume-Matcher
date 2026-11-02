# Resume Matcher

Tailors resumes to job descriptions and tracks the resulting job applications on a Kanban board.

## Language

**Application**:
A tracker card: one tailored resume applied to one job, at a pipeline status.
_Avoid_: Job card, entry

**ATS score**:
A 0–100 composite of how well a tailored resume fits its job (keywords, skills, title, sections, dates).
_Avoid_: Match score, fit score, resume score

**Parse-check score**:
A separate 0–100 measure of how cleanly an ATS can extract text from a resume file. Not the ATS score.
_Avoid_: ATS score

**Score target**:
The ATS score the user aims for while tailoring (default 80, adjustable). A soft nudge: the gap is shown but confirming is never blocked.

**Reachable max**:
The highest ATS score a resume can reach using only content already in the master resume or attested by the user.

**Confirmed score**:
The ATS score a tailored resume had at the moment the user confirmed it. Fixed afterward; the latest ATS score is compared against it ("was X, now Y").

**Starting score**:
The score of an untailored master resume against a job description, using the ATS score formula. Used only to recommend which master to start from; not an ATS score and never a Confirmed score baseline.
_Avoid_: Match score, pre-score
