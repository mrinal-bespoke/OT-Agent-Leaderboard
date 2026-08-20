/**
 * The benchmark registry: the single source of truth for which track and
 * capability a benchmark belongs to.
 *
 * WHY THIS EXISTS
 * ---------------
 * Track membership used to be derived by EXCLUSION -- anything not named in a
 * math or nlp allowlist was treated as agentic. That is silent and it fails in
 * the most visible direction: IFEval, a standard instruction-following eval,
 * was rendered on the agentic board next to SWE-bench because nobody had added
 * it to a list. The same was queued to happen to HumanEvalPlus, GPQA, MRCR and
 * FinanceBench.
 *
 * Membership is now ENUMERATED. An unrecognised benchmark resolves to
 * `unclassified` and appears on no curated board, in EITHER direction --
 * nothing infers a track from a name. The cost is that a genuinely new
 * benchmark must be registered here before it appears; that is acceptable only
 * because unclassified benchmarks are surfaced with a visible count, which
 * turns a silent misclassification into a visible to-do.
 *
 * SEEDED FOR ZERO DIFF
 * --------------------
 * The agentic entries are seeded from exactly what the Agentic board renders
 * today, not from the policy. That includes benchmarks the policy does not
 * name and rows that are plainly junk (`policyStatus: 'noise'`). Excluding
 * them would have changed the agentic payload, and V1 is a strict zero-diff
 * release. They are flagged rather than removed, and nothing in Supabase is
 * touched.
 *
 * Policy reference: marin-community/marin#7958.
 * Design: docs/leaderboard-taxonomy-design.md
 */

export type Track = 'agentic' | 'non-agentic' | 'unclassified';

export type Capability =
  // agentic
  | 'core'
  | 'ood'
  // non-agentic
  | 'math'
  | 'code'
  | 'knowledge'
  | 'instruction'
  | 'longcontext'
  | 'domain'
  // neither
  | 'unclassified';

export type PolicyStatus =
  /** Named in #7958 as an active benchmark. */
  | 'policy'
  /** Named in #7958, marked development. */
  | 'development'
  /** A real eval we run that #7958 does not name. */
  | 'off-policy'
  /** Predates the policy; kept because it has history. */
  | 'legacy'
  /** Smoke tests, generated names. Surfaced for cleanup, never auto-removed. */
  | 'noise';

export interface BenchmarkEntry {
  /** Canonical benchmark name as registered in the database. The join key. */
  canonicalName: string;
  /** Short header for a column, e.g. 'SWE-100'. */
  displayName: string;
  /**
   * Extra spellings not already merged by `benchmarks.duplicate_of`.
   * Normally empty: duplicate_of is the source of truth for aliasing and this
   * exists only for names that must map without a database write.
   */
  aliases: readonly string[];
  track: Track;
  capability: Capability;
  /** Metric key used for the headline number. */
  primaryMetric: string;
  /** Metric key for the ± figure. Absent means no ± is shown at all. */
  stderrMetric?: string;
  policyStatus: PolicyStatus;
  /** Column order within a capability; lower sorts first. */
  order: number;
}

const agentic = (
  canonicalName: string,
  displayName: string,
  capability: 'core' | 'ood',
  order: number,
  policyStatus: PolicyStatus,
): BenchmarkEntry => ({
  canonicalName,
  displayName,
  aliases: [],
  track: 'agentic',
  capability,
  primaryMetric: 'accuracy',
  stderrMetric: 'accuracy_stderr',
  policyStatus,
  order,
});

const nonAgentic = (
  canonicalName: string,
  displayName: string,
  capability: Capability,
  order: number,
  policyStatus: PolicyStatus,
  primaryMetric = 'accuracy',
): BenchmarkEntry => ({
  canonicalName,
  displayName,
  aliases: [],
  track: 'non-agentic',
  capability,
  primaryMetric,
  stderrMetric: 'accuracy_stderr',
  policyStatus,
  order,
});

