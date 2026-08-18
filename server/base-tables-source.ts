/**
 * Fetch the base tables and hand them to the row builder.
 *
 * Why this exists
 * ---------------
 * The deployed leaderboard_results view defines row identity as
 * `gen_random_uuid()`, so it has no stable key. Any paged read ordered by that
 * id samples at random rather than paging: measured against production, page 0
 * fetched twice shared 15/300 rows, and a full read returned 9,204 slots
 * holding only ~5,950 distinct rows -- roughly 35% of the data missing, and a
 * different 35% on every refresh.
 *
 * It is not fixable from the client: the view exposes no unique column to page
 * on (46% of rows tie on model+benchmark+agent), and it sits close enough to
 * the statement timeout that ordered reads fail intermittently under load.
 *
 * The base tables have neither problem. Each has a real primary key, so
 * ORDER BY id is a genuine total order and every row is visited exactly once.
 *
 * TEMPORARY. The real fix is the stable-id view in create_leaderboard_view.sql,
 * which needs database access we do not have. Once an owner applies it, set
 * LEADERBOARD_DATA_SOURCE=view and delete this module plus the row builder.
 */

import { supabase } from '@db';
import {
  buildRawRows,
  type JobRow,
  type ModelRow,
  type NamedRow,
  type RawLeaderboardRow,
} from './leaderboard-row-builder';
import { fetchAllKeysetPages } from './keyset-pagination';

const JOB_COLUMNS =
  'id, model_id, agent_id, benchmark_id, metrics, ended_at, started_at, created_at, ' +
  'hf_traces_link, config, stats, n_trials, job_status, username, slurm_job_id, is_overlong, notes';
const MODEL_COLUMNS = 'id, name, duplicate_of, base_model_id, agent_id, creation_time, training_type, model_size_b';
const NAMED_COLUMNS = 'id, name, duplicate_of';

/**
 * Page a plain table by its stored primary key.
 *
 * Ordering by `id` is what makes this sound: it is a real unique column, so
 * A UUID default is generated once when the row is inserted; unlike the
 * leaderboard_results view's gen_random_uuid(), it is persisted and stable
 * across queries. The `id > last_id` cursor also avoids OFFSET's growing scan
 * cost, which timed out on sandbox_jobs at rows 4000-4999 in production.
 *
 * Sequential by design -- concurrent reads against this database contend and
 * push each other past the statement timeout.
 */
async function pageTable<T extends { id: string }>(table: string, columns: string): Promise<T[]> {
  return fetchAllKeysetPages<T>(async (afterId, limit) => {
    let query = supabase
      .from(table)
      .select(columns)
      .order('id', { ascending: true })
      .limit(limit);

    if (afterId !== null) {
      query = query.gt('id', afterId);
    }

    const { data, error } = await query;

    if (error) {
      console.error(`[base-tables] ${table} after id ${afterId ?? '<start>'} failed:`, error);
      throw error;
    }

    return (data ?? []) as unknown as T[];
  });
}

/** Fetch the base tables and reconstruct the leaderboard rows. */
export async function fetchRawRowsFromBaseTables(): Promise<RawLeaderboardRow[]> {
  const started = Date.now();

  const jobs = await pageTable<JobRow>('sandbox_jobs', JOB_COLUMNS);
  const models = await pageTable<ModelRow>('models', MODEL_COLUMNS);
  const agents = await pageTable<NamedRow>('agents', NAMED_COLUMNS);
  const benchmarks = await pageTable<NamedRow>('benchmarks', NAMED_COLUMNS);

  // Ordering by a real primary key cannot repeat a row, so a duplicate here
  // means an assumption broke. Fail loudly rather than silently deduping and
  // serving a quietly incomplete cache -- that is the failure being fixed.
  const distinctIds = new Set(jobs.map((j) => String(j.id))).size;
  if (distinctIds !== jobs.length) {
    throw new Error(
      `[base-tables] sandbox_jobs paged read returned ${jobs.length} rows but ${distinctIds} distinct ids`,
    );
  }

  const { rows, skipped } = buildRawRows(jobs, models, agents, benchmarks);

  console.log(
    `[base-tables] built ${rows.length} rows from ${jobs.length} jobs ` +
      `(${skipped} skipped for unresolved model/agent/benchmark) in ${Date.now() - started}ms`,
  );

  return rows;
}
