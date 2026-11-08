-- Minimal stand-in for the parts of a Supabase project that our migrations
-- and RLS policies depend on, so the migrations can be applied to a plain
-- Postgres for RLS tests (see run.sh). NOT a faithful Supabase: only the
-- roles, auth.uid(), and the storage/vault/cron/net objects the migrations
-- reference. Auth is simulated by setting request.jwt.claim.sub.

-- Roles are cluster-wide, so they survive from a previous run.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

CREATE SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
ALTER DATABASE CURRENT_DATABASE_PLACEHOLDER SET search_path = "$user", public, extensions;

CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  email_confirmed_at timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
-- aal ('aal1'/'aal2') and amr (JSON array of {"method": ...}) come from request.jwt.claim.aal / .amr.
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
  $$ SELECT jsonb_build_object('sub', auth.uid(), 'role', auth.role(),
       'aal', coalesce(nullif(current_setting('request.jwt.claim.aal', true), ''), 'aal1'),
       'amr', coalesce(nullif(current_setting('request.jwt.claim.amr', true), ''), '[{"method":"password"}]')::jsonb) $$;
-- Supabase Auth's multi-factor table, as far as policies need it.
CREATE TYPE auth.factor_status AS ENUM ('unverified', 'verified');
CREATE TABLE auth.mfa_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  friendly_name text,
  factor_type text NOT NULL DEFAULT 'totp',
  status auth.factor_status NOT NULL DEFAULT 'unverified',
  created_at timestamptz DEFAULT now()
);
GRANT USAGE ON SCHEMA auth, extensions TO anon, authenticated, service_role;

CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean DEFAULT false,
  file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text,
  name text, owner uuid, metadata jsonb, created_at timestamptz DEFAULT now());
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS
  $$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;

CREATE SCHEMA vault;
CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, secret text, description text);
CREATE VIEW vault.decrypted_secrets AS SELECT id, name, secret AS decrypted_secret, description FROM vault.secrets;
CREATE FUNCTION vault.create_secret(secret text, name text, description text DEFAULT '') RETURNS uuid
  LANGUAGE sql AS $$ INSERT INTO vault.secrets(secret, name, description) VALUES ($1, $2, $3) RETURNING id $$;

-- pg_cron / pg_net are not installable here; stub the functions the
-- health-check migration calls (its CREATE EXTENSION lines are filtered out by run.sh).
CREATE SCHEMA cron;
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
CREATE SCHEMA net;
CREATE FUNCTION net.http_post(url text, headers jsonb DEFAULT '{}', body jsonb DEFAULT '{}') RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;

-- Supabase grants the API roles broad table privileges and relies on RLS.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
