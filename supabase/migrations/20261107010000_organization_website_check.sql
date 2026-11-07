-- Validate organization website links: a full http(s) link of 2,048 characters or fewer, or blank.
-- Holds for every write path (the API and direct inserts and updates). NOT VALID: rows already
-- stored aren't checked here, so this can't fail on existing data; the app shows any such value as
-- text, not a link, and the row's next update must bring it in line.
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_url_http CHECK (
    url IS NULL OR url = '' OR (length(url) <= 2048 AND url ~* '^https?://[^/?#[:space:]]+')
  ) NOT VALID;
