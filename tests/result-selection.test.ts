import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchAllKeysetPages } from '../server/keyset-pagination';
import { selectPool, type SelectableResult } from '../server/result-selection';

const result = (id: string, endedAt: string): SelectableResult => ({
  id,
  accuracy: 10.861423220973783,
  ended_at: endedAt,
  job_status: 'Finished',
  is_overlong: false,
});

test('latest and all include a corrected same-score result beyond page one', async () => {
  const oldTb2 = result('0000-old-tb2', '2026-08-14T00:00:00Z');
  const filler = Array.from({ length: 999 }, (_, index) =>
    result(`1000-filler-${String(index).padStart(4, '0')}`, '2026-08-15T00:00:00Z'));
  const correctedTb2 = result(
    'zzzz-corrected-tb2',
    '2026-08-18T04:43:20.382989Z',
  );
  const source = [oldTb2, ...filler, correctedTb2];

  const fetched = await fetchAllKeysetPages(async (afterId, limit) => {
    const start = afterId === null
      ? 0
      : source.findIndex((row) => row.id === afterId) + 1;
    return source.slice(start, start + limit);
  });
  const tb2Pool = fetched.filter((row) => row.id === oldTb2.id || row.id === correctedTb2.id);

  assert.equal(selectPool(tb2Pool, 'latest')[0].row.id, correctedTb2.id);
  assert.deepEqual(
    selectPool(tb2Pool, 'all').map(({ row }) => row.id),
    [correctedTb2.id, oldTb2.id],
  );
});
