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
 * Identify a row by its CONTENT, never by the `id` column.
 *
 * Checking uniqueness on `id` is what let the original bug through: when ids
 * are random they are unique by construction, so such a check can never fail
 * no matter how badly the paging repeats or drops rows.
 */
const rowKey = (r) => [r.model_id, r.source_benchmark_id, r.agent_id, r.ended_at].join('|');

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
  const seen = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const batch = await page(from, from + PAGE_SIZE - 1);
    seen.push(...batch.map(rowKey));
    if (batch.length < PAGE_SIZE) break;
  }
  const unique = new Set(seen).size;
  const dupes = seen.length - unique;
  console.log(`  source rows (sandbox_jobs): ${total}`);
  console.log(`  fetched: ${seen.length}   distinct: ${unique}   duplicates: ${dupes}`);
  check(dupes === 0, 'no duplicated rows across pages', `${dupes} duplicates`);
  // Rows can legitimately be dropped by the view's INNER JOINs (a job whose
  // model/agent/benchmark row is missing), so allow <= but never >.
  check(unique <= total, 'distinct rows do not exceed the source table');
  const coverage = total ? ((unique / total) * 100).toFixed(1) : '0';
  check(unique >= total * 0.95, `coverage is complete`, `${coverage}% of source rows (was ~65% when broken)`);
}

console.log(failed ? '\nFAILED -- paging is unsound; do not trust the leaderboard.\n' : '\nAll checks passed.\n');
process.exit(failed ? 1 : 0);
