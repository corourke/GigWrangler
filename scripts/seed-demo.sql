-- =============================================================================
-- GigWrangler demo-data seed (for user-guide screenshots)
--
-- DEV ONLY. Run it with scripts/seed-demo.sh, which refuses any Supabase
-- project other than the development one (qcrzwsazasaojqoqxwnr).
--
-- Idempotent: step 1 deletes every row belonging to the demo organizations and
-- demo users (all identified by fixed UUIDs of the form
-- de000000-0000-4000-8000-<kind:4><n:8>), step 2 inserts fresh data. Rows that
-- do not carry a demo UUID are never touched.
--
-- Dates are pinned to an ANCHOR date ("today" in every screenshot), which
-- seed-demo.sh substitutes for __ANCHOR__. The screenshot browser's clock is
-- frozen to the same date, so Upcoming/Past and "next 30 days" never drift.
-- Gigs fall on a weekday of a week relative to the anchor's week, so they keep
-- landing on Friday and Saturday evenings whatever the anchor is.
--
-- ID kinds (see pg_temp.d below):
--   0001 organization    0002 user           0003 gig            0004 asset
--   0005 kit             0006 purchase row   0007 gig_financial  0008 staff slot
--   0009 staff assign    0010 gig participant 0011 activity      0012 inventory scan
--   0013 access request  0014 notification  0015 equipment item
--
-- People: first names start with the letter of their role (Admin = A,
-- Manager = M, Staff = S, Viewer = V), so a screenshot shows who is who.
-- Nothing is timestamped later than 8 AM on the anchor day: on the day itself a
-- later seeded row would outrank what a reviewer does in the app (latest scan wins).
-- Demo logins (all password demo1pass):
--   demo-admin@gigwrangler.test    Alicia Hale      Admin
--   demo-manager@gigwrangler.test  Marcus Reyes     Manager
--   demo-staff@gigwrangler.test    Sofia Lindqvist  Staff
--   demo-viewer@gigwrangler.test   Victor Okafor    Viewer
--   demo-newuser@gigwrangler.test  Nina Newman      (no organization: onboarding shots)
--   demo-moderator@gigwrangler.test Petra Lund      platform moderator, no organization
--   vera.holm@cedar-hall.example   Vera Holm        Viewer at Cedar Hall (asks to claim it)
-- =============================================================================

BEGIN;

-- Deterministic demo UUID: d(kind, n) -> de000000-0000-4000-8000-<kind:4><n:8>
CREATE FUNCTION pg_temp.d(kind int, n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('de000000-0000-4000-8000-' || lpad(kind::text, 4, '0') || lpad(n::text, 8, '0'))::uuid
$$;
-- The pinned "today" of the demo world.
CREATE FUNCTION pg_temp.anchor() RETURNS date LANGUAGE sql IMMUTABLE AS $$ SELECT '__ANCHOR__'::date $$;
-- Day `dow` (0 = Monday ... 6 = Sunday) of the week `wk` weeks from the anchor's week.
CREATE FUNCTION pg_temp.day(wk int, dow int) RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT date_trunc('week', pg_temp.anchor())::date + wk * 7 + dow
$$;
-- A local (Pacific) clock time on a date, as timestamptz. hour may be fractional or past 24.
CREATE FUNCTION pg_temp.at(dt date, hour numeric) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$
  SELECT (dt + interval '1 hour' * hour) AT TIME ZONE 'America/Los_Angeles'
$$;
-- IRS standard mileage rate on a date, as in src/utils/financials.utils.ts (IRS_MILEAGE_RATES).
CREATE FUNCTION pg_temp.irs(dt date) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN dt < DATE '2024-01-01' THEN 0.655 WHEN dt < DATE '2025-01-01' THEN 0.67
              WHEN dt < DATE '2026-01-01' THEN 0.70 WHEN dt < DATE '2026-07-01' THEN 0.725 ELSE 0.76 END
$$;

-- -----------------------------------------------------------------------------
-- 1. CLEAN: remove everything demo (children before parents)
-- -----------------------------------------------------------------------------
DELETE FROM public.activity_log
 WHERE organization_id::text LIKE 'de000000-0000-4000-8000-%'
    OR actor_id::text        LIKE 'de000000-0000-4000-8000-%'
    OR gig_id::text          LIKE 'de000000-0000-4000-8000-%';
DELETE FROM public.ai_scan_usage
 WHERE organization_id::text LIKE 'de000000-0000-4000-8000-%'
    OR user_id::text         LIKE 'de000000-0000-4000-8000-%';
DELETE FROM public.inventory_tracking WHERE organization_id::text LIKE 'de000000-0000-4000-8000-%';
DELETE FROM public.notifications WHERE recipient_id::text LIKE 'de000000-0000-4000-8000-%';
DELETE FROM public.access_requests WHERE requester_id::text LIKE 'de000000-0000-4000-8000-%';
-- Tax years before purchases: a locked demo year refuses its purchases' deletes. Their
-- depreciation figures go too (the line 19 rows cascade).
DELETE FROM public.tax_years WHERE organization_id::text LIKE 'de000000-0000-4000-8000-%';
DELETE FROM public.tax_year_depreciation WHERE organization_id::text LIKE 'de000000-0000-4000-8000-%';
-- Purchase lines before headers, and all purchases before assets, so the
-- "depreciated line must keep its equipment record" check never sees a half-delete.
DELETE FROM public.purchases
 WHERE organization_id::text LIKE 'de000000-0000-4000-8000-%' AND row_type <> 'header';
DELETE FROM public.purchases
 WHERE organization_id::text LIKE 'de000000-0000-4000-8000-%';
-- Gigs cascade to participants, schedule, slots, assignments, kit assignments,
-- financials, participant contacts, inventory tracking.
DELETE FROM public.gigs WHERE id::text LIKE 'de000000-0000-4000-8000-%';
-- Kit lines and equipment records point at equipment items with ON DELETE RESTRICT,
-- so they go first: the organization's cascade doesn't order them before the items.
DELETE FROM public.kit_components
 WHERE kit_id IN (SELECT id FROM public.kits WHERE organization_id::text LIKE 'de000000-0000-4000-8000-%');
DELETE FROM public.assets WHERE organization_id::text LIKE 'de000000-0000-4000-8000-%';
-- Organizations cascade to members, assets, kits (and components), categories,
-- attachments, invitations, access requests, tax years.
DELETE FROM public.organizations WHERE id::text LIKE 'de000000-0000-4000-8000-%';
DELETE FROM public.users WHERE id::text LIKE 'de000000-0000-4000-8000-%';
DELETE FROM auth.identities WHERE user_id::text LIKE 'de000000-0000-4000-8000-%';
DELETE FROM auth.users WHERE id::text LIKE 'de000000-0000-4000-8000-%';

-- -----------------------------------------------------------------------------
-- 2. ORGANIZATIONS
--    1 Demo Sound & Lighting (the primary, "our" org)  2-6 partner orgs
-- -----------------------------------------------------------------------------
INSERT INTO public.organizations
  (id, name, roles, url, phone_number, address_line1, city, state, postal_code, country, description, claimed)
VALUES
  (pg_temp.d(1,1), 'Demo Sound & Lighting', ARRAY['Production','Sound','Lighting']::organization_role[],
     'https://demo-sound-lighting.example', '(415) 555-0100', '1200 Foundry Way', 'Oakland', 'CA', '94607', 'US',
     'Full-service sound, lighting and staging for concerts, festivals and corporate events.', true),
  (pg_temp.d(1,2), 'Harborlight Pavilion', ARRAY['Venue']::organization_role[],
     'https://harborlight.example', '(415) 555-0142', '88 Pier Road', 'San Francisco', 'CA', '94111', 'US',
     'Waterfront pavilion with a 1,800-capacity main hall.', false),
  (pg_temp.d(1,3), 'Cedar Hall', ARRAY['Venue']::organization_role[],
     'https://cedar-hall.example', '(510) 555-0177', '417 Cedar Street', 'Berkeley', 'CA', '94704', 'US',
     'Historic 600-seat theater and listening room.', false),
  (pg_temp.d(1,4), 'Neon Orchard', ARRAY['Act']::organization_role[],
     'https://neon-orchard.example', '(510) 555-0119', NULL, 'Oakland', 'CA', '94612', 'US',
     'Five-piece indie pop band.', false),
  (pg_temp.d(1,5), 'Paper Lanterns', ARRAY['Act']::organization_role[],
     NULL, '(415) 555-0163', NULL, 'San Rafael', 'CA', '94901', 'US',
     'Acoustic folk trio.', false),
  (pg_temp.d(1,6), 'Brightwave Events', ARRAY['Agency']::organization_role[],
     'https://brightwave.example', '(415) 555-0155', '350 Market Plaza, Suite 900', 'San Francisco', 'CA', '94105', 'US',
     'Corporate and festival event agency (our main client).', false);

-- -----------------------------------------------------------------------------
-- 3. USERS
--    4 logins (auth.users + auth.identities + public.users), plus no-login
--    people (public.users with user_status 'contact', no auth row).
-- -----------------------------------------------------------------------------
CREATE TEMP TABLE _u ON COMMIT DROP AS
SELECT * FROM (VALUES
  -- n, email, first, last, phone, city, postal, login?, last sign-in (days before anchor)
  (1,  'demo-admin@gigwrangler.test',        'Alicia',  'Hale',      '(415) 555-0101', 'Oakland',       '94607', true,  1),
  (2,  'demo-manager@gigwrangler.test',      'Marcus',  'Reyes',     '(415) 555-0102', 'Oakland',       '94609', true,  1),
  (3,  'demo-staff@gigwrangler.test',        'Sofia',   'Lindqvist', '(415) 555-0103', 'Alameda',       '94501', true,  1),
  (4,  'demo-viewer@gigwrangler.test',       'Victor',  'Okafor',    '(415) 555-0104', 'Oakland',       '94610', true,  6),
  -- signed up but in no organization yet (the onboarding screens)
  (5,  'demo-newuser@gigwrangler.test',      'Nina',    'Newman',    '(415) 555-0105', 'San Francisco', '94110', true,  2),
  -- platform moderator (P for platform): reviews requests on unclaimed organizations
  (6,  'demo-moderator@gigwrangler.test',    'Petra',   'Lund',      '(415) 555-0106', 'San Francisco', '94103', true,  3),
  -- freelance crew without logins (Staff at Demo Sound & Lighting)
  (11, 'sam.whitfield@crew.example',         'Sam',     'Whitfield', '(510) 555-0113', 'Oakland',       '94610', false, NULL),
  (12, 'shane.park@crew.example',            'Shane',   'Park',      '(510) 555-0112', 'Berkeley',      '94703', false, NULL),
  (13, 'simone.nair@crew.example',           'Simone',  'Nair',      '(415) 555-0114', 'San Francisco', '94110', false, NULL),
  (14, 'sergio.diaz@crew.example',           'Sergio',  'Diaz',      '(415) 555-0111', 'Oakland',       '94606', false, NULL),
  (15, 'skye.morgan@crew.example',           'Skye',    'Morgan',    '(510) 555-0115', 'Emeryville',    '94608', false, NULL),
  -- partner-org contacts (Viewers at their own org)
  (21, 'valerie.costa@harborlight.example',  'Valerie', 'Costa',     '(415) 555-0143', 'San Francisco', '94111', false, NULL),
  -- Vera has a login: she asks to take over Cedar Hall (an unclaimed venue)
  (22, 'vera.holm@cedar-hall.example',       'Vera',    'Holm',      '(510) 555-0178', 'Berkeley',      '94704', true,  4),
  (23, 'vivian.chen@neon-orchard.example',   'Vivian',  'Chen',      '(510) 555-0120', 'Oakland',       '94612', false, NULL),
  (24, 'vaughn.ellis@paperlanterns.example', 'Vaughn',  'Ellis',     '(415) 555-0164', 'San Rafael',    '94901', false, NULL),
  (25, 'vince.becker@brightwave.example',    'Vince',   'Becker',    '(415) 555-0156', 'San Francisco', '94105', false, NULL)
) AS t(n, email, first_name, last_name, phone, city, postal, login, seen);

INSERT INTO auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   confirmation_token, recovery_token, email_change_token_new, email_change,
   email_change_token_current, phone_change, phone_change_token, reauthentication_token,
   raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at, last_sign_in_at,
   email_change_confirm_status, is_sso_user, is_anonymous)
