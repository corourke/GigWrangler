-- Two Admins (one an Admin of two organizations), a Manager and a Staff member before
-- two-factor sign-in (#361). The last two hex digits name the person.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'admin1@example.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin2@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'manager@example.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'staff@example.test');
INSERT INTO public.users (id, email, first_name, last_name) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'admin1@example.test', 'Ada', 'One'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin2@example.test', 'Ada', 'Two'),
  ('00000000-0000-0000-0000-0000000000b1', 'manager@example.test', 'Max', 'Manager'),
  ('00000000-0000-0000-0000-0000000000c1', 'staff@example.test', 'Sam', 'Staff');
INSERT INTO organizations (id, name, roles) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'Org A', '{Sound}'),
  ('00000000-0000-0000-0000-00000000000b', 'Org B', '{Sound}');
INSERT INTO organization_members (organization_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'Admin'),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000a1', 'Admin'),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000a2', 'Admin'),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b1', 'Manager'),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', 'Staff');
