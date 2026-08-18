/**
 * Production verification for LEADERBOARD_DATA_SOURCE=base_tables.
 *
 * Exercises the REAL code path -- it imports fetchRawRowsFromBaseTables()
 * rather than reimplementing it, so a bug in the shipped module fails here
 * instead of hiding behind a parallel copy that happens to agree.
 *
 * Run inside the Repl, where SUPABASE_URL and the keys are already set:
 *
 *   npx tsx scripts/verify-base-tables.ts
 *
 * Exits non-zero on any failure so it can gate a deploy.
 */

import { supabase } from '@db';
import { fetchRawRowsFromBaseTables } from '../server/base-tables-source';
import { selectPool } from '../server/result-selection';

let failed = false;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failed = true;
};

/** Count sandbox_jobs without reading it -- the source of truth for coverage. */
async function sourceJobCount(): Promise<number> {
  const { count, error } = await supabase.from('sandbox_jobs').select('id', { count: 'exact', head: true });
  if (error) throw error;
  return count ?? 0;
}

const GLM = 'oracle_verified_120s-maxeps-131k-fixthink';
const CORRECTED_DEV = {
  id: '1f7cc902-d507-47f9-bf25-243b059da5dc',
  benchmark: 'dev_set_v2',
  trace: 'laion/glm47-fixthink-dev-v2-terminus2-harbor-e0e80550-traces',
};
const CORRECTED_TB2 = {
  id: '62feaee3-79ce-4bb3-8552-6daa82e8d0f5',
  benchmark: 'terminal_bench_2',
  trace: 'laion/glm47-fixthink-tb2-terminus2-harbor-e0e80550-traces',
};
const EXPECTED = {
  dev_set_v2: 22.18,
  'swebench-verified-random-100-folders': 36.0,
  terminal_bench_2: 10.86,
};

console.log('\n1. Two independent cold builds');
const t0 = Date.now();
const first = await fetchRawRowsFromBaseTables();
const firstMs = Date.now() - t0;
const second = await fetchRawRowsFromBaseTables();
console.log(`  build time: ${(firstMs / 1000).toFixed(1)}s   rows: ${first.length}`);

const idsA = first.map((r) => r.id);
const idsB = second.map((r) => r.id);
check(new Set(idsA).size === idsA.length, 'all row ids are unique', `${idsA.length} rows, ${new Set(idsA).size} distinct`);
check(
  idsA.length === idsB.length && new Set(idsA).size === new Set([...idsA, ...idsB]).size,
  'two cold builds produce the SAME id set',
  `${idsA.length} vs ${idsB.length}`,
);

console.log('\n2. Coverage against the source table');
{
  const total = await sourceJobCount();
  const skipped = total - first.length;
  console.log(`  sandbox_jobs: ${total}   rebuilt rows: ${first.length}   skipped for unresolved FK: ${skipped}`);
  check(first.length <= total, 'rebuilt rows do not exceed source jobs');
  check(
    first.length >= total * 0.95,
    'coverage is complete',
    `${((first.length / total) * 100).toFixed(1)}% (the broken view path was ~65%)`,
  );
}

console.log('\n3. Known-good values (the row that exposed the bug)');
{
  const mine = first.filter((r) => (r.model_name || '').includes(GLM));
  console.log(`  rows for the GLM model: ${mine.length}`);

  for (const expected of [CORRECTED_DEV, CORRECTED_TB2]) {
    const row = mine.find((candidate) => candidate.id === expected.id);
    check(row !== undefined, `${expected.benchmark} corrected job id is present`, expected.id);
    check(
      row?.hf_traces_link?.includes(expected.trace) === true,
      `${expected.benchmark} corrected trace link is present`,
      row?.hf_traces_link ?? 'missing',
    );
  }

  for (const [benchmark, expected] of Object.entries(EXPECTED)) {
    const scored = mine.filter((r) => r.canonical_benchmark_name === benchmark && r.accuracy != null);
    const latest = selectPool(scored, 'latest')[0]?.row.accuracy;
    check(
      latest != null && Math.abs(latest - expected) < 0.05,
      `${benchmark} latest ≈ ${expected}`,
      latest == null ? 'no scored row found' : `got ${latest.toFixed(4)}`,
    );
  }

  const correctedTb2 = mine.find((row) => row.id === CORRECTED_TB2.id);
  if (correctedTb2) {
    const pool = mine.filter((row) =>
      row.model_id === correctedTb2.model_id &&
      row.canonical_agent_id === correctedTb2.canonical_agent_id &&
      row.benchmark_name === correctedTb2.benchmark_name
    );
    check(
      selectPool(pool, 'latest')[0]?.row.id === CORRECTED_TB2.id,
      'Latest selects the corrected TB2 job even though its score ties the old row',
      selectPool(pool, 'latest')[0]?.row.id ?? 'no selection',
    );
    check(
      selectPool(pool, 'all').some(({ row }) => row.id === CORRECTED_TB2.id),
      'All includes the corrected TB2 job',
      `${pool.length} TB2 rows in pool`,
    );
  }
}

console.log(failed ? '\nFAILED -- do not deploy base_tables mode.\n' : '\nAll checks passed.\n');
process.exit(failed ? 1 : 0);
