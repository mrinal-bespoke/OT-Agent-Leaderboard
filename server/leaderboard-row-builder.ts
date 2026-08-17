/**
 * Build leaderboard rows from the BASE TABLES instead of the leaderboard_results view.
 *
 * Why this exists
 * ---------------
 * The view defines row identity as `gen_random_uuid()`, so it has no stable
 * key. Any paged read ordered by that id samples at random rather than paging:
 * measured against production, page 0 fetched twice shared 15/300 rows, and a
 * full read returned 9,204 slots containing only ~5,950 distinct rows -- about
 * 35% of the data missing, changing on every refresh.
 *
 * The view also sits marginally under the statement timeout, so an unbounded
 * read 500s outright and ordered reads fail intermittently under load.
 *
 * Neither problem is fixable from the client, because the view exposes no
 * unique column to page on: 46% of rows tie on (model, benchmark, agent).
 *
 * The base tables have none of these problems. Each has a real primary key, so
 * ORDER BY id is a genuine total order, and none carry the view's join cost.
 * We page them and reconstruct the view's semantics here.
 *
 * This is a TEMPORARY fallback. The real fix is the stable-id view in
 * create_leaderboard_view.sql; it needs database access we do not currently
 * have. Once an owner applies it, set LEADERBOARD_DATA_SOURCE=view and delete
 * this module.
 *
 * The reconstruction below mirrors create_leaderboard_view.sql exactly. If that
 * file changes, this must change with it -- they are two expressions of one
 * contract, and tests/leaderboard-row-builder.test.ts pins it.
 *
 * Pure: no database import, so the mapping can be tested without credentials.
 */

export interface RawLeaderboardRow {
  id: string;
  model_id: string;
  model_name: string;
  model_duplicate_of: string | null;
  canonical_model_name: string;
  base_model_id: string | null;
  base_model_name: string;
  base_model_duplicate_of: string | null;
  canonical_base_model_name: string;
  agent_name: string;
  agent_id: string;
  agent_duplicate_of: string | null;
  canonical_agent_name: string;
  canonical_agent_id: string;
  benchmark_name: string;
  benchmark_id: string;
  benchmark_duplicate_of: string | null;
  canonical_benchmark_name: string;
  source_benchmark_name: string;
  source_benchmark_id: string;
  accuracy: number | null;
  standard_error: number | null;
  hf_traces_link: string | null;
  ended_at: string | null;
  canonical_base_model_id: string | null;
  config: any;
  training_type: string | null;
  model_size_b: number | null;
  job_status: string | null;
  username: string | null;
  slurm_job_id: string | null;
  is_overlong: boolean;
  stats: any;
  n_trials: number | null;
  notes: string | null;
}

export interface JobRow {
  id: string;
  model_id: string | null;
  agent_id: string | null;
  benchmark_id: string | null;
  metrics: any;
  ended_at: string | null;
  started_at: string | null;
  created_at: string | null;
  hf_traces_link: string | null;
  config: any;
  stats: any;
  n_trials: number | null;
  job_status: string | null;
  username: string | null;
  slurm_job_id: string | null;
  is_overlong: boolean | null;
  notes: string | null;
}

export interface ModelRow {
  id: string;
  name: string;
  duplicate_of: string | null;
  base_model_id: string | null;
  agent_id: string | null;
  creation_time: string | null;
  training_type: string | null;
  model_size_b: number | null;
}

export interface NamedRow {
  id: string;
  name: string;
  duplicate_of: string | null;
}

/** Pull `name` from a metrics array entry, scaled to a percentage as the view does. */
function metricPercent(metrics: any, name: string): number | null {
  if (!Array.isArray(metrics)) return null;
  const hit = metrics.find((m) => m && m.name === name);
  if (!hit || typeof hit.value !== 'number') return null;
  return hit.value * 100;
}

/**
 * Reconstruct the view's rows from already-fetched base tables.
 *
 * Exported separately from the fetching so it can be tested without a database.
 */
