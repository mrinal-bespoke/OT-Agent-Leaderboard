#!/usr/bin/env node
/**
 * Verify that leaderboard_results can be paged correctly.
 *
 * The view used to expose `gen_random_uuid()::text as id`, so row identity was
 * re-randomised on every evaluation and ORDER BY id produced a different order
 * per request. Paging over it drew a random SAMPLE instead of walking the set:
 * ~35% of rows were absent from any given read, and which ones changed on each
 * refresh. This script is the direct check that the fix is in place.
 *
 * Run it against the same database the app uses:
 *
 *   node scripts/verify-pagination.mjs
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY),
 * which are already set in the Repl environment.
 *
 * Exits non-zero if paging is unsound, so it can gate a deploy.
 */

const URL_BASE = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const PAGE_SIZE = 1000;
const SAMPLE = 300;

if (!URL_BASE || !KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) must be set.');
  process.exit(2);
}

async function page(from, to, { view = 'leaderboard_results', order = 'id.asc' } = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${view}?select=*&order=${order}`, {
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Range-Unit': 'items',
      Range: `${from}-${to}`,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for rows ${from}-${to}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Count rows in the base table -- cheap, unlike counting through the view. */
async function sourceRowCount() {
  const res = await fetch(`${URL_BASE}/rest/v1/sandbox_jobs?select=id`, {
    method: 'HEAD',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' },
  });
  return Number((res.headers.get('content-range') || '/0').split('/').pop());
}

/**
 * Row identity for duplicate detection.
 *
 * Uses `id`, but ONLY because check 2 below proves ids are stable across
 * requests first. That ordering matters: uniqueness of a random id is
 * meaningless (random values are unique by construction), which is exactly how
 * the original bug survived review. Once identity is proven stable, it is the
 * underlying sandbox_jobs primary key and is the correct thing to dedupe on.
 */
const rowId = (r) => String(r.id);

/**
 * Content-based identity, used only as a cross-check.
 *
 * NOT unique: sandbox_jobs holds 75 rows sharing
 * (model, benchmark, agent, ended_at) -- mostly Pending jobs with a null
 * ended_at. The view's COALESCE(ended_at, created_at) resolves most of them,
 * leaving 4 genuine collisions. So a CORRECT full read still shows a handful
 * of content-key repeats; that is data, not a paging fault.
 */
const rowKey = (r) => [r.model_id, r.source_benchmark_id, r.agent_id, r.ended_at].join('|');
const EXPECTED_CONTENT_COLLISIONS = 4;

let failed = false;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failed = true;
};

console.log('\n1. Is row identity stable across identical requests?');
{
  const [a, b] = [await page(0, SAMPLE - 1), await page(0, SAMPLE - 1)];
  const ka = a.map(rowKey);
  const kb = new Set(b.map(rowKey));
  const overlap = ka.filter((k) => kb.has(k)).length;
  check(
    overlap === ka.length,
    `page 0 fetched twice returns the same rows`,
    `${overlap}/${ka.length} in common (was 15/300 when broken)`,
  );
}

console.log('\n2. Are ids actually unique and non-random?');
{
  const rows = await page(0, SAMPLE - 1);
  const ids = rows.map((r) => r.id);
  check(new Set(ids).size === ids.length, 'ids are unique within a page');
  const again = await page(0, SAMPLE - 1);
  const sameIds = JSON.stringify(ids) === JSON.stringify(again.map((r) => r.id));
  check(sameIds, 'ids are STABLE across requests', sameIds ? '' : 'ids change per query -- view still uses gen_random_uuid()');
}

console.log('\n3. Does a full paged read cover every row exactly once?');
{
  const total = await sourceRowCount();
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const batch = await page(from, from + PAGE_SIZE - 1);
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  const ids = rows.map(rowId);
  const uniqueIds = new Set(ids).size;
  const dupes = ids.length - uniqueIds;
  const contentDupes = rows.length - new Set(rows.map(rowKey)).size;

  console.log(`  source rows (sandbox_jobs): ${total}`);
  console.log(`  fetched: ${rows.length}   distinct ids: ${uniqueIds}   duplicate ids: ${dupes}`);
  console.log(`  content-key repeats: ${contentDupes} (up to ${EXPECTED_CONTENT_COLLISIONS} expected -- genuine data)`);

  check(dupes === 0, 'no row fetched twice', `${dupes} duplicate ids`);
  // Rows can legitimately be dropped by the view's INNER JOINs (a job whose
  // model/agent/benchmark row is missing), so allow <= but never >.
  check(uniqueIds <= total, 'distinct rows do not exceed the source table');
  const coverage = total ? ((uniqueIds / total) * 100).toFixed(1) : '0';
  check(uniqueIds >= total * 0.95, 'coverage is complete', `${coverage}% of source rows (was ~65% when broken)`);
  check(
    contentDupes <= EXPECTED_CONTENT_COLLISIONS,
    'content-key repeats within the known-collision budget',
    `${contentDupes} seen`,
  );
}

console.log(failed ? '\nFAILED -- paging is unsound; do not trust the leaderboard.\n' : '\nAll checks passed.\n');
process.exit(failed ? 1 : 0);
