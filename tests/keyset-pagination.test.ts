import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchAllKeysetPages } from '../server/keyset-pagination';

test('keyset pagination fetches every row beyond the first 1000', async () => {
  const source = Array.from({ length: 2505 }, (_, index) => ({
    id: `job-${String(index).padStart(4, '0')}`,
  }));
  const cursors: Array<string | null> = [];

  const rows = await fetchAllKeysetPages(async (afterId, limit) => {
    cursors.push(afterId);
    const start = afterId === null
      ? 0
      : source.findIndex((row) => row.id === afterId) + 1;
    return source.slice(start, start + limit);
  });

  assert.equal(rows.length, 2505);
  assert.deepEqual(rows, source);
  assert.deepEqual(cursors, [null, 'job-0999', 'job-1999']);
});

test('keyset pagination rejects an unstable or non-unique page order', async () => {
  await assert.rejects(
    fetchAllKeysetPages(async () => [{ id: 'b' }, { id: 'a' }]),
    /not strictly ordered/,
  );
});