export const BENCHMARK_REGISTRY: readonly BenchmarkEntry[] = [
  // ---- agentic: the policy core three -------------------------------------
  agentic('dev_set_v2', 'DEV', 'core', 10, 'policy'),
  agentic('swebench-verified-random-100-folders', 'SWE-100', 'core', 20, 'policy'),
  agentic('terminal_bench_2', 'TB2', 'core', 30, 'policy'),

  // ---- agentic: everything else the board shows today ----------------------
  // Seeded from live data so the agentic payload is unchanged. Several are not
  // named in #7958; that is recorded, not corrected, by this release.
  agentic('swebench-verified', 'SWE-verified', 'ood', 10, 'policy'),
  agentic('bfcl-parity', 'BFCL', 'ood', 20, 'policy'),
  agentic('aider_polyglot', 'Aider', 'ood', 30, 'off-policy'),
  agentic('gaia_127', 'GAIA', 'ood', 40, 'off-policy'),
  agentic('medagentbench', 'MedAgentBench', 'ood', 50, 'off-policy'),
  agentic('financeagent_terminal', 'FinanceAgent', 'ood', 60, 'off-policy'),
  agentic('dev_set_71_tasks', 'DEV-71', 'ood', 70, 'legacy'),
  agentic('clean-sandboxes-tasks-eval-set', 'Clean sandboxes', 'ood', 80, 'legacy'),
  agentic('evoeval', 'EvoEval', 'ood', 90, 'off-policy'),
  agentic('autocodebench', 'AutoCodeBench', 'ood', 100, 'off-policy'),
  agentic('deveval', 'DevEval', 'ood', 110, 'off-policy'),
  agentic('codepde', 'CodePDE', 'ood', 120, 'off-policy'),

  // Junk that is nonetheless in today's agentic payload. Kept agentic so V1
  // stays zero-diff; flagged so the audit can surface it. Never auto-removed,
  // and nothing in Supabase is modified.
  agentic('financeagent', 'financeagent', 'ood', 900, 'noise'),
  agentic('tb2_smoke3', 'tb2_smoke3', 'ood', 910, 'noise'),
  agentic('0c553bd6d05d451907afb8db31dba84759ccc993', 'unnamed (SHA)', 'ood', 920, 'noise'),

  // ---- non-agentic: math --------------------------------------------------
  nonAgentic('MATH500', 'MATH500', 'math', 10, 'policy'),
  nonAgentic('AIME24', 'AIME24', 'math', 20, 'policy'),
  nonAgentic('gsm8k', 'GSM8K', 'math', 30, 'policy'),

  // ---- non-agentic: code --------------------------------------------------
  nonAgentic('HumanEvalPlus', 'HumanEval+', 'code', 10, 'policy'),
  nonAgentic('MBPPPlus', 'MBPP+', 'code', 20, 'policy'),
  nonAgentic('CruxEval', 'CruxEval', 'code', 30, 'policy'),

  // ---- non-agentic: knowledge & reasoning ---------------------------------
  nonAgentic('MMLU-Pro', 'MMLU-Pro', 'knowledge', 10, 'policy'),
  nonAgentic('GPQA Diamond', 'GPQA-D', 'knowledge', 20, 'policy'),
  nonAgentic('OlympiadBench', 'Olympiad', 'knowledge', 30, 'policy'),
  nonAgentic('mmlu', 'MMLU', 'knowledge', 40, 'policy'),
  nonAgentic('hellaswag', 'HellaSwag', 'knowledge', 50, 'policy'),
  nonAgentic('arc_challenge', 'ARC-c', 'knowledge', 60, 'policy'),
  nonAgentic('arc_easy', 'ARC-e', 'knowledge', 70, 'policy'),
  nonAgentic('piqa', 'PIQA', 'knowledge', 80, 'policy'),
  nonAgentic('winogrande', 'WinoGrande', 'knowledge', 90, 'policy'),
  nonAgentic('openbookqa', 'OBQA', 'knowledge', 100, 'policy'),
  nonAgentic('boolq', 'BoolQ', 'knowledge', 110, 'policy'),
  nonAgentic('truthfulqa_mc2', 'TruthfulQA', 'knowledge', 120, 'policy'),
  nonAgentic('lambada_openai', 'LAMBADA', 'knowledge', 130, 'policy'),
  nonAgentic('triviaqa', 'TriviaQA', 'knowledge', 140, 'policy'),
  nonAgentic('nq_open', 'NQ', 'knowledge', 150, 'policy'),
  nonAgentic('drop', 'DROP', 'knowledge', 160, 'policy'),

  // ---- non-agentic: instruction following ---------------------------------
  // IFEval and IFBench are DIFFERENT benchmarks that share a capability.
  // Neither aliases the other, and a future IFBench import must not be merged
  // into the existing IFEval rows.
  nonAgentic('IFEval', 'IFEval', 'instruction', 10, 'off-policy', 'prompt_level_strict_acc'),
  nonAgentic('IFBench', 'IFBench', 'instruction', 20, 'development'),

  // ---- non-agentic: long context / domain ---------------------------------
  nonAgentic('MRCR', 'MRCR', 'longcontext', 10, 'policy'),
  nonAgentic('FinanceBench', 'FinanceBench', 'domain', 10, 'policy'),
] as const;