SELECT '00000000-0000-0000-0000-000000000000', pg_temp.d(2, u.n), 'authenticated', 'authenticated', u.email,
       crypt('demo1pass', gen_salt('bf')), pg_temp.at(pg_temp.anchor() - 400, 10),
       '', '', '', '', '', '', '', '',
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('first_name', u.first_name, 'last_name', u.last_name, 'email_verified', true),
       false, pg_temp.at(pg_temp.anchor() - 400, 10), now(), pg_temp.at(pg_temp.anchor() - u.seen, 9 + u.n),
       0, false, false
  FROM _u u WHERE u.login;

INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
SELECT au.id::text, au.id,
       jsonb_build_object('sub', au.id::text, 'email', au.email, 'email_verified', true, 'phone_verified', false),
       'email', au.last_sign_in_at, au.created_at, now()
  FROM auth.users au
 WHERE au.id::text LIKE 'de000000-0000-4000-8000-%';

INSERT INTO public.users
  (id, email, first_name, last_name, phone, avatar_url, address_line1, address_line2, city, state,
   postal_code, country, user_status, timezone, platform_moderator)
SELECT pg_temp.d(2, u.n), u.email, u.first_name, u.last_name, u.phone, '', '', '', u.city, 'CA',
       u.postal, 'US', CASE WHEN u.login THEN 'active' ELSE 'contact' END, 'America/Los_Angeles', u.n = 6
  FROM _u u;

-- Memberships. Crew without logins are Staff (the Add Team Member default);
-- partner contacts are Viewers with a title.
INSERT INTO public.organization_members
  (organization_id, user_id, role, default_staff_role_id, is_primary_contact, contact_title, created_at)
SELECT pg_temp.d(1, m.org), pg_temp.d(2, m.usr), m.role::user_role,
       (SELECT id FROM public.staff_roles WHERE name = m.staff_role),
       m.prim, m.title, pg_temp.at(pg_temp.anchor() - 380 + m.usr, 10)
  FROM (VALUES
    (1, 1,  'Admin',   'Stage Manager',    true,  'Owner'),
    (1, 2,  'Manager', 'Stage Manager',    false, 'Production Manager'),
    (1, 3,  'Staff',   'FOH Engineer',     false, 'Audio Engineer'),
    (1, 4,  'Viewer',  NULL,               false, 'Bookkeeper'),
    (1, 11, 'Staff',   'Stage Hand',       false, 'Stagehand (freelance)'),
    (1, 12, 'Staff',   'Lighting Tech',    false, 'Lighting Designer (freelance)'),
    (1, 13, 'Staff',   'Monitor Engineer', false, 'Monitor Engineer (freelance)'),
    (1, 14, 'Staff',   'FOH Engineer',     false, 'FOH Engineer (freelance)'),
    (1, 15, 'Staff',   'Stage Hand',       false, 'Stagehand (freelance)'),
    (2, 21, 'Viewer',  NULL,               true,  'Venue Manager'),
    (3, 22, 'Viewer',  NULL,               true,  'House Manager'),
    (4, 23, 'Viewer',  NULL,               true,  'Tour Manager'),
    (5, 24, 'Viewer',  NULL,               true,  'Band Manager'),
    (6, 25, 'Viewer',  NULL,               true,  'Event Producer')
  ) AS m(org, usr, role, staff_role, prim, title);

-- One pending invitation (Team → Pending Invitations). The address is fake;
-- no email is sent by seeding.
INSERT INTO public.invitations (organization_id, email, role, invited_by, status, token, expires_at, created_at, updated_at)
VALUES (pg_temp.d(1,1), 'jordan.blake@crew.example', 'Staff', pg_temp.d(2,1), 'pending',
        md5('demo-invitation-1'), pg_temp.at(pg_temp.anchor() + 5, 9), pg_temp.at(pg_temp.anchor() - 2, 9),
        pg_temp.at(pg_temp.anchor() - 2, 9));

-- Access requests (ID kind 0013) and the notifications they send (kind 0014),
-- in the shape supabase/functions/server/routes/accessRequests.ts writes them:
--   1 Sofia (Staff) asks for Manager at Demo Sound & Lighting: pending, for Alicia.
--   2 Victor (Viewer) asked for Admin: rejected by Alicia, with a reply.
--   3 Vera asks for Admin of Cedar Hall, which no one has claimed: pending, for
--     the platform moderator.
INSERT INTO public.access_requests (id, organization_id, requester_id, requested_role, message, status, handled_by, handled_at, response_message, created_at)
VALUES
  (pg_temp.d(13,1), pg_temp.d(1,1), pg_temp.d(2,3), 'Manager', 'I''m running FOH on most of our gigs now and would like to set up staffing myself.',
     'pending', NULL, NULL, NULL, pg_temp.at(pg_temp.anchor() - 1, 7)),
  (pg_temp.d(13,2), pg_temp.d(1,1), pg_temp.d(2,4), 'Admin', 'I need to see Financials to do the books.',
     'rejected', pg_temp.d(2,1), pg_temp.at(pg_temp.anchor() - 3, 9), 'Admin is more than you need. Let''s talk about Manager, which includes Financials.',
     pg_temp.at(pg_temp.anchor() - 4, 16)),
  (pg_temp.d(13,3), pg_temp.d(1,3), pg_temp.d(2,22), 'Admin', 'I''m the house manager at Cedar Hall and would like to manage our listing.',
     'pending', NULL, NULL, NULL, pg_temp.at(pg_temp.anchor() - 2, 11));

INSERT INTO public.notifications (id, recipient_id, type, payload, read_at, created_at)
VALUES
  (pg_temp.d(14,1), pg_temp.d(2,1), 'access_request.created',
     jsonb_build_object('access_request_id', pg_temp.d(13,1), 'organization_id', pg_temp.d(1,1), 'organization_name', 'Demo Sound & Lighting',
                        'requester_name', 'Sofia Lindqvist', 'requested_role', 'Manager'),
     NULL, pg_temp.at(pg_temp.anchor() - 1, 7)),
  (pg_temp.d(14,2), pg_temp.d(2,4), 'access_request.outcome',
     jsonb_build_object('access_request_id', pg_temp.d(13,2), 'organization_id', pg_temp.d(1,1), 'organization_name', 'Demo Sound & Lighting',
                        'requested_role', 'Admin', 'status', 'rejected',
                        'response_message', 'Admin is more than you need. Let''s talk about Manager, which includes Financials.'),
     NULL, pg_temp.at(pg_temp.anchor() - 3, 9)),
  (pg_temp.d(14,3), pg_temp.d(2,6), 'access_request.created',
     jsonb_build_object('access_request_id', pg_temp.d(13,3), 'organization_id', pg_temp.d(1,3), 'organization_name', 'Cedar Hall',
                        'requester_name', 'Vera Holm', 'requested_role', 'Admin'),
     NULL, pg_temp.at(pg_temp.anchor() - 2, 11));

-- -----------------------------------------------------------------------------
-- 4. CATEGORIES: copy the starter sets for the primary org, as
--    ensure_org_categories() does the first time the app needs them.
-- -----------------------------------------------------------------------------
INSERT INTO public.expense_categories (organization_id, name, schedule_c_line, sort_order, active)
SELECT pg_temp.d(1,1), name, schedule_c_line, sort_order, active
  FROM public.expense_categories WHERE organization_id IS NULL;
INSERT INTO public.equipment_categories (organization_id, name, sort_order, active)
SELECT pg_temp.d(1,1), name, sort_order, active
  FROM public.equipment_categories WHERE organization_id IS NULL;

