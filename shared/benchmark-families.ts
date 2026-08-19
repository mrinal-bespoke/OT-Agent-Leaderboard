/**
 * Which benchmarks belong to which leaderboard tab.
 *
 * Families come from the Marin Eval Policy (marin-community/marin#7958), which
 * defines three report templates:
 *
 *   Agentic : model | SWE-100 | dev_set_v2 | tb2 | ID mean | ID SE | traces
 *   Math    : scale | mix | stage | model | MATH500 | AIME24(mean/std) | gsm8k
 *   NLP     : model | params | MMLU | HellaSwag | ARC-c/e | PIQA | WinoGrande
 *             | OBQA | BoolQ | TruthfulQA | LAMBADA | TriviaQA | NQ | DROP
 *
 * Membership is by CANONICAL benchmark name, matching how duplicate benchmark
 * rows are already resolved before rows reach the UI.
 *
 * Names must match what is REGISTERED in the database, not the policy's prose.
 * The agentic set already carries four spellings of one benchmark
 * (terminal_bench_2, terminal-bench-2.0, terminal-bench@2.0, terminal_bench_v2)
 * plus raw SHAs, so anything importing standard evals should register under the
 * exact strings below rather than inventing a new spelling.
 */

export type BenchmarkFamily = 'agentic' | 'math' | 'nlp';

export const BENCHMARK_FAMILIES: Record<Exclude<BenchmarkFamily, 'agentic'>, readonly string[]> = {
  math: ['MATH500', 'AIME24', 'gsm8k'],
  nlp: [
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
    'drop',
    // Registered by the evalchemy harness alongside the lm-eval tasks.
    // Its headline `accuracy` is prompt-level STRICT; the loose and
    // instruction-level variants ride along in the job's metrics array.
    'IFEval',
  ],
} as const;

const MATH = new Set<string>(BENCHMARK_FAMILIES.math);
const NLP = new Set<string>(BENCHMARK_FAMILIES.nlp);

/**
 * True when a benchmark belongs to the given tab.
 *
 * `agentic` is defined by EXCLUSION -- anything not claimed by a standard
 * family. That keeps the historical agentic set (101 benchmarks, many with
 * generated names) working without enumerating it, and means a newly added
 * agentic benchmark shows up automatically instead of silently vanishing.
 * The cost is that an unregistered standard benchmark lands in the agentic tab;
 * add it to the lists above rather than special-casing it.
 */
export function inFamily(canonicalBenchmarkName: string, family: BenchmarkFamily): boolean {
  if (family === 'math') return MATH.has(canonicalBenchmarkName);
  if (family === 'nlp') return NLP.has(canonicalBenchmarkName);
  return !MATH.has(canonicalBenchmarkName) && !NLP.has(canonicalBenchmarkName);
}

export function parseFamily(value: unknown): BenchmarkFamily {
  return value === 'math' || value === 'nlp' ? value : 'agentic';
}
