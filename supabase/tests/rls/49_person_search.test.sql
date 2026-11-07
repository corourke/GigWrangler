-- #178 (10-08): finding an existing person or organization before adding a new one.
-- Every word of a name counts, in any order, with a typo allowed; email as typed;
-- phone ignoring formatting. The person search returns only what the picker shows.
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).

INSERT INTO rls_test.ids VALUES
  ('p_john', '00000000-0000-0000-0000-00000000e001'),
  ('p_mary', '00000000-0000-0000-0000-00000000e002'),
  ('p_gone', '00000000-0000-0000-0000-00000000e003');
INSERT INTO public.users (id, email, first_name, last_name, phone, address_line1, user_status) VALUES
  (rls_test.u('p_john'), 'john.smith@crew.example', 'John', 'Smith', '(555) 123-4567', '1 Main St', 'active'),
  (rls_test.u('p_mary'), NULL, 'Mary', 'O''Brien', NULL, NULL, 'contact'),
  (rls_test.u('p_gone'), 'ike@crew.example', 'Ike', 'Inactive', NULL, NULL, 'inactive');
INSERT INTO organization_members (organization_id, user_id, role) VALUES
  (rls_test.u('org_b'), rls_test.u('p_john'), 'Staff'),
  (rls_test.u('org_c'), rls_test.u('p_john'), 'Viewer'),
  (rls_test.u('org_b'), rls_test.u('p_mary'), 'Viewer');

CREATE FUNCTION rls_test.people(p_sql text) RETURNS int LANGUAGE sql AS
  $$ SELECT rls_test.try(rls_test.u('a_staff'), p_sql) $$;

-- 1. People: who is found -------------------------------------------------------------
-- a_staff shares no organization with John or Mary: the search is system-wide on purpose.
SELECT rls_test.expect('Full name finds John', rls_test.people($$SELECT * FROM search_people('John Smith')$$), 1);
SELECT rls_test.expect('Words in any order', rls_test.people($$SELECT * FROM search_people('smith john')$$), 1);
SELECT rls_test.expect('One word', rls_test.people($$SELECT * FROM search_people('smith')$$), 1);
SELECT rls_test.expect('Part of a word', rls_test.people($$SELECT * FROM search_people('smi')$$), 1);
SELECT rls_test.expect('A typo still matches (Jon Smith)', rls_test.people($$SELECT * FROM search_people('Jon Smith')$$), 1);
SELECT rls_test.expect('A different first name does not (Jane Smith)', rls_test.people($$SELECT * FROM search_people('Jane Smith')$$), 0);
SELECT rls_test.expect('Punctuation in a name is ignored (obrien)', rls_test.people($$SELECT * FROM search_people('mary obrien')$$), 1);
SELECT rls_test.expect('Email as typed, any case',
  rls_test.people($$SELECT * FROM search_people(NULL, 'JOHN.Smith@crew.example') WHERE matched_on = 'email'$$), 1);
SELECT rls_test.expect('Email typed into the search box',
  rls_test.people($$SELECT * FROM search_people('john.smith@crew') WHERE matched_on = 'email'$$), 1);
SELECT rls_test.expect('Phone, formatted differently, with a country code',
  rls_test.people($$SELECT * FROM search_people(NULL, NULL, '+1 555.123.4567') WHERE matched_on = 'phone'$$), 1);
SELECT rls_test.expect('Phone typed into the search box',
  rls_test.people($$SELECT * FROM search_people('5551234567') WHERE matched_on = 'phone'$$), 1);
SELECT rls_test.expect('A short phone fragment is not a phone match',
  rls_test.people($$SELECT * FROM search_people(NULL, NULL, '4567')$$), 0);
SELECT rls_test.expect('Name, email or phone: any one is enough',
  rls_test.people($$SELECT * FROM search_people('Nobody Here', NULL, '555-123-4567')$$), 1);
SELECT rls_test.expect('Inactive people are not offered', rls_test.people($$SELECT * FROM search_people('Ike')$$), 0);
SELECT rls_test.expect('One letter finds nothing', rls_test.people($$SELECT * FROM search_people('j')$$), 0);
SELECT rls_test.expect('An exact email ranks first',
  rls_test.people($$SELECT 1 FROM (SELECT id FROM search_people('Smith', 'john.smith@crew.example') LIMIT 1) s
                    WHERE s.id = '00000000-0000-0000-0000-00000000e001'$$), 1);

-- 2. People: what comes back ---------------------------------------------------------
SELECT rls_test.expect('Only the picker''s columns',
  (SELECT count(*)::int FROM (
     SELECT unnest(proargnames) a, unnest(proargmodes) m FROM pg_proc WHERE proname = 'search_people') x
   WHERE m = 't' AND a NOT IN ('id', 'first_name', 'last_name', 'matched_on')), 0);
SELECT rls_test.expect('The picker''s columns are all there',
  (SELECT count(*)::int FROM (
     SELECT unnest(proargnames) a, unnest(proargmodes) m FROM pg_proc WHERE proname = 'search_people') x
   WHERE m = 't'), 4);

-- 3. People: who may search -----------------------------------------------------------
SELECT rls_test.expect('Not signed in: refused', rls_test.try_anon($$SELECT * FROM search_people('John Smith')$$), -1);
SELECT rls_test.expect('The old search is gone',
  (SELECT count(*)::int FROM pg_proc WHERE proname = 'search_users_secure'), 0);

-- 4. Organizations --------------------------------------------------------------------
INSERT INTO organizations (id, name, roles) VALUES
  ('00000000-0000-0000-0000-00000000e0a1', 'Acme Sound & Light', '{Sound,Lighting}'),
  ('00000000-0000-0000-0000-00000000e0a2', 'The Fillmore', '{Venue}');
SELECT rls_test.expect('Org: one word', rls_test.people($$SELECT * FROM search_organizations('acme')$$), 1);
SELECT rls_test.expect('Org: words in any order', rls_test.people($$SELECT * FROM search_organizations('light acme')$$), 1);
SELECT rls_test.expect('Org: a typo still matches', rls_test.people($$SELECT * FROM search_organizations('Filmore')$$), 1);
SELECT rls_test.expect('Org: by type', rls_test.people($$SELECT * FROM search_organizations('acme', 'Venue')$$), 0);
SELECT rls_test.expect('Org: no words, by type', rls_test.people($$SELECT * FROM search_organizations(NULL, 'Venue')$$), 1);
SELECT rls_test.expect('Org: no words, no type = all',
  rls_test.people($$SELECT * FROM search_organizations(NULL)$$), (SELECT count(*)::int FROM organizations));
SELECT rls_test.expect('Org: closest first',
  rls_test.people($$SELECT 1 FROM (SELECT name FROM search_organizations('org b') LIMIT 1) s WHERE s.name = 'Org B'$$), 1);