-- -----------------------------------------------------------------------------
-- 5. GIGS: about 8 weeks back to 14 weeks ahead of the anchor.
--    wk/dow place day one (dow 3 = Thu, 4 = Fri, 5 = Sat); days = length;
--    loadin/show = local clock hours (show by 8 PM so load-out ends by 11:30 PM
--    and the gig stays on one calendar day; New Year's Eve runs past midnight). venue/act/act2/client = org numbers.
--    kind: 'band' (act on stage) or 'program' (corporate, no act).
--    fill: staffing state. full = every slot confirmed; near = mostly confirmed;
--          early = a few requests out; open = slots only; none = no slots.
-- -----------------------------------------------------------------------------
CREATE TEMP TABLE _g ON COMMIT DROP AS
SELECT g.*, pg_temp.day(g.wk, g.dow) AS gd FROM (VALUES
  (1,  'Harborlight Summer Wrap Party',        'Settled',   -8, 5, 1, 15.0, 20.0, 2, 4,    NULL::int, 6, 'band',    'full',  ARRAY[1,2,3,4],   ARRAY['Corporate','Outdoor'],  'End-of-season party on the pavilion terrace. Neon Orchard plays two sets, DJ after.'),
  (2,  'Neon Orchard Album Release Show',      'Settled',   -7, 4, 1, 15.5, 20.0, 3, 4,    NULL,      4, 'band',    'full',  ARRAY[1,2,3,4],   ARRAY['Concert'],              'Sold-out album release. The band brings its own lighting designer; we run the rig.'),
  (3,  'Brightwave Corporate Kickoff',         'Settled',   -6, 3, 1, 13.0, 17.0, 2, NULL, NULL,      6, 'program', 'full',  ARRAY[1,4,5],     ARRAY['Corporate'],            'Keynotes and a networking reception. Playback from a laptop at FOH.'),
  (4,  'Paper Lanterns Acoustic Night',        'Completed', -4, 4, 1, 16.0, 20.0, 3, 5,    NULL,      5, 'band',    'full',  ARRAY[1,2,4],     ARRAY['Concert'],              'Seated listening-room show. Keep stage volume low.'),
  (5,  'Fall Food & Wine Festival Main Stage', 'Completed', -2, 5, 2,  9.0, 13.0, 2, 4,    5,         6, 'band',    'full',  ARRAY[1,2,3,4,5], ARRAY['Festival','Outdoor'],   'Two days on the pavilion lawn. Rental truck for the load; stage left overnight under security.'),
  (6,  'Cedar Hall Open Mic Series',           'Cancelled', -1, 4, 1, 16.0, 19.0, 3, NULL, NULL,      3, 'band',    'none',  ARRAY[]::int[],   ARRAY['Concert'],              'Cancelled by the venue (water damage in the green room). No fee was due.'),
  (7,  'Harvest Gala Dinner & Dance',          'Booked',     0, 5, 1, 14.0, 20.0, 2, 4,    NULL,      6, 'band',    'near',  ARRAY[1,2,3,4,5], ARRAY['Corporate','Gala'],     'Plated dinner at 7, then a 90-minute set. Vince is the day-of contact.'),
  (8,  'Cedar Hall Fall Songwriter Showcase',  'Booked',     1, 5, 1, 16.0, 19.5, 3, 5,    NULL,      3, 'band',    'near',  ARRAY[1,4],       ARRAY['Concert'],              'Four songwriters, Paper Lanterns closing. Simple vocal and acoustic guitar inputs.'),
  (9,  'Paper Lanterns Winter Tour Kickoff',   'Booked',     2, 4, 1, 16.0, 20.0, 3, 5,    NULL,      5, 'band',    'early', ARRAY[1,2,4],     ARRAY['Concert'],              'First night of the winter run. Moved up a day to Friday at the band''s request.'),
  (10, 'Neon Orchard Halloween Bash',          'Booked',     3, 5, 1, 15.0, 20.0, 2, 4,    NULL,      4, 'band',    'early', ARRAY[1,2,3,4],   ARRAY['Concert','Holiday'],    'Costume party. Haze is approved by the venue; fog is not.'),
  (11, 'Neon Orchard Live at Cedar Hall',      'Booked',     5, 5, 1, 15.5, 20.0, 3, 4,    NULL,      3, 'band',    'open',  ARRAY[1,2,3,4],   ARRAY['Concert'],              'Seated show, live recording. Their engineer takes a split from our stage box.'),
  (12, 'Brightwave Client Appreciation Night', 'Booked',     6, 4, 1, 14.0, 19.0, 2, NULL, NULL,      6, 'program', 'open',  ARRAY[1,3,4],     ARRAY['Corporate'],            'Speeches, awards and background music on the terrace.'),
  (13, 'Holiday Lights Concert',               'Booked',     9, 5, 1, 15.0, 20.0, 2, 4,    5,         6, 'band',    'open',  ARRAY[1,2,3,4],   ARRAY['Concert','Holiday'],    'Ticketed holiday show with the full lighting package.'),
  (14, 'Winter Street Fair',                   'DateHold',  10, 5, 1,  8.0, 11.0, 3, NULL, NULL,      3, 'band',    'none',  ARRAY[]::int[],   ARRAY['Outdoor'],              'Holding the date while the city street-closure permit is pending.'),
  (15, 'New Year''s Eve Countdown Ball',       'Proposed',  12, 3, 1, 14.0, 21.0, 2, 4,    NULL,      6, 'band',    'open',  ARRAY[1,2,3,4,5], ARRAY['Gala','Holiday'],      'Awaiting client sign-off on the proposal.'),
  (16, 'Brightwave Annual Summit',             'Proposed',  14, 3, 2,  7.0,  9.0, 2, NULL, NULL,      6, 'program', 'none',  ARRAY[]::int[],   ARRAY['Corporate'],            'Two-day summit. Quoted for both days; staffing once the agenda is final.'),
  -- A deliberate conflict: the same Saturday as gig 8, sharing Sam (stagehand) and the
  -- Main PA (inside gig 8's Full Band Sound Package). For the conflict-detection shots.
  (17, 'Brightwave Rooftop Mixer',             'Proposed',   1, 5, 1, 15.0, 19.0, 2, NULL, NULL,      6, 'program', 'near',  ARRAY[1,4],       ARRAY['Corporate'],            'Same night as the Songwriter Showcase: crew and PA need sorting before we confirm.')
) AS g(n, title, status, wk, dow, days, loadin, show, venue, act, act2, client, kind, fill, slots, tags, notes);

-- Every gig is owned by the demo organization (#175), which is a participant on each.
INSERT INTO public.gigs (id, title, status, tags, start, "end", timezone, notes, created_by, updated_by, created_at, updated_at, owner_organization_id)
SELECT pg_temp.d(3, g.n), g.title, g.status::gig_status, g.tags,
       pg_temp.at(g.gd, g.loadin),
       pg_temp.at(g.gd + (g.days - 1), g.show + 3.5),
       'America/Los_Angeles', g.notes,
       pg_temp.d(2, CASE WHEN g.n % 3 = 0 THEN 2 ELSE 1 END), pg_temp.d(2, 2),
       pg_temp.at(LEAST(g.gd - 60, pg_temp.anchor() - (16 - g.n)), 11),
       pg_temp.at(LEAST(g.gd + 3, pg_temp.anchor()), 12),
       pg_temp.d(1, 1)
  FROM _g g;

-- Participants. k: 1 venue, 2 act, 3 second act, 4 agency, 5 our org.
INSERT INTO public.gig_participants (id, gig_id, organization_id, role, is_client)
SELECT pg_temp.d(10, g.n * 10 + p.k), pg_temp.d(3, g.n), pg_temp.d(1, p.org), p.role::organization_role, p.org = g.client
  FROM _g g
 CROSS JOIN LATERAL (VALUES
    (1, g.venue, 'Venue'), (2, g.act, 'Act'), (3, g.act2, 'Act'),
    (4, CASE WHEN g.client = 6 THEN 6 END, 'Agency'), (5, 1, 'Sound')
 ) AS p(k, org, role)
 WHERE p.org IS NOT NULL;

-- Each partner org's contact is the day-of contact on its gigs.
INSERT INTO public.gig_participant_contacts (gig_id, organization_id, user_id, is_primary_contact, title)
SELECT gp.gig_id, gp.organization_id, pg_temp.d(2, c.usr), true, c.title
  FROM public.gig_participants gp
  JOIN (VALUES (2, 21, 'Venue manager'), (3, 22, 'House manager'), (4, 23, 'Tour manager'),
               (5, 24, 'Band manager'), (6, 25, 'Day-of producer')) AS c(org, usr, title)
    ON gp.organization_id = pg_temp.d(1, c.org)
 WHERE gp.gig_id::text LIKE 'de000000-0000-4000-8000-%';

-- Schedule, per day: load-in (day one), soundcheck, doors, set (or program), load-out (last day).
-- Gigs on hold or cancelled have no schedule yet.
INSERT INTO public.gig_schedule_entries (gig_id, activity_type, label, start_time, end_time, act_participant_id, sort_order, notes)
SELECT pg_temp.d(3, g.n), e.activity_type, e.label,
       pg_temp.at(g.gd + dd.i, e.s), pg_temp.at(g.gd + dd.i, e.s + e.len),
       CASE WHEN e.act_linked THEN pg_temp.d(10, g.n * 10 + 2) END,
       dd.i * 10 + e.sort_order, e.notes
  FROM _g g
 CROSS JOIN LATERAL generate_series(0, g.days - 1) AS dd(i)
 CROSS JOIN LATERAL (VALUES
    ('Load-In',    NULL::text,               g.loadin,     2.0, false, 1, 'Dock access via the service alley.', dd.i = 0),
    ('Soundcheck', CASE WHEN g.kind = 'program' THEN 'Mic and playback check' END,
                                             g.show - 2.5, 1.0, g.kind = 'band', 2, NULL, true),
    ('Doors',      NULL,                     g.show - 1.0, 1.0, false, 3, NULL, true),
    ('Set',        CASE WHEN g.kind = 'program' THEN 'Keynotes and program' END,
                                             g.show,       1.5, g.kind = 'band', 4,
                   CASE WHEN g.kind = 'program' THEN 'Two wireless handhelds on stage.' END, true),
    ('Load-Out',   NULL,                     g.show + 2.0, 1.5, false, 5, 'Crew out by midnight.', dd.i = g.days - 1)
 ) AS e(activity_type, label, s, len, act_linked, sort_order, notes, on_day)
 WHERE g.status NOT IN ('DateHold','Cancelled') AND e.on_day;

-- -----------------------------------------------------------------------------
-- 6. STAFFING: slots (n = gig*10 + k) and assignments
--    k: 1 FOH Engineer, 2 Monitor Engineer, 3 Lighting Tech, 4 Stage Hand (needs 2), 5 Stage Manager
--    Who: FOH = Sofia (Staff login) on odd gigs, Sergio on even; Monitors = Simone;
--    Lighting = Shane; Stage Hands = Sam and Skye; Stage Manager = Marcus.
-- -----------------------------------------------------------------------------
INSERT INTO public.gig_staff_slots (id, gig_id, staff_role_id, organization_id, required_count, notes)
SELECT pg_temp.d(8, g.n * 10 + k), pg_temp.d(3, g.n),
       (SELECT id FROM public.staff_roles WHERE name = r.name), pg_temp.d(1,1),
       CASE WHEN k = 4 THEN 2 ELSE 1 END, NULL
  FROM _g g
 CROSS JOIN LATERAL unnest(g.slots) AS k
  JOIN (VALUES (1,'FOH Engineer'),(2,'Monitor Engineer'),(3,'Lighting Tech'),(4,'Stage Hand'),(5,'Stage Manager')) AS r(rk, name)
    ON r.rk = k;

-- One row per person: (k, seat, user). Seat 2 is the second stagehand.
CREATE TEMP TABLE _who ON COMMIT DROP AS
SELECT * FROM (VALUES (1,1,0),(2,1,13),(3,1,12),(4,1,11),(4,2,15),(5,1,2)) AS t(k, seat, usr);

-- Status by fill: full = all Confirmed; near = all but lighting and the second
-- stagehand Confirmed (lighting Requested, second stagehand open);
-- early = FOH and monitors Requested, rest open; open/none = nobody yet.
-- Pay (#171): FOH and monitors get a flat fee; the lighting tech $400 / day, stagehands
-- $35 / hr and the stage manager $200 / half day.
INSERT INTO public.gig_staff_assignments (id, slot_id, user_id, status, fee, rate, rate_unit, notes, assigned_at, confirmed_at)
SELECT pg_temp.d(9, (w.seat - 1) * 500 + g.n * 10 + w.k), pg_temp.d(8, g.n * 10 + w.k),
       pg_temp.d(2, CASE WHEN w.k = 1 THEN CASE WHEN g.n % 2 = 1 THEN 3 ELSE 14 END ELSE w.usr END),
       st.status,
       CASE w.k WHEN 1 THEN 350 WHEN 2 THEN 300 END,
       CASE w.k WHEN 3 THEN 400 WHEN 4 THEN 35 WHEN 5 THEN 200 END,
       CASE w.k WHEN 3 THEN 'day' WHEN 5 THEN 'half_day' ELSE 'hour' END,
       NULL,
       pg_temp.at(LEAST(g.gd - 21, pg_temp.anchor() - 2), 10),
       CASE WHEN st.status = 'Confirmed' THEN pg_temp.at(LEAST(g.gd - 14, pg_temp.anchor() - 1), 16) END
  FROM _g g
  JOIN _who w ON w.k = ANY (g.slots)
 CROSS JOIN LATERAL (SELECT CASE
     WHEN g.fill = 'full' THEN 'Confirmed'
     WHEN g.fill = 'near' AND w.k = 3 THEN 'Requested'
     WHEN g.fill = 'near' AND w.seat = 2 THEN NULL
     WHEN g.fill = 'near' THEN 'Confirmed'
     WHEN g.fill = 'early' AND w.k IN (1, 2) THEN 'Requested'
   END AS status) st
 WHERE st.status IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 7. EQUIPMENT: 26 items; serialized gear as tagged units, the rest as counted lots;
--    6 kits (one nested, two containers); kit assignments; scan locations.
--    pur: 0 = bought outside the tracked invoices, else the purchase it came on (section 8)
-- -----------------------------------------------------------------------------
CREATE TEMP TABLE _a ON COMMIT DROP AS
SELECT * FROM (VALUES
  (1,  'Halden HX-12P Powered Speaker',             'Speaker, Powered, Full-Range',    'Audio',            849.00,  4, 'Stagecraft Supply Co.', 0, 'Active',      '12-inch two-way powered loudspeaker'),
  (2,  'Halden HS-18 Powered Subwoofer',            'Speaker, Powered, Subwoofer',     'Audio',           1099.00,  2, 'Stagecraft Supply Co.', 0, 'Active',      '18-inch powered subwoofer'),
  (3,  'Halden HX-8M Floor Monitor',                'Speaker, Monitor, Wedge',         'Audio',            429.00,  4, 'Stagecraft Supply Co.', 0, 'Active',      'Powered stage wedge'),
  (4,  'Quillon QM-32 Digital Mixing Console',      'Mixer, Digital',                  'Audio',           4299.00,  1, 'Stagecraft Supply Co.', 1, 'Active',      '32-channel digital console'),
  (5,  'Quillon QS-16 Digital Stage Box',           'Mixer, Stage Box',                'Audio',           1199.00,  1, 'Stagecraft Supply Co.', 1, 'Active',      '16 in / 8 out remote stage box'),
  (6,  'Quillon QM-12 Compact Digital Mixer',       'Mixer, Digital',                  'Audio',            799.00,  1, 'Stagecraft Supply Co.', 0, 'Active',      '12-channel mixer for small rooms'),
  (7,  'Tessel T58 Dynamic Vocal Microphone',       'Microphone, Dynamic, Vocal',      'Audio',             99.00,  6, 'Stagecraft Supply Co.', 1, 'Active',      NULL),
  (8,  'Tessel T57 Dynamic Instrument Microphone',  'Microphone, Dynamic, Instrument', 'Audio',             89.00,  4, 'Stagecraft Supply Co.', 0, 'Active',      NULL),
  (9,  'Tessel W2 Wireless Handheld System',        'Microphone, Wireless',            'Audio',            649.00,  2, 'Stagecraft Supply Co.', 0, 'Active',      'Dual-channel wireless with handheld transmitters'),
  (10, 'Tessel K91 Kick Drum Microphone',           'Microphone, Dynamic, Drum',       'Audio',            179.00,  1, 'Stagecraft Supply Co.', 0, 'Active',      NULL),
  (11, 'Linebacker PDI-1 Passive DI Box',           'DI Box, Passive',                 'Audio',             49.00,  8, 'Stagecraft Supply Co.', 1, 'Active',      NULL),
  (12, 'Linebacker ADI-2 Active DI Box',            'DI Box, Active',                  'Audio',            129.00,  4, 'Stagecraft Supply Co.', 0, 'Active',      NULL),
  (13, 'Fennimore LED Par 64 RGBW',                 'Light Fixture, LED Par',          'Lighting',         129.00, 12, 'Brightline Lighting',   4, 'Active',      'RGBW wash par, DMX'),
  (14, 'Fennimore Spot 150 Moving Head',            'Light Fixture, Moving Head, Spot','Lighting',         549.00,  4, 'Brightline Lighting',   4, 'Active',      '150 W LED moving head spot'),
  (15, 'Fennimore Wash Bar 8',                      'Light Fixture, LED Bar',          'Lighting',         219.00,  4, 'Brightline Lighting',   0, 'Active',      'Eight-cell RGBW LED wash bar'),
  (16, 'Brightforge Cue-Pro 512 Lighting Controller','Lighting Console, DMX',          'Lighting',         699.00,  1, 'Brightline Lighting',   4, 'Active',      '512-channel DMX controller'),
  (17, 'DMX Cable 5-pin, 25 ft',                    'Cable, DMX',                      'Lighting',          19.00, 12, 'Cablesmith Direct',     0, 'Active',      NULL),
  (18, 'XLR Cable, 25 ft',                          'Cable, XLR',                      'Audio',             14.00, 30, 'Cablesmith Direct',     2, 'Active',      NULL),
  (19, 'XLR Cable, 50 ft',                          'Cable, XLR',                      'Audio',             22.00, 10, 'Cablesmith Direct',     2, 'Active',      NULL),
  (20, 'Speakon Speaker Cable, 50 ft',              'Cable, Speaker',                  'Audio',             39.00,  8, 'Cablesmith Direct',     0, 'Active',      NULL),
  (21, 'Voltline PD-20 Power Distribution',         'Power Distribution, 20A',         'Power',            389.00,  2, 'Stagecraft Supply Co.', 0, 'Active',      NULL),
  (22, 'Edison Extension Cord, 50 ft',              'Cable, Power',                    'Power',             34.00, 10, 'Cablesmith Direct',     0, 'Active',      NULL),
  (23, 'Armorline 8U Rack Case',                    'Case, Rack, Shock-Mount',         'Cases and Bags',   189.00,  3, 'Stagecraft Supply Co.', 0, 'Active',      NULL),
  (24, 'Spanline T-10 Truss Section, 10 ft',        'Truss, Box',                      'Rigging and Truss',249.00,  8, 'Brightline Lighting',   0, 'Active',      NULL),
  (25, 'Speaker Stand, Tripod',                     'Stand, Speaker',                  'Rigging and Truss', 59.00,  6, 'Stagecraft Supply Co.', 0, 'Active',      NULL),
  (26, 'Netline 8-Port PoE Switch',                 'Network Switch',                  'Networking',       119.00,  2, 'Stagecraft Supply Co.', 0, 'Active',      NULL)
) AS t(n, model, type, category, price, qty, vendor, pur, status, descr);

-- Purchase headers: (n, days before anchor, vendor, buyer, description, sales-tax factor,
-- recovery years for its depreciated lines). Totals are filled in after the lines exist.
CREATE TEMP TABLE _p ON COMMIT DROP AS
SELECT * FROM (VALUES
  (1, 200, 'Stagecraft Supply Co.', 1, 'Invoice SS-20418: console, stage box, mics and DI boxes', 1.0875, 7),
  (2,  75, 'Cablesmith Direct',     1, 'Order CD-77231: cables and consumables',                 1.07,   NULL::int),
  (3,  12, 'Harbor Truck Rental',   2, 'Rental agreement HT-5509: festival load-in truck',       1.10,   NULL),
  (4, 140, 'Brightline Lighting',   1, 'Invoice BL-3172: LED pars, moving heads and controller', 1.09,   7)
) AS t(n, ago, vendor, usr, descr, factor, years);

INSERT INTO public.purchases
  (id, organization_id, row_type, purchase_date, vendor, total_inv_amount, payment_method, description, created_by, updated_by)
SELECT pg_temp.d(6, p.n), pg_temp.d(1,1), 'header', pg_temp.anchor() - p.ago, p.vendor, 0, 'Business Visa', p.descr,
       pg_temp.d(2, p.usr), pg_temp.d(2, p.usr)
  FROM _p p;

-- What each piece of equipment IS (#180): one item per model (ID kind 0015).
INSERT INTO public.equipment_items (id, organization_id, category, manufacturer_model, type, description, created_by, updated_by)
SELECT pg_temp.d(15, a.n), pg_temp.d(1,1), a.category, a.model, a.type, a.descr, pg_temp.d(2,1), pg_temp.d(2,1)
  FROM _a a;

-- What we OWN: serialized gear as tagged units (quantity 1 each), everything else as
-- one counted lot with no serial or tag. Unit k of item n is asset d(4, n*100 + k);
-- a lot is d(4, n*100). Two of the four wash bars are on the repair bench.
CREATE TEMP TABLE _own ON COMMIT DROP AS
SELECT a.*, k.k AS unit_no, CASE WHEN k.k = 0 THEN a.qty ELSE 1 END AS own_qty,
       CASE WHEN a.n = 15 AND k.k IN (3, 4) THEN 'Maintenance' ELSE a.status END AS own_status
  FROM _a a
 CROSS JOIN LATERAL (
   SELECT generate_series(1, a.qty) AS k WHERE a.n IN (1, 2, 3, 4, 5, 6, 9, 14, 15, 16, 21)
   UNION ALL
   SELECT 0 WHERE a.n NOT IN (1, 2, 3, 4, 5, 6, 9, 14, 15, 16, 21)
 ) k;

INSERT INTO public.assets
  (id, organization_id, equipment_item_id, acquisition_date, vendor, item_cost, category, insurance_policy_added,
   manufacturer_model, type, serial_number, description, replacement_value, quantity, created_by, updated_by,
   tag_number, status, item_price, purchase_id)
SELECT pg_temp.d(4, o.n * 100 + o.unit_no), pg_temp.d(1,1), pg_temp.d(15, o.n),
       COALESCE(pg_temp.anchor() - p.ago, pg_temp.anchor() - (260 + o.n * 23)),
       o.vendor,
       round(o.price * COALESCE(p.factor, 1), 2),
       o.category, (o.price * o.own_qty >= 500), o.model, o.type,
       CASE WHEN o.unit_no > 0 THEN 'DSL' || lpad(o.n::text, 3, '0') || '-' || (24000 + o.n * 37 + o.unit_no)::text END,
       CASE WHEN o.n = 15 AND o.unit_no IN (3, 4) THEN 'DMX input drops out; on the repair bench' END,
       round(o.price * 1.15), o.own_qty, pg_temp.d(2,1), pg_temp.d(2,1),
       -- A serial or tag means one physical thing (#180): only units carry them.
       CASE WHEN o.unit_no > 0 THEN 'DSL-' || lpad((o.n * 10 + o.unit_no)::text, 4, '0') END,
       o.own_status, o.price,
       CASE WHEN o.pur > 0 THEN pg_temp.d(6, o.pur) END
  FROM _own o
  LEFT JOIN _p p ON p.n = o.pur;

-- Kits. K4 is a nested kit: it holds K1, K2 and two containers. Containers (K5, K6)
-- are cases or boxes picked up as one item, so packing lists show them as one line.
INSERT INTO public.kits (id, organization_id, name, category, description, tags, tag_number, rental_value, created_by, updated_by, is_container)
VALUES
  (pg_temp.d(5,1), pg_temp.d(1,1), 'FOH Console Package',           'Audio',    'Console, stage box and snake for a front-of-house position.', ARRAY['FOH'],            'KIT-001', 650.00,  pg_temp.d(2,1), pg_temp.d(2,1), false),
  (pg_temp.d(5,2), pg_temp.d(1,1), 'Main PA: 4 Top / 2 Sub',        'Audio',    'Four powered tops, two subs, cables and stands.',            ARRAY['PA'],             'KIT-002', 1100.00, pg_temp.d(2,1), pg_temp.d(2,1), false),
  (pg_temp.d(5,3), pg_temp.d(1,1), 'Club Lighting Package',         'Lighting', 'LED pars, moving heads, controller and truss.',              ARRAY['Lighting'],       'KIT-003', 900.00,  pg_temp.d(2,1), pg_temp.d(2,1), false),
  (pg_temp.d(5,4), pg_temp.d(1,1), 'Full Band Sound Package',       'Audio',    'FOH package, main PA, monitors, mic case and cable box: everything for a five-piece band.', ARRAY['Band','Sound'], 'KIT-004', 2200.00, pg_temp.d(2,1), pg_temp.d(2,1), false),
  (pg_temp.d(5,5), pg_temp.d(1,1), 'Mic Case',                      'Audio',    'Road case with vocal, instrument and kick mics plus DI boxes.', ARRAY['Mics'],         'CASE-01', 150.00,  pg_temp.d(2,1), pg_temp.d(2,1), true),
  (pg_temp.d(5,6), pg_temp.d(1,1), 'XLR Cable Box',                 'Audio',    'Tote of 25 ft and 50 ft XLR cables.',                        ARRAY['Cables'],         'CASE-02', 60.00,   pg_temp.d(2,1), pg_temp.d(2,1), true);

-- A kit line is one of three things (#180): a specific unit or lot (item, unit; unit 0
-- = the lot), "N x any" unit of an item (any), or another kit (child).
INSERT INTO public.kit_components (kit_id, asset_id, equipment_item_id, child_kit_id, quantity, notes)
SELECT pg_temp.d(5, c.kit),
       CASE WHEN c.item IS NOT NULL THEN pg_temp.d(4, c.item * 100 + c.unit) END,
       CASE WHEN c.anyof IS NOT NULL THEN pg_temp.d(15, c.anyof) END,
       CASE WHEN c.child IS NOT NULL THEN pg_temp.d(5, c.child) END, c.qty, c.notes
  FROM (VALUES
    -- K1 FOH Console Package: this console and stage box, plus cables, rack and switch
    (1, 4,    1,    NULL::int, NULL::int, 1, NULL::text), (1, 5, 1, NULL, NULL, 1, NULL),
    (1, 19,   0,    NULL, NULL, 2, 'Console to stage box'), (1, 23, 0, NULL, NULL, 1, NULL), (1, 26, 0, NULL, NULL, 1, NULL),
    -- K2 Main PA: any four tops and two subs, with their cables, stands and power
    (2, NULL, NULL, 1,    NULL, 4, NULL), (2, NULL, NULL, 2, NULL, 2, NULL),
    (2, 20,   0,    NULL, NULL, 6, NULL), (2, 25, 0, NULL, NULL, 4, NULL), (2, 21, 1, NULL, NULL, 1, NULL),
    -- K3 Club Lighting: pars, any two moving heads, this controller, cables, truss and power
    (3, 13,   0,    NULL, NULL, 8, NULL), (3, NULL, NULL, 14, NULL, 2, NULL), (3, 16, 1, NULL, NULL, 1, NULL),
    (3, 17,   0,    NULL, NULL, 6, NULL), (3, 24, 0, NULL, NULL, 4, NULL), (3, 22, 0, NULL, NULL, 4, NULL),
    -- K5 Mic Case (container)
    (5, 7,    0,    NULL, NULL, 4, NULL), (5, 8, 0, NULL, NULL, 2, NULL), (5, 10, 0, NULL, NULL, 1, NULL),
    (5, 11,   0,    NULL, NULL, 6, NULL), (5, 12, 0, NULL, NULL, 2, NULL),
    -- K6 XLR Cable Box (container)
    (6, 18,   0,    NULL, NULL, 16, NULL), (6, 19, 0, NULL, NULL, 4, NULL),
    -- K4 Full Band Sound Package (nested: K1, K2 and both containers, plus any four wedges)
    (4, NULL, NULL, NULL, 1, 1, NULL), (4, NULL, NULL, NULL, 2, 1, NULL),
    (4, NULL, NULL, NULL, 5, 1, NULL), (4, NULL, NULL, NULL, 6, 1, NULL),
    (4, NULL, NULL, 3,    NULL, 4, 'Four monitor mixes')
  ) AS c(kit, item, unit, anyof, child, qty, notes);

-- Kits per gig: band gigs get the full band package (bigger ones add lighting),
-- program gigs the PA only.
INSERT INTO public.gig_kit_assignments (organization_id, gig_id, kit_id, notes, assigned_by, assigned_at)
SELECT pg_temp.d(1,1), pg_temp.d(3, g.n), pg_temp.d(5, k.kit), NULL, pg_temp.d(2,2),
       pg_temp.at(LEAST(g.gd - 10, pg_temp.anchor() - 1), 15)
  FROM _g g
 CROSS JOIN LATERAL (VALUES
    (CASE WHEN g.kind = 'band' THEN 4 ELSE 2 END),
    (CASE WHEN 3 = ANY (g.slots) THEN 3 END)
 ) AS k(kit)
 WHERE k.kit IS NOT NULL AND g.status NOT IN ('DateHold','Cancelled') AND g.fill <> 'none';

-- Last known locations (Location Explorer; every scan belongs to a gig). A unit scans
-- as one; a lot scans as a count (quantity). The FOH package was staged yesterday for
-- this Saturday's gala, the lighting kit was checked in after the festival, and two wash
-- bars went to the repair bench. (item, unit, count); unit 0 = the lot.
INSERT INTO public.inventory_tracking (id, organization_id, gig_id, kit_id, asset_id, quantity, status, scanned_at, scanned_by, notes, location)
SELECT pg_temp.d(12, row_number() OVER ()::int), pg_temp.d(1,1), s.gig, s.kit, pg_temp.d(4, s.item * 100 + s.unit), s.cnt,
       s.status, pg_temp.at(pg_temp.anchor() - s.ago, s.hr), pg_temp.d(2, s.usr), s.notes, s.location
  FROM (
    -- Scans of a nested (non-container) kit's gear belong to the top kit assigned to the
    -- gig, as the scanner records them: the FOH package rides in the Full Band package (K4).
    SELECT pg_temp.d(3,7) AS gig, pg_temp.d(5,4) AS kit, c.item, c.unit, c.cnt, 'Checked Out' AS status,
           1 AS ago, 16.0 AS hr, 3 AS usr, NULL::text AS notes, 'Staging Area' AS location
      FROM (VALUES (4,1,1),(5,1,1),(19,0,2),(23,0,1),(26,0,1)) AS c(item, unit, cnt)
    UNION ALL
    SELECT pg_temp.d(3,5), pg_temp.d(5,3), c.item, c.unit, c.cnt, 'In Warehouse', 9, 17.0, 2, 'Checked in after the festival', 'Warehouse, Bay 2'
      FROM (VALUES (13,0,8),(14,1,1),(14,2,1),(16,1,1),(17,0,6),(24,0,4),(22,0,4)) AS c(item, unit, cnt)
    UNION ALL
    SELECT pg_temp.d(3,5), NULL, 15, c.unit, 1, 'In Warehouse', 8, 14.0, 2, 'DMX input drops out', 'Repair Bench'
      FROM (VALUES (3),(4)) AS c(unit)
    -- Still out after the festival (the gig's Not returned list): a vocal mic from the
    -- band package, and one floor monitor last seen on the truck.
    UNION ALL
    SELECT pg_temp.d(3,5), pg_temp.d(5,4), 7, 0, 1, 'On Site', 10, 21.0, 3, NULL, 'Festival Main Stage'
    UNION ALL
    SELECT pg_temp.d(3,5), pg_temp.d(5,4), 3, 2, 1, 'Checked Out', 9, 9.0, 2, NULL, 'Truck'
  ) s;

-- -----------------------------------------------------------------------------
-- 8. PURCHASES: a line per item bought (with its units or lot) plus a few expensed lines.
--    Lines are row_type 'line' (migration 20261012). Treatment follows the per-item cost:
--    under $200 Expense, over $2,500 Depreciate, and in the grey zone the controller is
--    expensed and the rest depreciated. Recovery periods live on the equipment (20261013).
-- -----------------------------------------------------------------------------
CREATE TEMP TABLE _pl ON COMMIT DROP AS
SELECT a.*, p.factor, round(a.price * p.factor, 2) AS cost_each,
       CASE WHEN round(a.price * p.factor, 2) < 200 THEN 'expense'
            WHEN round(a.price * p.factor, 2) > 2500 THEN 'depreciate'
            WHEN a.n = 16 THEN 'expense'
            ELSE 'depreciate' END AS treatment,
       -- the line's asset: the first unit, or the lot
       pg_temp.d(4, a.n * 100 + CASE WHEN a.n IN (1, 2, 3, 4, 5, 6, 9, 14, 15, 16, 21) THEN 1 ELSE 0 END) AS line_asset
  FROM _a a
  JOIN _p p ON p.n = a.pur;

-- A depreciated line is filed under the equipment category; an expensed one under the
-- expense heading for small gear (the equipment record keeps its equipment category).
INSERT INTO public.purchases
  (id, organization_id, parent_id, row_type, purchase_date, vendor, payment_method, line_amount, line_cost, quantity,
   item_price, item_cost, description, category, created_by, updated_by, asset_id, tax_treatment)
SELECT pg_temp.d(6, 100 + l.n), pg_temp.d(1,1), pg_temp.d(6, l.pur), 'line',
       h.purchase_date, h.vendor, h.payment_method,
       l.price * l.qty, l.cost_each * l.qty, l.qty,
       l.price, l.cost_each,
       l.model,
       CASE WHEN l.treatment = 'depreciate' THEN l.category
            WHEN l.category = 'Audio' THEN 'Small audio parts'
            WHEN l.category IN ('Lighting', 'Rigging and Truss') THEN 'Small lighting parts'
            WHEN l.category IN ('Power', 'Networking') THEN 'Small power and networking parts'
            WHEN l.category = 'Cases and Bags' THEN 'Cases and bags'
            ELSE 'Expendables and supplies' END,
       h.created_by, h.created_by, l.line_asset, l.treatment
  FROM _pl l
  JOIN public.purchases h ON h.id = pg_temp.d(6, l.pur);

-- Every unit bought on a line points at it (the database mirrors only the line's own asset).
UPDATE public.assets a
   SET purchase_line_id = pg_temp.d(6, 100 + o.n)
  FROM _own o
 WHERE o.pur > 0 AND a.id = pg_temp.d(4, o.n * 100 + o.unit_no);

-- Expensed lines: gaffer tape (gig 4) and batteries (no gig) on purchase 2; truck rental (gig 5) on purchase 3.
INSERT INTO public.purchases
  (id, organization_id, parent_id, gig_id, row_type, purchase_date, vendor, payment_method, line_amount, line_cost, quantity,
   item_price, item_cost, description, category, created_by, updated_by, tax_treatment)
SELECT pg_temp.d(6, l.n), pg_temp.d(1,1), pg_temp.d(6, l.hdr), CASE WHEN l.gig IS NOT NULL THEN pg_temp.d(3, l.gig) END,
       'line', h.purchase_date, h.vendor, h.payment_method,
       l.price * l.qty, round(l.price * p.factor, 2) * l.qty, l.qty, l.price, round(l.price * p.factor, 2),
       l.descr, l.category, h.created_by, h.created_by, 'expense'
  FROM (VALUES
    (201, 2, 4,        14.99, 6, 'Gaffer tape, 2 in, black',      'Expendables and supplies'),
    (202, 2, NULL::int, 8.25, 4, 'AA batteries, 24-pack',         NULL),  -- no category yet: shows under Needs attention
    (301, 3, 5,       172.00, 2, 'Cargo truck rental, per day',   'Vehicle and truck rental')
  ) AS l(n, hdr, gig, price, qty, descr, category)
  JOIN _p p ON p.n = l.hdr
  JOIN public.purchases h ON h.id = pg_temp.d(6, l.hdr);

-- Depreciated equipment gets its recovery period once its purchase line exists:
-- every unit on a depreciated line (the database follows purchase_line_id, 20261017).
UPDATE public.assets a
   SET recovery_period = p.years
  FROM _pl l
  JOIN _p p ON p.n = l.pur
 WHERE a.purchase_line_id = pg_temp.d(6, 100 + l.n) AND l.treatment = 'depreciate';

-- Invoice totals = sum of the burdened line costs, except the truck rental, whose
-- $45 cleaning fee hasn't been entered as a line (Needs attention: "doesn't add up").
UPDATE public.purchases h
   SET total_inv_amount = (SELECT sum(l.line_cost) FROM public.purchases l WHERE l.parent_id = h.id)
                          + CASE WHEN h.id = pg_temp.d(6, 3) THEN 45 ELSE 0 END
 WHERE h.id IN (SELECT pg_temp.d(6, n) FROM _p);

-- -----------------------------------------------------------------------------
-- 9. GIG LEDGER (gig_financials). Day offsets are from the gig's first day, so
--    money stays in step with the calendar. amount_settled = amount on paid rows.
--    cols: n, gig, dir, stage, amount, date_off, due_off, paid_off, category,
--          description, counterparty org, external name, reference, mileage
-- -----------------------------------------------------------------------------
INSERT INTO public.gig_financials
  (id, gig_id, organization_id, amount, date, notes, created_by, category, reference_number, counterparty_id,
   external_entity_name, currency, description, due_date, paid_at, direction, stage, amount_settled, mileage)
SELECT pg_temp.d(7, f.n), pg_temp.d(3, f.g), pg_temp.d(1,1), amt.amount, g.gd + f.date_off, NULL, pg_temp.d(2,1),
       f.category::fin_category, f.ref, CASE WHEN f.cp IS NOT NULL THEN pg_temp.d(1, f.cp) END,
       f.ext, 'USD', f.descr,
       CASE WHEN f.due_off IS NOT NULL THEN g.gd + f.due_off END,
       CASE WHEN f.paid_off IS NOT NULL THEN pg_temp.at(g.gd + f.paid_off, 11) END,
       f.dir::fin_direction, f.stage::fin_stage,
       CASE WHEN f.stage = 'paid' THEN amt.amount END, f.mileage
  FROM (VALUES
    -- 1 Summer Wrap (Settled): fee in two payments, fuel
    (1,  1, 'in',  'paid',          2400.00, -30, -21, -24, NULL::text, 'Deposit (50%)',                 6, NULL::text, 'INV-2026-0388', NULL::numeric),
    (2,  1, 'in',  'paid',          2400.00,   0,  30,  18, NULL,       'Balance (50%)',                 6, NULL,       'INV-2026-0389', NULL),
    (3,  1, 'out', 'paid',           118.40,   0, NULL,  0, 'Car and truck expenses', 'Van fuel and parking', NULL, NULL, NULL, NULL),
    -- 2 Album Release (Settled): fee, rental
    (4,  2, 'in',  'paid',          1600.00, -28, -14, -18, NULL,       'Deposit (50%)',                 4, NULL,       'INV-2026-0394', NULL),
    (5,  2, 'in',  'paid',          1600.00,   0,  14,   9, NULL,       'Balance (50%)',                 4, NULL,       'INV-2026-0395', NULL),
    (6,  2, 'out', 'paid',           220.00,   0, NULL,  3, 'Rent or lease', 'Extra wireless mic packs (2 nights)', NULL, 'Westbay Rental Depot', NULL, NULL),
    -- 3 Corporate Kickoff (Settled): fee, mileage
    (7,  3, 'in',  'paid',          3100.00, -30, -14, -20, NULL,       'Deposit (50%)',                 6, NULL,       'INV-2026-0401', NULL),
    (8,  3, 'in',  'paid',          3100.00,   0,  30,  28, NULL,       'Balance (50%)',                 6, NULL,       'INV-2026-0402', NULL),
    (9,  3, 'out', 'paid',            41.54,   0, NULL,  0, 'Car and truck expenses', 'Mileage to Harborlight Pavilion', NULL, NULL, NULL, 62.0),
    -- 4 Acoustic Night (Completed): deposit paid, balance overdue
    (10, 4, 'in',  'paid',           900.00, -21, -10, -12, NULL,       'Deposit (50%)',                 5, NULL,       'INV-2026-0412', NULL),
    (11, 4, 'in',  'invoiced',       900.00,   0,  14, NULL, NULL,      'Balance (50%)',                 5, NULL,       'INV-2026-0413', NULL),
    (12, 4, 'out', 'paid',            41.54,   0, NULL,  0, 'Car and truck expenses', 'Mileage to Cedar Hall', NULL, NULL, NULL, 62.0),
    -- 5 Festival (Completed, two days): deposit paid, balance invoiced, rigging sub-contract owed
    (13, 5, 'in',  'paid',          4750.00, -30, -14, -16, NULL,       'Deposit (50%)',                 6, NULL,       'INV-2026-0421', NULL),
    (14, 5, 'in',  'invoiced',      4750.00,   2,  31, NULL, NULL,      'Balance (50%)',                 6, NULL,       'INV-2026-0422', NULL),
    (15, 5, 'out', 'contracted',    1200.00, -21,  18, NULL, 'Contract labor', 'Stage rigging crew (sub-contract)', NULL, 'Skyline Rigging Partners', NULL, NULL),
    -- 7 Harvest Gala (Booked, this Saturday): deposit received, balance contracted, rigging accepted
    (16, 7, 'in',  'paid',          3900.00, -21, -14, -14, NULL,       'Deposit (50%)',                 6, NULL,       'INV-2026-0440', NULL),
    (17, 7, 'in',  'contracted',    3900.00,   0,  14, NULL, NULL,      'Balance (50%), due net-14 after the event', 6, NULL, NULL, NULL),
    (18, 7, 'out', 'accepted',       600.00, -12, NULL, NULL, 'Contract labor', 'Truss and rigging (quoted and accepted)', NULL, 'Lumen Trussing Co.', NULL, NULL),
    -- 8 Songwriter Showcase (Booked): deposit paid, balance contracted
    (19, 8, 'in',  'paid',           750.00, -18, -12, -12, NULL,       'Deposit (50%)',                 3, NULL,       'INV-2026-0447', NULL),
    (20, 8, 'in',  'contracted',     750.00,   0,   0, NULL, NULL,      'Balance (50%), due at settlement', 3, NULL,   NULL, NULL),
    -- 9 Winter Tour Kickoff (Booked): agreed by email
    (21, 9, 'in',  'accepted',      2400.00, -20, NULL, NULL, NULL,     'Informal agreement by email',   5, NULL,       NULL, NULL),
    -- 10 Halloween Bash (Booked): deposit invoiced, balance contracted
    (22, 10,'in',  'invoiced',      1800.00, -28, -14, NULL, NULL,      'Deposit (50%)',                 4, NULL,       'INV-2026-0451', NULL),
    (23, 10,'in',  'contracted',    1800.00, -28,   0, NULL, NULL,      'Balance (50%)',                 4, NULL,       NULL, NULL),
    -- 11 Live at Cedar Hall (Booked): contract out for signature
    (24, 11,'in',  'contract_sent', 2800.00, -38,  -7, NULL, NULL,      'Production fee, contract sent', 3, NULL,       NULL, NULL),
    -- 12 Client Appreciation (Booked): deposit paid, balance contracted
    (25, 12,'in',  'paid',          2100.00, -45, -30, -44, NULL,       'Deposit (50%)',                 6, NULL,       'INV-2026-0455', NULL),
    (26, 12,'in',  'contracted',    2100.00, -45,  14, NULL, NULL,      'Balance (50%)',                 6, NULL,       NULL, NULL),
    -- 13 Holiday Lights (Booked): contract out for signature
    (27, 13,'in',  'contract_sent', 6500.00, -68, -30, NULL, NULL,      'Production fee, contract sent', 6, NULL,       NULL, NULL),
    -- 15 New Year's Eve (Proposed): quote, plus a bid request for rental lighting
    (28, 15,'in',  'quoted',       12000.00, -87, NULL, NULL, NULL,     'Quote for sound, lighting and crew', 6, NULL,  NULL, NULL),
    (29, 15,'out', 'requested',        NULL, -87, NULL, NULL, 'Rent or lease', 'Bid requested: extra moving heads', NULL, 'Westbay Rental Depot', NULL, NULL),
    -- 16 Annual Summit (Proposed)
    (30, 16,'in',  'quoted',       15000.00, -99, NULL, NULL, NULL,     'Quote for both days',           6, NULL,       NULL, NULL),
    -- 17 Rooftop Mixer (Proposed)
    (31, 17,'in',  'quoted',        3200.00, -12, NULL, NULL, NULL,     'Quote for sound and crew',      6, NULL,       NULL, NULL)
  ) AS f(n, g, dir, stage, amount, date_off, due_off, paid_off, category, descr, cp, ext, ref, mileage)
  JOIN _g g ON g.n = f.g
  -- Mileage is recorded at the IRS rate on the trip's date, as the app records it.
  CROSS JOIN LATERAL (SELECT CASE WHEN f.mileage IS NOT NULL THEN round(f.mileage * pg_temp.irs(g.gd + f.date_off), 2)
                                  ELSE f.amount END AS amount) amt;

-- Expense rows that came from purchase lines (gig accounting only; amount mirrors the line cost).
INSERT INTO public.gig_financials
  (id, gig_id, organization_id, amount, date, created_by, category, currency, description, paid_at, direction, stage,
   amount_settled, purchase_id, external_entity_name)
SELECT pg_temp.d(7, x.n), p.gig_id, p.organization_id, p.line_cost, p.purchase_date, p.created_by, x.category::fin_category,
       'USD', p.description, pg_temp.at(p.purchase_date, 14), 'out', 'paid', p.line_cost, p.id, p.vendor
  FROM (VALUES (901, 201, 'Supplies'), (902, 301, 'Rent or lease')) AS x(n, line, category)
  JOIN public.purchases p ON p.id = pg_temp.d(6, x.line);

-- Staff pay for finished gigs: one ledger row per assignment, as "Finalize staff" creates.
-- Settled gigs and gig 4: paid five days after. Gig 5: owed (invoiced, due a week after the anchor).
INSERT INTO public.gig_financials
  (id, gig_id, organization_id, amount, date, created_by, category, currency, description, due_date, paid_at,
   direction, stage, amount_settled, staff_assignment_id, external_entity_name)
SELECT pg_temp.d(7, 1000 + (substring(a.id::text from 29)::int)), s.gig_id, pg_temp.d(1,1), COALESCE(a.fee, a.rate * wk.units),
       gg.gd, pg_temp.d(2,2), 'Contract labor'::fin_category, 'USD',
       sr.name || ': ' || u.first_name || ' ' || u.last_name,
       CASE WHEN gg.n = 5 THEN pg_temp.anchor() + 7 END,
       CASE WHEN gg.n <> 5 THEN pg_temp.at(gg.gd + 5, 11) END,
       'out',
       CASE WHEN gg.n = 5 THEN 'invoiced' ELSE 'paid' END::fin_stage,
       CASE WHEN gg.n <> 5 THEN COALESCE(a.fee, a.rate * wk.units) END,
       a.id, u.first_name || ' ' || u.last_name
  FROM public.gig_staff_assignments a
  JOIN public.gig_staff_slots s ON s.id = a.slot_id
  JOIN _g gg ON pg_temp.d(3, gg.n) = s.gig_id
  JOIN public.staff_roles sr ON sr.id = s.staff_role_id
  JOIN public.users u ON u.id = a.user_id
  -- Units worked on a rate: 9 hours, or one day or half day per gig day.
 CROSS JOIN LATERAL (SELECT CASE a.rate_unit WHEN 'hour' THEN 9 ELSE gg.days END AS units) wk
 WHERE gg.status IN ('Completed','Settled');

UPDATE public.gig_staff_assignments a
   SET gig_financial_id = pg_temp.d(7, 1000 + (substring(a.id::text from 29)::int)),
       completed_at = pg_temp.at(g.gd + g.days, 10),
       units_completed = CASE WHEN a.rate IS NOT NULL THEN CASE a.rate_unit WHEN 'hour' THEN 9 ELSE g.days END END
  FROM public.gig_staff_slots s
  JOIN _g g ON pg_temp.d(3, g.n) = s.gig_id
 WHERE s.id = a.slot_id AND g.status IN ('Completed','Settled');

-- -----------------------------------------------------------------------------
-- 10. ACTIVITY HISTORY: what the team did over the last few weeks, in the
--     shape the app logs it (see src/services/activityLog.service.ts).
--     cols: n, days before anchor, hour, actor, event, entity type, gig, entity id, context
-- -----------------------------------------------------------------------------
INSERT INTO public.activity_log (id, organization_id, actor_id, event_type, entity_type, entity_id, gig_id, context, occurred_at)
SELECT pg_temp.d(11, e.n), pg_temp.d(1,1), pg_temp.d(2, e.usr), e.event, e.entity,
       COALESCE(e.entity_id, pg_temp.d(3, e.g)), pg_temp.d(3, e.g),
       e.ctx || jsonb_build_object('gig_title', g.title, 'actor_org_name', 'Demo Sound & Lighting',
                                   'actor_display_name', u.first_name || ' ' || u.last_name, 'context_version', 1),
       pg_temp.at(pg_temp.anchor() - e.ago, e.hr)
  FROM (VALUES
    (1,  27, 10.0, 1, 'financial.paid',     'financial',   3,  pg_temp.d(7,8),   '{"stage":"paid","amount":3100,"direction":"in","description":"Balance (50%)"}'::jsonb),
    (2,  27, 10.2, 1, 'gig.status_changed', 'gig',         3,  NULL,             '{"from_status":"Completed","to_status":"Settled"}'),
    (3,  24, 16.0, 2, 'gig.created',        'gig',         12, NULL,             '{}'),
    (4,  23, 11.0, 1, 'financial.paid',     'financial',   12, pg_temp.d(7,25),  '{"stage":"paid","amount":2100,"direction":"in","description":"Deposit (50%)"}'),
    (5,  23, 11.1, 1, 'gig.status_changed', 'gig',         12, NULL,             '{"from_status":"Proposed","to_status":"Booked"}'),
    (6,  20,  9.5, 1, 'financial.paid',     'financial',   7,  pg_temp.d(7,16),  '{"stage":"paid","amount":3900,"direction":"in","description":"Deposit (50%)"}'),
    (7,  16, 14.0, 2, 'participant.added',  'participant', 10, pg_temp.d(10,102),'{"role":"Act","organization_name":"Neon Orchard"}'),
    (8,  12, 22.5, 2, 'gig.status_changed', 'gig',         5,  NULL,             '{"from_status":"Booked","to_status":"Completed"}'),
    (9,   9, 15.0, 2, 'gig.status_changed', 'gig',         10, NULL,             '{"from_status":"Proposed","to_status":"Booked"}'),
    (10,  8, 10.0, 2, 'gig.renamed',        'gig',         14, NULL,             '{"from_title":"Spring Kickoff Block Party","to_title":"Winter Street Fair"}'),
    (11,  6, 13.0, 1, 'financial.added',    'financial',   15, pg_temp.d(7,28),  '{"stage":"quoted","amount":12000,"direction":"in","description":"Quote for sound, lighting and crew"}'),
    (12,  5, 17.5, 2, 'gig.status_changed', 'gig',         6,  NULL,             '{"from_status":"Booked","to_status":"Cancelled"}'),
    (13,  4, 12.0, 2, 'gig.rescheduled',    'gig',         9,  NULL,             '{}'),
    (14,  2, 10.0, 2, 'staffing.updated',   'staffing',    7,  NULL,             '{"change_count":2,"changes":[{"role":"FOH Engineer","type":"assigned","user_name":"Sofia Lindqvist","initial_status":"Confirmed"},{"role":"Lighting Tech","type":"assigned","user_name":"Shane Park","initial_status":"Requested"}]}'),
    (15,  1, 15.0, 1, 'gig.created',        'gig',         16, NULL,             '{}'),
    (16,  1, 15.5, 1, 'financial.added',    'financial',   16, pg_temp.d(7,30),  '{"stage":"quoted","amount":15000,"direction":"in","description":"Quote for both days"}'),
    (17,  0,  7.5, 2, 'gig.notes_updated',  'gig',         7,  NULL,             '{"notes_changed":true}'),
    -- Harvest Gala's earlier history, for the History tab screenshot
    (18, 40, 11.5, 2, 'participant.added',  'participant', 7,  pg_temp.d(10,72), '{"role":"Act","organization_name":"Neon Orchard"}'),
    (19, 35, 15.0, 1, 'gig.status_changed', 'gig',         7,  NULL,             '{"from_status":"Proposed","to_status":"Booked"}')
  ) AS e(n, ago, hr, usr, event, entity, g, entity_id, ctx)
  JOIN public.gigs g ON g.id = pg_temp.d(3, e.g)
  JOIN public.users u ON u.id = pg_temp.d(2, e.usr);

-- Every gig's "Gig created" entry, at the gig's created_at, by its creator.
INSERT INTO public.activity_log (id, organization_id, actor_id, event_type, entity_type, entity_id, gig_id, context, occurred_at)
SELECT pg_temp.d(11, 100 + g.n), pg_temp.d(1,1), gg.created_by, 'gig.created', 'gig', gg.id, gg.id,
       jsonb_build_object('gig_title', gg.title, 'actor_org_name', 'Demo Sound & Lighting',
                          'actor_display_name', u.first_name || ' ' || u.last_name, 'context_version', 1),
       gg.created_at
  FROM _g g
  JOIN public.gigs gg ON gg.id = pg_temp.d(3, g.n)
  JOIN public.users u ON u.id = gg.created_by
 WHERE g.n NOT IN (12, 16);  -- these two have a dated entry above

-- The reschedule entry carries the real from/to: Saturday moved to Friday.
UPDATE public.activity_log l
   SET context = l.context || jsonb_build_object(
         'from', jsonb_build_object('start', g.start + interval '1 day', 'end', g."end" + interval '1 day'),
         'to',   jsonb_build_object('start', g.start, 'end', g."end"))
  FROM public.gigs g
 WHERE l.id = pg_temp.d(11, 13) AND g.id = l.gig_id;

-- -----------------------------------------------------------------------------
-- 11. A FILED YEAR (#337): the year before the anchor's, locked, with invented
--     Form 4562 figures for the Filed tax years screenshot. Section 179 $4,000;
--     one 7-year mid-quarter line 19 row, $6,000 basis, $214 deduction; line 22
--     $4,214. That year has no demo purchases or gig money, so the lock blocks
--     nothing. Saved by Alicia Hale on its filing date: the stamp trigger would
--     record no one and the real time, so it's off for this insert.
-- -----------------------------------------------------------------------------
INSERT INTO public.tax_years (organization_id, year, locked, filed_on)
VALUES (pg_temp.d(1,1), extract(year FROM pg_temp.anchor())::int - 1, true,
        LEAST(make_date(extract(year FROM pg_temp.anchor())::int, 4, 10), pg_temp.anchor() - 1));

ALTER TABLE public.tax_year_depreciation DISABLE TRIGGER tax_year_depreciation_stamp;
INSERT INTO public.tax_year_depreciation (organization_id, year, line_12, line_22, updated_by, updated_at)
SELECT organization_id, year, 4000, 4214, pg_temp.d(2,1), pg_temp.at(filed_on, 10)
  FROM public.tax_years WHERE organization_id = pg_temp.d(1,1);
ALTER TABLE public.tax_year_depreciation ENABLE TRIGGER tax_year_depreciation_stamp;
INSERT INTO public.tax_year_depreciation_rows (organization_id, year, recovery_years, basis, convention, method, deduction)
SELECT organization_id, year, 7, 6000, 'MQ', '200DB', 214
  FROM public.tax_years WHERE organization_id = pg_temp.d(1,1);

COMMIT;

-- Summary (last statement, so the API returns it)
SELECT jsonb_pretty(jsonb_build_object(
  'anchor',               pg_temp.anchor(),
  'organizations',        (SELECT count(*) FROM public.organizations WHERE id::text LIKE 'de000000-0000-4000-8000-%'),
  'auth_users',           (SELECT count(*) FROM auth.users WHERE id::text LIKE 'de000000-0000-4000-8000-%'),
  'auth_identities',      (SELECT count(*) FROM auth.identities WHERE user_id::text LIKE 'de000000-0000-4000-8000-%'),
  'users_login',          (SELECT count(*) FROM public.users WHERE id::text LIKE 'de000000-0000-4000-8000-%' AND user_status = 'active'),
  'users_contact',        (SELECT count(*) FROM public.users WHERE id::text LIKE 'de000000-0000-4000-8000-%' AND user_status = 'contact'),
  'organization_members', (SELECT count(*) FROM public.organization_members WHERE organization_id::text LIKE 'de000000-0000-4000-8000-%'),
  'expense_categories',   (SELECT count(*) FROM public.expense_categories WHERE organization_id::text LIKE 'de000000-0000-4000-8000-%'),
  'equipment_categories', (SELECT count(*) FROM public.equipment_categories WHERE organization_id::text LIKE 'de000000-0000-4000-8000-%'),
  'gigs',                 (SELECT count(*) FROM public.gigs WHERE id::text LIKE 'de000000-0000-4000-8000-%'),
  'gig_participants',     (SELECT count(*) FROM public.gig_participants WHERE gig_id::text LIKE 'de000000-0000-4000-8000-%'),
  'gig_participant_contacts', (SELECT count(*) FROM public.gig_participant_contacts WHERE gig_id::text LIKE 'de000000-0000-4000-8000-%'),
  'gig_schedule_entries', (SELECT count(*) FROM public.gig_schedule_entries WHERE gig_id::text LIKE 'de000000-0000-4000-8000-%'),
  'gig_staff_slots',      (SELECT count(*) FROM public.gig_staff_slots WHERE gig_id::text LIKE 'de000000-0000-4000-8000-%'),
  'gig_staff_assignments',(SELECT count(*) FROM public.gig_staff_assignments WHERE id::text LIKE 'de000000-0000-4000-8000-%'),
  'equipment_items',      (SELECT count(*) FROM public.equipment_items WHERE organization_id::text LIKE 'de000000-0000-4000-8000-%'),
  'assets',               (SELECT count(*) FROM public.assets WHERE organization_id::text LIKE 'de000000-0000-4000-8000-%'),
  'kits',                 (SELECT count(*) FROM public.kits WHERE organization_id::text LIKE 'de000000-0000-4000-8000-%'),
  'kit_components',       (SELECT count(*) FROM public.kit_components WHERE kit_id::text LIKE 'de000000-0000-4000-8000-%'),
  'gig_kit_assignments',  (SELECT count(*) FROM public.gig_kit_assignments WHERE organization_id::text LIKE 'de000000-0000-4000-8000-%'),
  'inventory_tracking',   (SELECT count(*) FROM public.inventory_tracking WHERE organization_id::text LIKE 'de000000-0000-4000-8000-%'),
  'purchases_headers',    (SELECT count(*) FROM public.purchases WHERE organization_id::text LIKE 'de000000-0000-4000-8000-%' AND row_type = 'header'),
  'purchases_lines',      (SELECT count(*) FROM public.purchases WHERE organization_id::text LIKE 'de000000-0000-4000-8000-%' AND row_type <> 'header'),
  'gig_financials',       (SELECT count(*) FROM public.gig_financials WHERE organization_id::text LIKE 'de000000-0000-4000-8000-%'),
  'activity_log',         (SELECT count(*) FROM public.activity_log WHERE organization_id::text LIKE 'de000000-0000-4000-8000-%'),
  'tax_years',            (SELECT count(*) FROM public.tax_years WHERE organization_id::text LIKE 'de000000-0000-4000-8000-%'),
  'tax_year_depreciation',(SELECT count(*) FROM public.tax_year_depreciation WHERE organization_id::text LIKE 'de000000-0000-4000-8000-%')
)) AS counts;
