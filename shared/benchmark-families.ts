/**
 * Backwards-compatible `family` shim over the benchmark registry.
 *
 * `family` (agentic | math | nlp) was the first cut at this and is now
 * superseded by `track` + `capability` in shared/benchmark-registry.ts. It is
 * kept working for one release so saved links and the current client keep
 * functioning, then removed.
 *
 * The important change is underneath: `agentic` used to mean "not in the math
 * or nlp allowlist", which silently swept every unregistered benchmark onto the
 * agentic board. It now means "registered as agentic", and an unknown name
 * belongs to no family at all.
 */

import {
  capabilityOf,
  trackOf,
  type Capability,
  type Track,
} from './benchmark-registry';

export type BenchmarkFamily = 'agentic' | 'math' | 'nlp';

/** How a legacy family maps onto the registry's track/capability pair. */
export function familyToTrack(family: BenchmarkFamily): {
  track: Track;
  capabilities?: readonly Capability[];
} {
  if (family === 'math') return { track: 'non-agentic', capabilities: ['math'] };
  if (family === 'nlp') {
    // The old `nlp` list was the lm-eval tasks plus IFEval, which the registry
    // now splits across knowledge and instruction. Map to both so an existing
    // ?family=nlp link keeps returning what it returned before.
    return { track: 'non-agentic', capabilities: ['knowledge', 'instruction'] };
  }
  return { track: 'agentic' };
}

/**
 * Whether a benchmark belongs to a legacy family.
 *
 * NOTE the change in meaning for 'agentic': this is now registry membership,
 * not "everything left over". An unregistered benchmark returns false for every
 * family, including agentic.
 */
export function inFamily(canonicalBenchmarkName: string, family: BenchmarkFamily): boolean {
  const { track, capabilities } = familyToTrack(family);
  if (trackOf(canonicalBenchmarkName) !== track) return false;
  if (!capabilities) return true;
  return capabilities.includes(capabilityOf(canonicalBenchmarkName));
}

export function parseFamily(value: unknown): BenchmarkFamily {
  return value === 'math' || value === 'nlp' ? value : 'agentic';
}
