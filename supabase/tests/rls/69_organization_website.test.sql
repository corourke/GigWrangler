-- Validate organization website links: http(s) only, 2,048 characters at most, on every write path.
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).

CREATE FUNCTION rls_test.set_url(p_url text) RETURNS text LANGUAGE sql AS
  $$ SELECT format('UPDATE public.organizations SET url = %L WHERE id = %L', p_url, rls_test.u('org_a')) $$;
CREATE FUNCTION rls_test.new_org(p_url text) RETURNS text LANGUAGE sql AS
  $$ SELECT format('INSERT INTO public.organizations (name, roles, url) VALUES (%L, ''{Production}'', %L)', 'Website test', p_url) $$;

SELECT rls_test.expect('Update: https', rls_test.try(rls_test.u('a_admin'), rls_test.set_url('https://example.com/a')), 1);
SELECT rls_test.expect('Update: http', rls_test.try(rls_test.u('a_admin'), rls_test.set_url('http://example.com')), 1);
SELECT rls_test.expect('Update: cleared', rls_test.try(rls_test.u('a_admin'), rls_test.set_url(NULL)), 1);
SELECT rls_test.expect('Update: empty', rls_test.try(rls_test.u('a_admin'), rls_test.set_url('')), 1);
SELECT rls_test.expect('Update: other scheme', rls_test.try(rls_test.u('a_admin'), rls_test.set_url('javascript:alert(1)')), -1);
SELECT rls_test.expect('Update: other scheme, capitals', rls_test.try(rls_test.u('a_admin'), rls_test.set_url('JavaScript:alert(1)')), -1);
SELECT rls_test.expect('Update: no scheme', rls_test.try(rls_test.u('a_admin'), rls_test.set_url('example.com')), -1);
SELECT rls_test.expect('Update: too long', rls_test.try(rls_test.u('a_admin'), rls_test.set_url('https://example.com/' || repeat('a', 2048))), -1);

SELECT rls_test.expect('Insert: https', rls_test.try(rls_test.u('a_staff'), rls_test.new_org('https://example.com')), 1);
SELECT rls_test.expect('Insert: other scheme', rls_test.try(rls_test.u('a_staff'), rls_test.new_org('data:text/html,x')), -1);
