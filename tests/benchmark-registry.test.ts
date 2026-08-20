/**
 * The registry replaces "agentic by exclusion", which silently swept every
 * unregistered benchmark onto the agentic board. These tests pin the two
 * properties that matters: nothing is inferred from a name, and the agentic
 * track still contains exactly what it contained before.
 *
 * Run: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BENCHMARK_REGISTRY,
  auditAttentionNeeded,
  capabilitiesOf,
  capabilityOf,
  inTrack,
  lookupBenchmark,
  parseCapability,
  parseTrack,
  trackOf,
} from '../shared/benchmark-registry';
import { inFamily, parseFamily } from '../shared/benchmark-families';

/**
 * Every canonical benchmark that currently carries jobs in production, read
 * from Supabase during design. If a new benchmark appears in the data, this
 * list goes stale and the coverage test below fails -- which is the intended
 * prompt to register it, rather than discovering it on the wrong tab.
 */
const AGENTIC_IN_PRODUCTION = [
  'dev_set_v2',
  'swebench-verified-random-100-folders',
  'terminal_bench_2',
  'dev_set_71_tasks',
  'bfcl-parity',
  'medagentbench',
  'aider_polyglot',
  'gaia_127',
  'financeagent_terminal',
  'swebench-verified',
  'clean-sandboxes-tasks-eval-set',
  'evoeval',
  'autocodebench',
  'deveval',
  'codepde',
  'financeagent',
  'tb2_smoke3',
  '0c553bd6d05d451907afb8db31dba84759ccc993',
];

const NON_AGENTIC_IN_PRODUCTION = ['MATH500', 'IFEval'];

test('registry names are unique across canonical names and aliases', () => {
  const seen = new Set<string>();
  for (const e of BENCHMARK_REGISTRY) {
    for (const n of [e.canonicalName, ...e.aliases]) {
      assert.equal(seen.has(n), false, `duplicate registry name: ${n}`);
      seen.add(n);
    }
  }
});

test('ZERO DIFF: every benchmark on the agentic board today is still agentic', () => {
  // The whole safety case for V1. Any name dropping out of this set removes
  // rows from the agentic payload.
  for (const name of AGENTIC_IN_PRODUCTION) {
    assert.equal(trackOf(name), 'agentic', `${name} must remain agentic`);
    assert.equal(inTrack(name, 'agentic'), true);
  }
});

test('junk rows stay agentic so the payload is unchanged, but are flagged noise', () => {
  // Excluding them would have been tidier and would have broken zero-diff.
  for (const name of ['financeagent', 'tb2_smoke3', '0c553bd6d05d451907afb8db31dba84759ccc993']) {
    assert.equal(trackOf(name), 'agentic');
    assert.equal(lookupBenchmark(name)!.policyStatus, 'noise');
  }
});

test('the audit surfaces both unregistered names and registered junk', () => {
  const { unclassified, noise } = auditAttentionNeeded([
    'terminal_bench_2',        // fine
    'MATH500',                 // fine
    'tb2_smoke3',              // registered, junk
    'something-brand-new',     // unregistered
  ]);
  assert.deepEqual(unclassified, ['something-brand-new']);
  assert.deepEqual(noise, ['tb2_smoke3']);
});

test('non-agentic benchmarks are non-agentic and never leak into agentic', () => {
  for (const name of NON_AGENTIC_IN_PRODUCTION) {
    assert.equal(trackOf(name), 'non-agentic');
    assert.equal(inTrack(name, 'agentic'), false);
  }
});

test('an unregistered name is unclassified -- in EITHER direction', () => {
  // The IFEval regression: unknown must never fall through to agentic. It must
  // also not be guessed into non-agentic; nothing infers a track from a name.
  for (const name of ['brand-new-agentic-suite', 'SomeNewMathBench', 'MATH-500', 'ifeval', 'Terminal_Bench_2']) {
    assert.equal(trackOf(name), 'unclassified', `${name} should be unclassified`);
    assert.equal(capabilityOf(name), 'unclassified');
    assert.equal(inTrack(name, 'agentic'), false, `${name} must NOT be agentic`);
    assert.equal(inTrack(name, 'non-agentic'), false, `${name} must NOT be non-agentic`);
  }
});

