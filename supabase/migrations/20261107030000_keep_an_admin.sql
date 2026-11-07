-- An organization keeps at least one Admin. A change of role or a removal that would take an
-- organization's last Admin is refused, by any path (the app, the server, a cascade from deleting
-- a profile), except when the organization itself is being deleted. Organizations that have no
-- Admin yet (claimed = false) aren't affected: only an Admin's row can trip this.
CREATE OR REPLACE FUNCTION public.keep_an_admin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.role <> 'Admin' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.role = 'Admin' AND NEW.organization_id = OLD.organization_id THEN
    RETURN NEW;
  END IF;
  -- Serialize changes to one organization's Admins, so two can't step down at once. An
  -- organization that is being deleted is already gone here, and its memberships go with it.
  PERFORM 1 FROM public.organizations WHERE id = OLD.organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = OLD.organization_id AND role = 'Admin' AND id <> OLD.id
  ) THEN
    RAISE EXCEPTION 'An organization needs at least one Admin. Make someone else an Admin first.'
      USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION public.keep_an_admin() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS keep_an_admin ON public.organization_members;
CREATE TRIGGER keep_an_admin
  BEFORE UPDATE OR DELETE ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.keep_an_admin();
