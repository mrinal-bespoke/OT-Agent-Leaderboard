-- Views for the NON-AGENTIC (standard) eval leaderboard tabs.
--
-- ORDER MATTERS. Run this in the Supabase SQL Editor AFTER
-- create_leaderboard_view.sql, and RE-RUN IT EVERY TIME that file is applied.
--
-- These views select FROM leaderboard_results, and create_leaderboard_view.sql
-- begins with `DROP VIEW IF EXISTS leaderboard_results CASCADE`. CASCADE drops
-- dependants, so re-applying the base view silently deletes both views below.
-- Nothing errors -- the tabs just start returning "relation does not exist".
-- This file is idempotent, so re-running it is always safe.
--
-- Report templates come from the Marin Eval Policy
-- (marin-community/marin#7958), which defines three:
--
--   Math    : scale | mix | stage | model | MATH500 | AIME24(mean/std) | gsm8k | notes
--   NLP     : model | params | MMLU | HellaSwag | ARC-c | ARC-e | PIQA | WinoGrande
--             | OBQA | BoolQ | TruthfulQA | LAMBADA | TriviaQA | NQ | DROP | template
--   Agentic : model | SWE-100 | dev_set_v2 | tb2 | ID mean | ID SE | traces
--
-- Agentic is already served by `leaderboard_results`. These add the other two.
--
-- Design note: these deliberately reuse the SAME underlying tables
-- (sandbox_jobs / models / agents / benchmarks) rather than introducing a
-- parallel schema. Model canonicalisation and duplicate resolution are
-- non-trivial and must not be forked -- a model deduped in one tab and not
-- another would silently disagree with itself across tabs.
--
-- They are filtered PROJECTIONS of the same base view, so a benchmark belongs
-- to exactly one tab and math scores can never leak into the agentic table.

-- ---------------------------------------------------------------------------
-- Benchmark families
-- ---------------------------------------------------------------------------
-- Membership is by CANONICAL benchmark name, matching how leaderboard_results
-- already resolves duplicate benchmark rows. Adding a benchmark to a tab is a
-- one-line change here; a benchmark absent from every family appears in no
-- standard tab, which is the safe default.

DROP VIEW IF EXISTS math_leaderboard_results CASCADE;

CREATE VIEW math_leaderboard_results AS
SELECT *
FROM leaderboard_results
WHERE canonical_benchmark_name IN (
  'MATH500',
  'AIME24',
  'gsm8k'
);

GRANT SELECT ON math_leaderboard_results TO anon, authenticated;


DROP VIEW IF EXISTS nlp_leaderboard_results CASCADE;

CREATE VIEW nlp_leaderboard_results AS
SELECT *
FROM leaderboard_results
WHERE canonical_benchmark_name IN (
  'mmlu',
  'hellaswag',
  'arc_challenge',
  'arc_easy',
  'piqa',
  'winogrande',
  'openbookqa',
  'boolq',
  'truthfulqa_mc2',
  'lambada_openai',
  'triviaqa',
  'nq_open',
  'drop'
);

GRANT SELECT ON nlp_leaderboard_results TO anon, authenticated;


-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
-- Both are expected to return 0 until the importer lands: no non-agentic eval
-- currently writes to this database. A 0 here means "no data yet", NOT a
-- broken view -- check the benchmark names below before assuming otherwise.

SELECT 'math' AS tab, COUNT(*) AS rows FROM math_leaderboard_results
UNION ALL
SELECT 'nlp',  COUNT(*) FROM nlp_leaderboard_results
UNION ALL
SELECT 'agentic', COUNT(*) FROM leaderboard_results;

-- Which benchmark names actually exist, so family membership above can be
-- reconciled against reality rather than against the policy document. If a
-- standard benchmark is registered under a different spelling, fix the family
-- list rather than the data.
SELECT
  COALESCE(bc.name, b.name) AS canonical_benchmark_name,
  COUNT(*)                  AS job_count
FROM sandbox_jobs sj
JOIN benchmarks b ON sj.benchmark_id = b.id
LEFT JOIN benchmarks bc ON b.duplicate_of = bc.id
GROUP BY 1
ORDER BY 2 DESC;
