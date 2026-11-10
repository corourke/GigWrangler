-- Mobile receipt capture (11-10): a receipt captured on a gig's page is queued with
-- that gig, so its review opens as a cost of the gig. The gig must be one the
-- queue row's org takes part in; any of the org's Admins and Managers may set it.
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).

INSERT INTO rls_test.ids VALUES
  ('gig_c', '00000000-0000-0000-0000-0000000000f3'),
  ('att_a', '00000000-0000-0000-0000-00000000aa01'),
  ('att_a2', '00000000-0000-0000-0000-00000000aa02'),
  ('att_b', '00000000-0000-0000-0000-00000000ab01'),
  ('att_c', '00000000-0000-0000-0000-00000000ac01'),
  ('q_a', '00000000-0000-0000-0000-00000000ba01');

-- A gig only Org C takes part in.
INSERT INTO gigs (id, title, status, start, "end", timezone, created_by, updated_by, owner_organization_id)
VALUES (rls_test.u('gig_c'), 'Other gig', (enum_range(NULL::gig_status))[1], now(), now() + interval '4 hours',
        'UTC', rls_test.u('c_admin'), rls_test.u('c_admin'), rls_test.u('org_c'));
INSERT INTO gig_participants (gig_id, organization_id, role) VALUES (rls_test.u('gig_c'), rls_test.u('org_c'), 'Production');

INSERT INTO attachments (id, organization_id, file_path, file_name, created_by) VALUES
  (rls_test.u('att_a'),  rls_test.u('org_a'), 'org_a/r1.jpg', 'r1.jpg', rls_test.u('a_admin')),
  (rls_test.u('att_a2'), rls_test.u('org_a'), 'org_a/r2.jpg', 'r2.jpg', rls_test.u('a_admin')),
  (rls_test.u('att_b'),  rls_test.u('org_b'), 'org_b/r.jpg',  'r.jpg',  rls_test.u('b_admin')),
  (rls_test.u('att_c'),  rls_test.u('org_c'), 'org_c/r.jpg',  'r.jpg',  rls_test.u('c_admin'));
INSERT INTO purchase_scan_queue (id, organization_id, attachment_id, file_name) VALUES
  (rls_test.u('q_a'), rls_test.u('org_a'), rls_test.u('att_a'), 'r1.jpg');

CREATE FUNCTION rls_test.id(p text) RETURNS text LANGUAGE sql STABLE AS $$ SELECT quote_literal(rls_test.u(p)) $$;
CREATE FUNCTION rls_test.run(p_user text, p_sql text) RETURNS int LANGUAGE sql AS
  $$ SELECT rls_test.try(rls_test.u(p_user), p_sql) $$;
CREATE FUNCTION rls_test.queue(p_user text, p_org text, p_att text, p_gig text) RETURNS int LANGUAGE sql AS
  $$ SELECT rls_test.run(p_user, format(
       'INSERT INTO purchase_scan_queue (organization_id, attachment_id, file_name, gig_id) VALUES (%s, %s, %L, %s)',
       rls_test.id(p_org), rls_test.id(p_att), 'r.jpg', CASE WHEN p_gig IS NULL THEN 'NULL' ELSE rls_test.id(p_gig) END)) $$;

-- Adding
SELECT rls_test.expect('A manager can queue a receipt on gig G (A takes part)', rls_test.queue('a_manager', 'org_a', 'att_a2', 'gig'), 1);
SELECT rls_test.expect('B admin can queue a receipt on gig G (B takes part, not owner)', rls_test.queue('b_admin', 'org_b', 'att_b', 'gig'), 1);
SELECT rls_test.expect('A admin cannot queue a receipt on a gig A has no part in', rls_test.queue('a_admin', 'org_a', 'att_a2', 'gig_c'), -1);
SELECT rls_test.expect('C admin can queue without a gig', rls_test.queue('c_admin', 'org_c', 'att_c', NULL), 1);
SELECT rls_test.expect('A staff cannot queue a receipt on gig G', rls_test.queue('a_staff', 'org_a', 'att_a2', 'gig'), -1);

-- Changing
SELECT rls_test.expect('A admin can link an A item to gig G',
  rls_test.run('a_admin', format('UPDATE purchase_scan_queue SET gig_id = %s WHERE id = %s', rls_test.id('gig'), rls_test.id('q_a'))), 1);
SELECT rls_test.expect('A admin cannot link an A item to a gig A has no part in',
  rls_test.run('a_admin', format('UPDATE purchase_scan_queue SET gig_id = %s WHERE id = %s', rls_test.id('gig_c'), rls_test.id('q_a'))), -1);
SELECT rls_test.expect('A admin can unlink an A item',
  rls_test.run('a_admin', format('UPDATE purchase_scan_queue SET gig_id = NULL WHERE id = %s', rls_test.id('q_a'))), 1);

-- Still only the org's Admins and Managers see the queue
SELECT rls_test.expect('A staff does NOT see A queue items',
  rls_test.visible(rls_test.u('a_staff'), 'purchase_scan_queue', 'organization_id = ' || rls_test.id('org_a')), 0);

-- Deleting the gig keeps the receipt in the queue, unlinked
UPDATE purchase_scan_queue SET gig_id = rls_test.u('gig') WHERE id = rls_test.u('q_a');
DELETE FROM gigs WHERE id = rls_test.u('gig');
SELECT rls_test.expect('Deleting the gig keeps the item, unlinked',
  (SELECT count(*)::int FROM purchase_scan_queue WHERE id = rls_test.u('q_a') AND gig_id IS NULL), 1);
