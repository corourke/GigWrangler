-- A scan queued on a phone carries its own id, so a retry can't record it twice.
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).

-- As the table owner: rows affected, or -1 if refused.
CREATE FUNCTION rls_test.owner(p_sql text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
EXCEPTION WHEN OTHERS THEN RETURN -1;
END $$;
CREATE FUNCTION rls_test.scan(p_client text, p_status text) RETURNS text LANGUAGE sql AS $$
  SELECT format('INSERT INTO inventory_tracking (organization_id, gig_id, kit_id, status, scanned_by, client_id) VALUES (%L, %L, %L, %L, %L, %s)',
    rls_test.u('org_a'), rls_test.u('gig'), rls_test.u('kit_a'), p_status, rls_test.u('a_staff'),
    CASE WHEN p_client IS NULL THEN 'NULL' ELSE quote_literal(p_client) || '::uuid' END) $$;

SELECT rls_test.expect('A scan with its id', rls_test.owner(rls_test.scan('00000000-0000-0000-0000-00000000c1d1', 'Loaded')), 1);
SELECT rls_test.expect('The same scan again', rls_test.owner(rls_test.scan('00000000-0000-0000-0000-00000000c1d1', 'Loaded')), -1);
SELECT rls_test.expect('Another scan, another id', rls_test.owner(rls_test.scan('00000000-0000-0000-0000-00000000c1d2', 'Unloaded')), 1);
SELECT rls_test.expect('A scan without an id', rls_test.owner(rls_test.scan(NULL, 'Loaded')), 1);
SELECT rls_test.expect('Another without an id', rls_test.owner(rls_test.scan(NULL, 'Unloaded')), 1);
