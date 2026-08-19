/**
 * Pins the base-tables reconstruction against create_leaderboard_view.sql.
 *
 * These two are one contract expressed twice: the SQL view, and buildRawRows()
 * rebuilding the same rows in memory. If they drift, the leaderboard silently
 * changes meaning depending on LEADERBOARD_DATA_SOURCE -- so every rule the
 * view encodes gets a test here.
 *
 * Run: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRawRows, type JobRow, type ModelRow, type NamedRow } from '../server/leaderboard-row-builder';
import { inFamily, parseFamily } from '../shared/benchmark-families';

const agent = (id: string, name: string, duplicate_of: string | null = null): NamedRow => ({ id, name, duplicate_of });
const bench = agent;

const model = (id: string, name: string, extra: Partial<ModelRow> = {}): ModelRow => ({
  id,
  name,
  duplicate_of: null,
  base_model_id: null,
  agent_id: null,
  creation_time: null,
  training_type: null,
  model_size_b: null,
  ...extra,
});

const job = (id: string, extra: Partial<JobRow> = {}): JobRow => ({
  id,
  model_id: 'm1',
  agent_id: 'a1',
  benchmark_id: 'b1',
  metrics: null,
  ended_at: null,
  started_at: null,
  created_at: null,
  hf_traces_link: null,
  config: null,
  stats: null,
  n_trials: null,
  job_status: null,
  username: null,
  slurm_job_id: null,
  is_overlong: null,
  notes: null,
  ...extra,
});

const BASE = {
  models: [model('m1', 'my-model')],
  agents: [agent('a1', 'terminus-2')],
  benchmarks: [bench('b1', 'tb2')],
};

const build = (jobs: JobRow[], over: Partial<typeof BASE> = {}) =>
  buildRawRows(jobs, over.models ?? BASE.models, over.agents ?? BASE.agents, over.benchmarks ?? BASE.benchmarks);

test('real sandbox_jobs ids survive unchanged', () => {
  const { rows } = build([job('job-abc-123')]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'job-abc-123');
});

test('rows with an unresolvable model, agent or benchmark are dropped', () => {
  const { rows, skipped } = build([
    job('ok'),
    job('no-model', { model_id: 'missing' }),
    job('no-agent', { agent_id: 'missing' }),
    job('no-benchmark', { benchmark_id: 'missing' }),
    job('null-fk', { model_id: null }),
  ]);
  assert.deepEqual(rows.map((r) => r.id), ['ok']);
  assert.equal(skipped, 4, 'the view INNER JOINs, so unresolved FKs produce no row');
});

test('accuracy and stderr are read from the metrics array and scaled to percent', () => {
  const { rows } = build([
    job('j', { metrics: [{ name: 'accuracy', value: 0.2218 }, { name: 'accuracy_stderr', value: 0.0138 }] }),
  ]);
  assert.ok(Math.abs(rows[0].accuracy! - 22.18) < 1e-9);
  assert.ok(Math.abs(rows[0].standard_error! - 1.38) < 1e-9);
});

test('a finished job with no accuracy metric yields null, not zero', () => {
  const { rows } = build([job('j', { metrics: [{ name: 'something_else', value: 1 }] })]);
  assert.equal(rows[0].accuracy, null, 'a missing metric must not read as a real score of 0');
  assert.equal(rows[0].standard_error, null);
});

test('finished jobs timestamp on ended_at, pending jobs on started_at', () => {
  // The view splits on `metrics IS NOT NULL`, NOT on job_status.
  const { rows } = build([
    job('finished', { metrics: [{ name: 'accuracy', value: 0.5 }], ended_at: 'E', started_at: 'S', created_at: 'C' }),
    job('pending', { metrics: null, ended_at: 'E', started_at: 'S', created_at: 'C' }),
  ]);
  assert.equal(rows[0].ended_at, 'E');
  assert.equal(rows[1].ended_at, 'S', 'pending jobs use started_at even when ended_at is set');
});

test('both timestamp paths fall back to created_at', () => {
  const { rows } = build([
    job('finished', { metrics: [{ name: 'accuracy', value: 0.5 }], created_at: 'C' }),
    job('pending', { created_at: 'C' }),
  ]);
  assert.equal(rows[0].ended_at, 'C');
  assert.equal(rows[1].ended_at, 'C');
});

test('pending jobs carry no score', () => {
  const { rows } = build([job('p', { job_status: 'Pending' })]);
  assert.equal(rows[0].accuracy, null);
  assert.equal(rows[0].standard_error, null);
});

test('canonical model, agent and benchmark resolve through duplicate_of', () => {
  const { rows } = build([job('j')], {
    models: [model('m1', 'dupe-model', { duplicate_of: 'm-canon' }), model('m-canon', 'canonical-model')],
    agents: [agent('a1', 'dupe-agent', 'a-canon'), agent('a-canon', 'canonical-agent')],
    benchmarks: [bench('b1', 'tb2-dupe', 'b-canon'), bench('b-canon', 'terminal_bench_2')],
  });
  const r = rows[0];
  assert.equal(r.canonical_model_name, 'canonical-model');
  assert.equal(r.canonical_agent_name, 'canonical-agent');
  assert.equal(r.canonical_agent_id, 'a-canon');

  // The view reports the canonical benchmark as identity, keeping the source.
  assert.equal(r.canonical_benchmark_name, 'terminal_bench_2');
  assert.equal(r.benchmark_name, 'terminal_bench_2');
  assert.equal(r.source_benchmark_name, 'tb2-dupe');
  assert.equal(r.source_benchmark_id, 'b1');
  assert.equal(r.benchmark_id, 'b-canon', 'benchmark_id is duplicate_of when the benchmark is a duplicate');
});

test('non-duplicate rows keep their own identity', () => {
  const { rows } = build([job('j')]);
  const r = rows[0];
  assert.equal(r.canonical_model_name, 'my-model');
  assert.equal(r.canonical_agent_id, 'a1');
  assert.equal(r.benchmark_id, 'b1');
  assert.equal(r.source_benchmark_name, 'tb2');
});

test('base model resolves directly', () => {
  const { rows } = build([job('j')], {
    models: [model('m1', 'sft', { base_model_id: 'base' }), model('base', 'Qwen/Qwen3-8B')],
  });
  assert.equal(rows[0].base_model_name, 'Qwen/Qwen3-8B');
  assert.equal(rows[0].base_model_id, 'base');
});

test('base model resolves THROUGH the canonical model when absent on the row model', () => {
  const { rows } = build([job('j')], {
    models: [
      model('m1', 'dupe', { duplicate_of: 'm-canon' }),
      model('m-canon', 'canonical', { base_model_id: 'base' }),
      model('base', 'Qwen/Qwen3-8B'),
    ],
  });
  assert.equal(rows[0].base_model_name, 'Qwen/Qwen3-8B');
  assert.equal(rows[0].base_model_id, 'base');
});

test('a duplicated base model reports its canonical name', () => {
  const { rows } = build([job('j')], {
    models: [
      model('m1', 'sft', { base_model_id: 'base-dupe' }),
      model('base-dupe', 'qwen3-8b-mirror', { duplicate_of: 'base-canon' }),
      model('base-canon', 'Qwen/Qwen3-8B'),
    ],
  });
  assert.equal(rows[0].base_model_name, 'qwen3-8b-mirror');
  assert.equal(rows[0].canonical_base_model_name, 'Qwen/Qwen3-8B');
  assert.equal(rows[0].canonical_base_model_id, 'base-canon');
});

test('a model with no base model reports None', () => {
  const { rows } = build([job('j')]);
  assert.equal(rows[0].base_model_name, 'None');
  assert.equal(rows[0].base_model_id, null);
});

test('model size falls back to the base model', () => {
  const { rows } = build([job('j')], {
    models: [model('m1', 'sft', { base_model_id: 'base' }), model('base', 'Qwen3-8B', { model_size_b: 8 })],
  });
  assert.equal(rows[0].model_size_b, 8);
});

test('an explicit model size wins over the base model', () => {
  const { rows } = build([job('j')], {
    models: [
      model('m1', 'sft', { base_model_id: 'base', model_size_b: 32 }),
      model('base', 'Qwen3-8B', { model_size_b: 8 }),
    ],
  });
  assert.equal(rows[0].model_size_b, 32);
});

test('multiple evals of one model on one benchmark stay separate rows', () => {
  // Selection between them is the caller's job. Collapsing here would silently
  // change which result the leaderboard reports.
  const { rows } = build([
    job('older', { metrics: [{ name: 'accuracy', value: 0.148 }], ended_at: '2026-02-24' }),
    job('newer', { metrics: [{ name: 'accuracy', value: 0.2218 }], ended_at: '2026-08-14' }),
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.id).sort(), ['newer', 'older']);
});

test('passthrough metadata survives intact', () => {
  const cfg = { timeout_multiplier: 2 };
  const stats = { n_trials: 300 };
  const { rows } = build([
    job('j', {
      hf_traces_link: 'https://hf.co/x',
      config: cfg,
      stats,
      n_trials: 300,
      job_status: 'Finished',
      username: 'mkumar73',
      slurm_job_id: '900942',
      is_overlong: true,
      notes: 'a note',
    }),
  ]);
  const r = rows[0];
  assert.equal(r.hf_traces_link, 'https://hf.co/x');
  assert.deepEqual(r.config, cfg);
  assert.deepEqual(r.stats, stats);
  assert.equal(r.n_trials, 300);
  assert.equal(r.job_status, 'Finished');
  assert.equal(r.username, 'mkumar73');
  assert.equal(r.slurm_job_id, '900942');
  assert.equal(r.is_overlong, true);
  assert.equal(r.notes, 'a note');
});

test('is_overlong defaults to false, matching the view COALESCE', () => {
  const { rows } = build([job('j', { is_overlong: null })]);
  assert.equal(rows[0].is_overlong, false);
});

test('training type comes from the model', () => {
  const { rows } = build([job('j')], { models: [model('m1', 'sft', { training_type: 'SFT' })] });
  assert.equal(rows[0].training_type, 'SFT');
});

// --- benchmark family routing (Agentic / Math / NLP tabs) ---

test('math and nlp benchmarks route to their own families', () => {
  for (const b of ['MATH500', 'AIME24', 'gsm8k']) {
    assert.equal(inFamily(b, 'math'), true, `${b} should be math`);
    assert.equal(inFamily(b, 'agentic'), false, `${b} must not leak into agentic`);
    assert.equal(inFamily(b, 'nlp'), false);
  }
  for (const b of ['mmlu', 'hellaswag', 'arc_challenge', 'drop']) {
    assert.equal(inFamily(b, 'nlp'), true, `${b} should be nlp`);
    assert.equal(inFamily(b, 'agentic'), false, `${b} must not leak into agentic`);
  }
});

test('agentic is defined by exclusion, so new agentic benchmarks appear automatically', () => {
  for (const b of ['terminal_bench_2', 'dev_set_v2', 'swebench-verified', 'some-brand-new-agentic-set']) {
    assert.equal(inFamily(b, 'agentic'), true, `${b} should be agentic`);
    assert.equal(inFamily(b, 'math'), false);
  }
});

test('an unregistered standard benchmark falls into agentic, not nowhere', () => {
  // Documents the known trade-off: a misspelled standard benchmark is visible
  // in the wrong tab rather than silently invisible everywhere.
  assert.equal(inFamily('MATH-500', 'math'), false, 'wrong spelling is not math');
  assert.equal(inFamily('MATH-500', 'agentic'), true, 'but it still shows up somewhere');
});

test('parseFamily defaults to agentic for junk input', () => {
  assert.equal(parseFamily('math'), 'math');
  assert.equal(parseFamily('nlp'), 'nlp');
  for (const junk of [undefined, null, '', 'AGENTIC', 'sql-injection', 42]) {
    assert.equal(parseFamily(junk), 'agentic');
  }
});

test('the Snowball standard-eval benchmarks route to their real tabs', () => {
  // Regression: IFEval was missing from the NLP list, and because `agentic` is
  // defined by EXCLUSION it silently landed on the Agentic board next to
  // SWE-bench and terminal_bench_2 rather than showing as absent. Exact names
  // as registered by the evalchemy harness -- 'IFEval', not 'ifeval'.
  assert.equal(inFamily('IFEval', 'nlp'), true);
  assert.equal(inFamily('IFEval', 'agentic'), false, 'IFEval must not fall through to Agentic');
  assert.equal(inFamily('IFEval', 'math'), false);

  assert.equal(inFamily('MATH500', 'math'), true);
  assert.equal(inFamily('MATH500', 'agentic'), false, 'MATH500 must not fall through to Agentic');
  assert.equal(inFamily('MATH500', 'nlp'), false);
});

test('a Snowball model with one math and one nlp row appears on both tabs, once each', () => {
  // Mirrors the two real rows for
  // laion/sft-repro-thinking-step630-nemotron-terminal-step1888:
  // MATH500 71.0% and IFEval 32.7172% (prompt-level strict), both via evalchemy.
  const { rows } = buildRawRows(
    [
      job('math-row', { benchmark_id: 'b-math', metrics: [{ name: 'accuracy', value: 0.71 }] }),
      job('ifeval-row', {
        benchmark_id: 'b-ifeval',
        metrics: [
          { name: 'accuracy', value: 0.32717190388170053 },
          { name: 'accuracy_stderr', value: 0.020190318966906255 },
          { name: 'prompt_level_strict_acc', value: 0.32717190388170053 },
          { name: 'inst_level_strict_acc', value: 0.4556354916067146 },
          { name: 'prompt_level_loose_acc', value: 0.36968576709796674 },
          { name: 'inst_level_loose_acc', value: 0.4940047961630695 },
        ],
      }),
    ],
    [model('m1', 'laion/sft-repro-thinking-step630-nemotron-terminal-step1888')],
    [agent('a1', 'evalchemy')],
    [bench('b-math', 'MATH500'), bench('b-ifeval', 'IFEval')],
  );

  const byBenchmark = new Map(rows.map((r) => [r.canonical_benchmark_name, r]));
  assert.equal(rows.length, 2, 'both rows survive the base_tables reconstruction');

  const math = byBenchmark.get('MATH500')!;
  assert.ok(Math.abs(math.accuracy! - 71.0) < 1e-9);
  assert.equal(inFamily(math.canonical_benchmark_name, 'math'), true);

  const ifeval = byBenchmark.get('IFEval')!;
  // The headline stays PROMPT-LEVEL STRICT: `accuracy` equals
  // prompt_level_strict_acc, not the higher loose or instruction-level figures.
  assert.ok(Math.abs(ifeval.accuracy! - 32.717190388170053) < 1e-9);
  assert.ok(Math.abs(ifeval.standard_error! - 2.0190318966906255) < 1e-9);
  assert.ok(ifeval.accuracy! < 36.9, 'must not pick up prompt_level_loose_acc');
  assert.ok(ifeval.accuracy! < 45.5, 'must not pick up inst_level_strict_acc');
  assert.equal(inFamily(ifeval.canonical_benchmark_name, 'nlp'), true);

  // Neither belongs on the agentic board.
  assert.equal(rows.filter((r) => inFamily(r.canonical_benchmark_name, 'agentic')).length, 0);
});
