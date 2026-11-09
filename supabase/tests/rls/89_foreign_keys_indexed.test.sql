-- A2: every foreign key in public has an index on its columns, leading, so joins and filters on it,
-- and the scan a delete of the referenced row makes, don't read the whole table.
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).

SELECT rls_test.expect('Every foreign key has an index on its columns', (
  SELECT count(*)::int
  FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace AND n.nspname = 'public'
  WHERE c.contype = 'f'
    AND NOT EXISTS (
      SELECT 1 FROM pg_index i
      WHERE i.indrelid = c.conrelid
        AND (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] @> c.conkey
        AND (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] <@ c.conkey)
), 0);
