export const DEFAULT_PAGE_SIZE = 1000;

/**
 * Read a table in stable primary-key order without OFFSET.
 *
 * OFFSET gets progressively more expensive because PostgreSQL must still
 * visit and discard every preceding row. Production sandbox_jobs timed out at
 * OFFSET 4000. A keyset cursor lets every request start after the last primary
 * key returned by the preceding page.
 */
export async function fetchAllKeysetPages<T extends { id: string }>(
  fetchPage: (afterId: string | null, limit: number) => Promise<T[]>,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error(`pageSize must be a positive integer; got ${pageSize}`);
  }

  const rows: T[] = [];
  let afterId: string | null = null;

  for (;;) {
    const batch = await fetchPage(afterId, pageSize);
    if (batch.length > pageSize) {
      throw new Error(`page fetch returned ${batch.length} rows for limit ${pageSize}`);
    }

    let previousId = afterId;
    for (const row of batch) {
      if (previousId !== null && row.id <= previousId) {
        throw new Error(`keyset page is not strictly ordered: ${row.id} followed ${previousId}`);
      }
      previousId = row.id;
    }

    rows.push(...batch);
    if (batch.length < pageSize) return rows;

    afterId = batch[batch.length - 1].id;
  }
}
