-- Create leaderboard_results view for the leaderboard application
-- Run this in Supabase SQL Editor: Project → SQL Editor → New Query

-- This view returns ALL evaluation results from sandbox_jobs (Finished, Started, Pending)
-- Parses accuracy and accuracy_stderr from the metrics JSONB array for Finished jobs
-- Includes base model and duplicate tracking metadata
-- NO deduplication — the server selects which result to show per (model, agent, benchmark)

-- Drop existing view to recreate with new columns
DROP VIEW IF EXISTS leaderboard_results CASCADE;

CREATE VIEW leaderboard_results AS
WITH finished_jobs AS (
  -- Finished jobs: have metrics with computed accuracy
  SELECT
    sj.*,
    COALESCE(sj.ended_at, sj.created_at) as job_timestamp,
    (SELECT (elem->>'value')::float * 100
     FROM jsonb_array_elements(sj.metrics) elem
     WHERE elem->>'name' = 'accuracy' LIMIT 1) as computed_accuracy,
    (SELECT (elem->>'value')::float * 100
     FROM jsonb_array_elements(sj.metrics) elem
     WHERE elem->>'name' = 'accuracy_stderr' LIMIT 1) as computed_accuracy_stderr
  FROM sandbox_jobs sj
  WHERE sj.metrics IS NOT NULL
),
pending_started_jobs AS (
  -- Pending/Started jobs: no metrics yet
  SELECT
    sj.*,
    COALESCE(sj.started_at, sj.created_at) as job_timestamp,
    NULL::float as computed_accuracy,
    NULL::float as computed_accuracy_stderr
  FROM sandbox_jobs sj
  WHERE sj.metrics IS NULL
),
all_jobs AS (
  SELECT * FROM finished_jobs
  UNION ALL
  SELECT * FROM pending_started_jobs
)
SELECT
  -- STABLE row identity: the underlying sandbox_jobs id, one row per job.
  --
  -- This was gen_random_uuid(), which re-randomised on every evaluation of the
  -- view. Any keyset or LIMIT/OFFSET paging that ordered by it sampled rows at
  -- random instead of paging: requesting page 0 twice returned only 15/300
  -- rows in common, and a full paged read produced 9,204 rows containing just
  -- 5,950 distinct ones. It also made client-side React keys unstable.
  aj.id::text as id,
  m.id as model_id,
  m.name as model_name,
  m.duplicate_of as model_duplicate_of,
  COALESCE(m_canonical.name, m.name) as canonical_model_name,
  COALESCE(m.base_model_id, m_canonical.base_model_id) as base_model_id,
  COALESCE(bm.name, bm_via_canonical.name, 'None') as base_model_name,
  COALESCE(bm.duplicate_of, bm_via_canonical.duplicate_of) as base_model_duplicate_of,
  COALESCE(bm_canonical.name, bm_via_canonical_canonical.name, COALESCE(bm.name, bm_via_canonical.name, 'None')) as canonical_base_model_name,
  a.name as agent_name,
  a.id as agent_id,
  a.duplicate_of as agent_duplicate_of,
  COALESCE(a_canonical.name, a.name) as canonical_agent_name,
  COALESCE(a_canonical.id, a.id) as canonical_agent_id,
  -- Return CANONICAL benchmark name as primary identifier
  COALESCE(b_canonical.name, b.name) as benchmark_name,
  COALESCE(b.duplicate_of, b.id) as benchmark_id,
  -- Always NULL since we return canonical benchmarks (kept for API compatibility)
  NULL::uuid as benchmark_duplicate_of,
  COALESCE(b_canonical.name, b.name) as canonical_benchmark_name,
  -- Track which actual benchmark this result came from
  b.name as source_benchmark_name,
  b.id as source_benchmark_id,
  aj.computed_accuracy as accuracy,
  aj.computed_accuracy_stderr as standard_error,
  aj.hf_traces_link as hf_traces_link,
  aj.job_timestamp as ended_at,
  -- Expose base model resolution fields for server-side base model accuracy computation
  COALESCE(bm.duplicate_of, bm_via_canonical.duplicate_of, COALESCE(m.base_model_id, m_canonical.base_model_id)) as canonical_base_model_id,
  -- Eval config and training type metadata
  aj.config as config,
  m.training_type as training_type,
  -- Fall back to the base model's size when the model itself has no explicit size
  COALESCE(m.model_size_b, bm.model_size_b, bm_via_canonical.model_size_b) as model_size_b,
  -- Job status and user info for progress tracking
  aj.job_status::text as job_status,
  aj.username as username,
  aj.slurm_job_id as slurm_job_id,
  COALESCE(aj.is_overlong, false) as is_overlong,
  aj.stats as stats,
  aj.n_trials as n_trials,
  aj.notes as notes
FROM all_jobs aj
INNER JOIN agents a ON aj.agent_id = a.id
LEFT JOIN agents a_canonical ON a.duplicate_of = a_canonical.id
INNER JOIN models m ON aj.model_id = m.id
INNER JOIN benchmarks b ON aj.benchmark_id = b.id
LEFT JOIN models bm ON m.base_model_id = bm.id
LEFT JOIN models m_canonical ON m.duplicate_of = m_canonical.id
LEFT JOIN models bm_via_canonical ON m_canonical.base_model_id = bm_via_canonical.id
LEFT JOIN models bm_canonical ON bm.duplicate_of = bm_canonical.id
LEFT JOIN models bm_via_canonical_canonical ON bm_via_canonical.duplicate_of = bm_via_canonical_canonical.id
LEFT JOIN benchmarks b_canonical ON b.duplicate_of = b_canonical.id;
-- No ORDER BY in the view: it forces a full sort on every read, including
-- paged reads that immediately re-sort by their own key. Consumers order.

-- Grant read access to the view
-- Adjust the role name based on your Supabase setup
GRANT SELECT ON leaderboard_results TO anon, authenticated;

-- Verify the view was created successfully
SELECT COUNT(*) as total_entries FROM leaderboard_results;