export function buildRawRows(
  jobs: JobRow[],
  models: ModelRow[],
  agents: NamedRow[],
  benchmarks: NamedRow[],
): { rows: RawLeaderboardRow[]; skipped: number } {
  const modelById = new Map(models.map((m) => [m.id, m]));
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const benchmarkById = new Map(benchmarks.map((b) => [b.id, b]));

  const rows: RawLeaderboardRow[] = [];
  let skipped = 0;

  for (const job of jobs) {
    // The view INNER JOINs models, agents and benchmarks, so a job whose FK
    // does not resolve produces no row. Mirror that rather than inventing one.
    const model = job.model_id ? modelById.get(job.model_id) : undefined;
    const agent = job.agent_id ? agentById.get(job.agent_id) : undefined;
    const benchmark = job.benchmark_id ? benchmarkById.get(job.benchmark_id) : undefined;
    if (!model || !agent || !benchmark) {
      skipped += 1;
      continue;
    }

    // A job counts as finished when it HAS metrics -- matching the view, which
    // splits on `metrics IS NOT NULL` rather than on job_status.
    const isFinished = job.metrics != null;
    const jobTimestamp = isFinished
      ? job.ended_at ?? job.created_at
      : job.started_at ?? job.created_at;

    const canonicalModel = model.duplicate_of ? modelById.get(model.duplicate_of) : undefined;
    const canonicalAgent = agent.duplicate_of ? agentById.get(agent.duplicate_of) : undefined;
    const canonicalBenchmark = benchmark.duplicate_of ? benchmarkById.get(benchmark.duplicate_of) : undefined;

    // Base model resolves either directly or through the canonical model.
    const baseModel = model.base_model_id ? modelById.get(model.base_model_id) : undefined;
    const baseViaCanonical = canonicalModel?.base_model_id
      ? modelById.get(canonicalModel.base_model_id)
      : undefined;

    const baseModelCanonical = baseModel?.duplicate_of ? modelById.get(baseModel.duplicate_of) : undefined;
    const baseViaCanonicalCanonical = baseViaCanonical?.duplicate_of
      ? modelById.get(baseViaCanonical.duplicate_of)
      : undefined;

    const baseModelName = baseModel?.name ?? baseViaCanonical?.name ?? 'None';
    const effectiveBaseModelId = model.base_model_id ?? canonicalModel?.base_model_id ?? null;

    rows.push({
      // Real primary key, not a synthetic one. This is the whole point.
      id: String(job.id),

      model_id: model.id,
      model_name: model.name,
      model_duplicate_of: model.duplicate_of ?? null,
      canonical_model_name: canonicalModel?.name ?? model.name,

      base_model_id: effectiveBaseModelId,
      base_model_name: baseModelName,
      base_model_duplicate_of: baseModel?.duplicate_of ?? baseViaCanonical?.duplicate_of ?? null,
      canonical_base_model_name:
        baseModelCanonical?.name ?? baseViaCanonicalCanonical?.name ?? baseModelName,
      canonical_base_model_id:
        baseModel?.duplicate_of ?? baseViaCanonical?.duplicate_of ?? effectiveBaseModelId,

      agent_name: agent.name,
      agent_id: agent.id,
      agent_duplicate_of: agent.duplicate_of ?? null,
      canonical_agent_name: canonicalAgent?.name ?? agent.name,
      canonical_agent_id: canonicalAgent?.id ?? agent.id,

      // The view reports the CANONICAL benchmark as the primary identity and
      // keeps the source benchmark alongside it.
      benchmark_name: canonicalBenchmark?.name ?? benchmark.name,
      benchmark_id: benchmark.duplicate_of ?? benchmark.id,
      benchmark_duplicate_of: null,
      canonical_benchmark_name: canonicalBenchmark?.name ?? benchmark.name,
      source_benchmark_name: benchmark.name,
      source_benchmark_id: benchmark.id,

      accuracy: isFinished ? metricPercent(job.metrics, 'accuracy') : null,
      standard_error: isFinished ? metricPercent(job.metrics, 'accuracy_stderr') : null,

      hf_traces_link: job.hf_traces_link ?? null,
      ended_at: jobTimestamp ?? null,
      config: job.config ?? null,
      training_type: model.training_type ?? null,
      model_size_b: model.model_size_b ?? baseModel?.model_size_b ?? baseViaCanonical?.model_size_b ?? null,
      job_status: job.job_status == null ? null : String(job.job_status),
      username: job.username ?? null,
      slurm_job_id: job.slurm_job_id ?? null,
      is_overlong: job.is_overlong ?? false,
      stats: job.stats ?? null,
      n_trials: job.n_trials ?? null,
      notes: job.notes ?? null,
    });
  }

  return { rows, skipped };
}
