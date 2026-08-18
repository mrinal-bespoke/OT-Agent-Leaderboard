export type EvalSelectionMode = 'oldest' | 'latest' | 'highest' | 'all';

export interface SelectableResult {
  id: string;
  accuracy: number | null;
  ended_at: string | null;
  job_status: string | null;
  is_overlong: boolean;
}

const JOB_STATUS_PRIORITY: Record<string, number> = {
  Finished: 0,
  Started: 1,
  Pending: 2,
};

/** Select one result using the leaderboard's oldest/latest/highest rules. */
export function selectResult<T extends SelectableResult>(
  pool: T[],
  mode: Exclude<EvalSelectionMode, 'all'>,
): T | null {
  if (pool.length === 0) return null;

  const finished = pool.filter((row) => row.accuracy !== null && row.job_status !== 'Failed');
  const nonFinished = pool.filter((row) => row.accuracy === null || row.job_status === 'Failed');

  if (finished.length > 0) {
    const nonOverlong = finished.filter((row) => !row.is_overlong);
    const candidatesPool = nonOverlong.length > 0 ? nonOverlong : finished;

    if (mode === 'highest') {
      return candidatesPool.reduce((best, row) =>
        (row.accuracy ?? 0) > (best.accuracy ?? 0) ? row : best,
      );
    }

    const aboveThreshold = candidatesPool.filter((row) => (row.accuracy ?? 0) > 1.0);
    const candidates = aboveThreshold.length > 0 ? aboveThreshold : candidatesPool;

    return [...candidates].sort((a, b) => {
      const tsA = a.ended_at ? new Date(a.ended_at).getTime() : 0;
      const tsB = b.ended_at ? new Date(b.ended_at).getTime() : 0;
      const byTime = mode === 'oldest' ? tsA - tsB : tsB - tsA;
      return byTime || a.id.localeCompare(b.id);
    })[0];
  }

  return [...nonFinished].sort((a, b) => {
    const aPriority = JOB_STATUS_PRIORITY[a.job_status ?? 'Pending'] ?? 3;
    const bPriority = JOB_STATUS_PRIORITY[b.job_status ?? 'Pending'] ?? 3;
    if (aPriority !== bPriority) return aPriority - bPriority;
    const tsA = a.ended_at ? new Date(a.ended_at).getTime() : 0;
    const tsB = b.ended_at ? new Date(b.ended_at).getTime() : 0;
    return tsB - tsA || a.id.localeCompare(b.id);
  })[0];
}

export interface SelectedPoolRow<T> {
  row: T;
  poolIndex?: number;
  poolSize?: number;
}

/** Expand a pool for API selection, including every row in `all` mode. */
export function selectPool<T extends SelectableResult>(
  pool: T[],
  mode: EvalSelectionMode,
): SelectedPoolRow<T>[] {
  if (mode !== 'all') {
    const selected = selectResult(pool, mode);
    return selected ? [{ row: selected }] : [];
  }

  const sorted = [...pool].sort((a, b) => {
    const tsA = a.ended_at ? new Date(a.ended_at).getTime() : 0;
    const tsB = b.ended_at ? new Date(b.ended_at).getTime() : 0;
    return tsB - tsA || a.id.localeCompare(b.id);
  });

  return sorted.map((row, poolIndex) => ({ row, poolIndex, poolSize: sorted.length }));
}
