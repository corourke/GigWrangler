-- A12: a gig's all-day flag is its own column. create_gig_complex stores it; a gig created
-- without it is timed. (The backfill from 12:00 UTC is tested in tests/conversion.)
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).
-- rls_test.act keeps a statement's effect, for checks that read it (as in 62_gig_owner).
CREATE FUNCTION rls_test.id(p text) RETURNS text LANGUAGE sql STABLE AS $$ SELECT quote_literal(rls_test.u(p)) $$;
CREATE FUNCTION rls_test.exec(p_user text, p_sql text, p_keep boolean) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', rls_test.u(p_user)::text, true);
    SET LOCAL ROLE authenticated;
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    SET CONSTRAINTS ALL IMMEDIATE;
    SET CONSTRAINTS ALL DEFERRED;
    RESET ROLE;
    IF NOT p_keep THEN RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = n::text; END IF;
    RETURN 'ok:' || n;
  EXCEPTION
    WHEN SQLSTATE 'P0099' THEN RESET ROLE; RETURN 'ok:' || SQLERRM;
    WHEN OTHERS THEN RESET ROLE; RETURN SQLSTATE;
  END;
END $$;
CREATE FUNCTION rls_test.rows(p_result text) RETURNS int LANGUAGE sql IMMUTABLE AS
  $$ SELECT CASE WHEN p_result LIKE 'ok:%' THEN substr(p_result, 4)::int ELSE -1 END $$;
CREATE FUNCTION rls_test.run(p_user text, p_sql text) RETURNS int LANGUAGE sql AS
  $$ SELECT rls_test.rows(rls_test.exec(p_user, p_sql, false)) $$;
CREATE FUNCTION rls_test.act(p_user text, p_sql text) RETURNS int LANGUAGE sql AS
  $$ SELECT rls_test.rows(rls_test.exec(p_user, p_sql, true)) $$;


SELECT rls_test.expect('create_gig_complex keeps all_day', rls_test.act('a_admin', format(
  $q$SELECT create_gig_complex(jsonb_build_object('title','A12 all-day','start','2026-05-01T12:00:00Z','end','2026-05-01T12:00:00Z','all_day',true,'primary_organization_id',%s),
       jsonb_build_array(jsonb_build_object('organization_id',%s,'role','Production')), '[]'::jsonb)$q$,
  rls_test.id('org_a'), rls_test.id('org_a'))), 1);
SELECT rls_test.expect('... stored as all-day', (SELECT count(*)::int FROM gigs WHERE title = 'A12 all-day' AND all_day), 1);

SELECT rls_test.expect('create_gig_complex without all_day', rls_test.act('a_admin', format(
  $q$SELECT create_gig_complex(jsonb_build_object('title','A12 timed noon','start','2026-05-01T12:00:00Z','end','2026-05-01T15:00:00Z','primary_organization_id',%s),
       jsonb_build_array(jsonb_build_object('organization_id',%s,'role','Production')), '[]'::jsonb)$q$,
  rls_test.id('org_a'), rls_test.id('org_a'))), 1);
SELECT rls_test.expect('... is timed, even at 12:00 UTC', (SELECT count(*)::int FROM gigs WHERE title = 'A12 timed noon' AND NOT all_day), 1);

SELECT rls_test.expect('an Admin can change a gig to all-day', rls_test.act('a_admin', format(
  $q$UPDATE gigs SET all_day = true WHERE title = 'A12 timed noon'$q$)), 1);