test('IFEval and IFBench are distinct entries sharing one capability', () => {
  const ifeval = lookupBenchmark('IFEval')!;
  const ifbench = lookupBenchmark('IFBench')!;
  assert.notEqual(ifeval, ifbench, 'they must not be the same entry');
  assert.equal(ifeval.capability, 'instruction');
  assert.equal(ifbench.capability, 'instruction');
  assert.equal(ifeval.policyStatus, 'off-policy');
  assert.equal(ifbench.policyStatus, 'development');
  // Neither may alias the other, or a future IFBench import merges into IFEval.
  assert.equal(ifeval.aliases.includes('IFBench'), false);
  assert.equal(ifbench.aliases.includes('IFEval'), false);
});

test('IFEval headline metric is named explicitly, not inherited from accuracy', () => {
  assert.equal(lookupBenchmark('IFEval')!.primaryMetric, 'prompt_level_strict_acc');
});

test('the core three are core, in DEV / SWE-100 / TB2 order', () => {
  const core = BENCHMARK_REGISTRY
    .filter(e => e.track === 'agentic' && e.capability === 'core')
    .sort((a, b) => a.order - b.order);
  assert.deepEqual(core.map(e => e.canonicalName), [
    'dev_set_v2',
    'swebench-verified-random-100-folders',
    'terminal_bench_2',
  ]);
  assert.deepEqual(core.map(e => e.displayName), ['DEV', 'SWE-100', 'TB2']);
});

test('capabilitiesOf lists each track\'s views in order', () => {
  assert.deepEqual(capabilitiesOf('agentic'), ['core', 'ood']);
  assert.deepEqual(capabilitiesOf('non-agentic'), [
    'math', 'code', 'knowledge', 'instruction', 'longcontext', 'domain',
  ]);
});

test('query params degrade safely', () => {
  assert.equal(parseTrack('non-agentic'), 'non-agentic');
  for (const junk of [undefined, null, '', 'AGENTIC', 'drop table', 42]) {
    assert.equal(parseTrack(junk), 'agentic', 'unrecognised track falls back to today\'s default');
  }
  assert.equal(parseCapability('math', 'non-agentic'), 'math');
  assert.equal(parseCapability('core', 'non-agentic'), undefined, 'capability must belong to the track');
  assert.equal(parseCapability('nonsense', 'agentic'), undefined);
});

test('legacy ?family= still resolves the same benchmarks', () => {
  // Kept working for one release so saved links do not break.
  assert.equal(inFamily('terminal_bench_2', 'agentic'), true);
  assert.equal(inFamily('MATH500', 'math'), true);
  assert.equal(inFamily('IFEval', 'nlp'), true, 'nlp spanned knowledge + instruction');
  assert.equal(inFamily('mmlu', 'nlp'), true);
  assert.equal(inFamily('MATH500', 'agentic'), false);
  // The meaning change: unknown is no longer swept into agentic.
  assert.equal(inFamily('brand-new-thing', 'agentic'), false);
  assert.equal(parseFamily('nonsense'), 'agentic');
});

// --- V2: capability views and column sets ---

test('overview covers every non-agentic capability, including empty ones', () => {
  // The point of driving columns from the registry rather than the data: a
  // capability nobody has evaluated must still be visible as an empty column.
  const byCapability = new Map<string, (typeof BENCHMARK_REGISTRY)[number]>();
  for (const e of BENCHMARK_REGISTRY) {
    if (e.track !== 'non-agentic') continue;
    const held = byCapability.get(e.capability);
    if (!held || e.order < held.order) byCapability.set(e.capability, e);
  }
  const caps = capabilitiesOf('non-agentic');
  assert.deepEqual(
    caps.map(c => byCapability.get(c)?.canonicalName),
    ['MATH500', 'HumanEvalPlus', 'MMLU-Pro', 'IFEval', 'MRCR', 'FinanceBench'],
    'one representative per capability, in registry order',
  );
  // Only two of these have any rows today; the other four must still be listed.
  assert.equal(caps.length, 6);
});

test('every non-agentic capability has at least one registered benchmark', () => {
  // An empty capability would render a view with no columns at all, which
  // looks broken rather than unevaluated.
  for (const c of capabilitiesOf('non-agentic')) {
    const n = BENCHMARK_REGISTRY.filter(e => e.track === 'non-agentic' && e.capability === c).length;
    assert.ok(n > 0, `capability ${c} has no benchmarks`);
  }
});

test('agentic capability views do not leak non-agentic benchmarks', () => {
  for (const c of capabilitiesOf('agentic')) {
    for (const e of BENCHMARK_REGISTRY.filter(x => x.capability === c)) {
      assert.equal(e.track, 'agentic', `${e.canonicalName} in agentic view ${c}`);
    }
  }
});
