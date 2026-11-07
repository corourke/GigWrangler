-- 1. The attachments bucket takes PDFs, images (JPEG, PNG, WebP, GIF, HEIC, HEIF), Word, Excel and
--    PowerPoint documents and CSV, up to 25 MB. Not HTML, SVG, macro-enabled Office files or anything
--    else. Files already stored are unaffected; the rule applies to new uploads.
UPDATE storage.buckets
SET file_size_limit = 26214400,
    allowed_mime_types = ARRAY[
      'application/pdf',
      'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/csv'
    ]
WHERE id = 'attachments';

-- 2. Organization members read invitations without their token (the app never shows it;
--    the invitation functions are SECURITY DEFINER and the server uses the service role).
REVOKE SELECT ON public.invitations FROM authenticated;
GRANT SELECT (id, organization_id, email, role, invited_by, status, expires_at, accepted_at, accepted_by, created_at, updated_at)
  ON public.invitations TO authenticated;
REVOKE ALL ON public.invitations FROM anon;
