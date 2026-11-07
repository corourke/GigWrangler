-- The attachments bucket takes PDFs and images up to 25 MB; organization members read
-- invitations without their token.
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).

CREATE FUNCTION rls_test.n(p_sql text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE v int;
BEGIN
  EXECUTE p_sql INTO v;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RETURN -1;
END $$;

SELECT rls_test.expect('Attachments: 25 MB limit',
  rls_test.n($$SELECT count(*)::int FROM storage.buckets WHERE id = 'attachments' AND file_size_limit = 26214400$$), 1);
SELECT rls_test.expect('Attachments: PDF allowed',
  rls_test.n($$SELECT count(*)::int FROM storage.buckets WHERE id = 'attachments' AND 'application/pdf' = ANY (allowed_mime_types)$$), 1);
SELECT rls_test.expect('Attachments: JPEG, PNG, WebP, GIF, HEIC allowed',
  rls_test.n($$SELECT count(*)::int FROM storage.buckets WHERE id = 'attachments'
               AND allowed_mime_types @> ARRAY['image/jpeg','image/png','image/webp','image/gif','image/heic']$$), 1);
SELECT rls_test.expect('Attachments: SVG not allowed',
  rls_test.n($$SELECT count(*)::int FROM storage.buckets WHERE id = 'attachments' AND 'image/svg+xml' = ANY (allowed_mime_types)$$), 0);
SELECT rls_test.expect('Attachments: no other types',
  rls_test.n($$SELECT count(*)::int FROM storage.buckets WHERE id = 'attachments' AND cardinality(allowed_mime_types) = 7$$), 1);

INSERT INTO public.invitations (organization_id, email, role, invited_by, token, expires_at)
VALUES (rls_test.u('org_a'), 'new.person@example.test', 'Staff', rls_test.u('a_admin'), 'secret-invitation-token', now() + interval '7 days');

SELECT rls_test.expect('Admin lists invitations', rls_test.try(rls_test.u('a_admin'),
  'SELECT id, organization_id, email, role, invited_by, status, expires_at, accepted_at, accepted_by, created_at, updated_at FROM public.invitations'), 1);
SELECT rls_test.expect('Admin cannot read the token', rls_test.try(rls_test.u('a_admin'), 'SELECT token FROM public.invitations'), -1);
SELECT rls_test.expect('Viewer cannot read the token', rls_test.try(rls_test.u('a_viewer'), 'SELECT token FROM public.invitations'), -1);
SELECT rls_test.expect('Anonymous cannot read invitations', rls_test.try_anon('SELECT id FROM public.invitations'), -1);
SELECT rls_test.expect('Admin still cancels an invitation', rls_test.try(rls_test.u('a_admin'),
  'UPDATE public.invitations SET status = ''cancelled'' WHERE email = ''new.person@example.test'''), 1);
SELECT rls_test.expect('Admin still deletes an invitation', rls_test.try(rls_test.u('a_admin'),
  'DELETE FROM public.invitations WHERE email = ''new.person@example.test'''), 1);