/** canonicalName and every alias -> entry. Built once. */
const BY_NAME: ReadonlyMap<string, BenchmarkEntry> = (() => {
  const m = new Map<string, BenchmarkEntry>();
  for (const entry of BENCHMARK_REGISTRY) {
    for (const name of [entry.canonicalName, ...entry.aliases]) {
      if (m.has(name)) {
        // A duplicate name would make membership order-dependent, which is
        // exactly the class of silent bug this registry replaces.
        throw new Error(`[benchmark-registry] duplicate name: ${name}`);
      }
      m.set(name, entry);
    }
  }
  return m;
})();

/** Registry entry for a name, or undefined. Never guesses. */
export function lookupBenchmark(canonicalName: string): BenchmarkEntry | undefined {
  return BY_NAME.get(canonicalName);
}

/**
 * Track for a benchmark name.
 *
 * An unregistered name is `unclassified` -- NOT agentic, and not inferred to be
 * non-agentic either. This is the whole point of the registry.
 */
export function trackOf(canonicalName: string): Track {
  return BY_NAME.get(canonicalName)?.track ?? 'unclassified';
}

export function capabilityOf(canonicalName: string): Capability {
  return BY_NAME.get(canonicalName)?.capability ?? 'unclassified';
}

export function inTrack(canonicalName: string, track: Track): boolean {
  return trackOf(canonicalName) === track;
}

/** Capabilities offered by a track, in display order. */
export function capabilitiesOf(track: Track): readonly Capability[] {
  const seen = new Map<Capability, number>();
  for (const e of BENCHMARK_REGISTRY) {
    if (e.track !== track) continue;
    const best = seen.get(e.capability);
    if (best === undefined || e.order < best) seen.set(e.capability, e.order);
  }
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([c]) => c);
}

const TRACKS: readonly Track[] = ['agentic', 'non-agentic', 'unclassified'];

/** Parse a track query param. Anything unrecognised means agentic (today's default). */
export function parseTrack(value: unknown): Track {
  return TRACKS.includes(value as Track) ? (value as Track) : 'agentic';
}

/**
 * Parse a capability query param within a track.
 * Undefined means "the whole track", which is the V1 agentic behaviour.
 */
export function parseCapability(value: unknown, track: Track): Capability | undefined {
  if (typeof value !== 'string') return undefined;
  return capabilitiesOf(track).includes(value as Capability) ? (value as Capability) : undefined;
}

/**
 * Benchmarks needing human attention: unregistered, plus registered-but-junk.
 *
 * Noise entries stay on their current board so V1 does not change any payload;
 * this is how they get surfaced instead. Callers pass the canonical names seen
 * in the data.
 */
export function auditAttentionNeeded(seenNames: Iterable<string>): {
  unclassified: string[];
  noise: string[];
} {
  const unclassified: string[] = [];
  const noise: string[] = [];
  for (const name of new Set(seenNames)) {
    const entry = BY_NAME.get(name);
    if (!entry) unclassified.push(name);
    else if (entry.policyStatus === 'noise') noise.push(name);
  }
  return { unclassified: unclassified.sort(), noise: noise.sort() };
}
