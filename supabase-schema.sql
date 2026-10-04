-- Maknazul 'Irfan Academy — Attendance Portal
-- Run this whole file once in your Supabase project's SQL Editor
-- (Dashboard → SQL Editor → New query → paste → Run).

create extension if not exists pgcrypto;

-- ───────────────────────── Tables ─────────────────────────

create table if not exists sections (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  grade_level text,
  adviser     text,
  created_at  timestamptz not null default now()
);

create table if not exists students (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  lrn               text,
  section_id        uuid references sections(id) on delete set null,
  guardian_name     text,
  guardian_contact  text,
  status            text not null default 'active',
  created_at        timestamptz not null default now()
);

-- One row per section per day. `records` holds every student's mark for
-- that day: { "<student_id>": { "status": "present|absent|late|excused", "note": "" }, ... }
create table if not exists attendance (
  section_id  uuid not null references sections(id) on delete cascade,
  date        date not null,
  records     jsonb not null default '{}'::jsonb,
  marked_by   text,
  marked_at   timestamptz,
  primary key (section_id, date)
);

create table if not exists notes (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references students(id) on delete cascade,
  author      text,
  text        text not null,
  created_at  timestamptz not null default now()
);

-- Single-row-per-key settings table. The app stores the admin/staff
-- access codes here under key = 'access'.
create table if not exists config (
  key    text primary key,
  value  jsonb not null
);

create index if not exists students_section_id_idx on students(section_id);
create index if not exists attendance_date_idx on attendance(date);
create index if not exists notes_student_id_idx on notes(student_id);

-- ─────────────────────── Row Level Security ───────────────────────
-- IMPORTANT — read this before you go live:
-- This app gates staff vs. parent access with an in-app access code and
-- an ID+surname lookup, NOT with Supabase Auth logins. Because of that,
-- the public "anon" key your app uses can't be restricted per-user at
-- the database level — the policies below simply allow the anon key to
-- read and write everything. That means anyone who has your anon key
-- (visible in your deployed site's source) could, in theory, query the
-- database directly and bypass the in-app role screens.
--
-- For a small school this is a reasonable trade-off (same model as most
-- lightweight internal tools), but if you want real per-person security
-- later, add Supabase Auth (email/password or magic link) for staff and
-- rewrite these policies to check auth.uid() / a role stored per user,
-- instead of "using (true)".

alter table sections   enable row level security;
alter table students   enable row level security;
alter table attendance enable row level security;
alter table notes      enable row level security;
alter table config     enable row level security;

drop policy if exists "anon full access" on sections;
drop policy if exists "anon full access" on students;
drop policy if exists "anon full access" on attendance;
drop policy if exists "anon full access" on notes;
drop policy if exists "anon full access" on config;

create policy "anon full access" on sections   for all using (true) with check (true);
create policy "anon full access" on students   for all using (true) with check (true);
create policy "anon full access" on attendance for all using (true) with check (true);
create policy "anon full access" on notes      for all using (true) with check (true);
create policy "anon full access" on config     for all using (true) with check (true);

-- ───────────────────────── Realtime ─────────────────────────
-- So the dashboard/roster update live across every open device.
alter publication supabase_realtime add table sections;
alter publication supabase_realtime add table students;

-- ─────────────────────── Starter access codes ───────────────────────
-- Optional: seed the default codes now so the app's fallback values
-- (MIA-ADMIN-2026 / MIA-STAFF-2026) are also visible in your database.
-- Change these from the app's Access Codes page as soon as you're set up.
insert into config (key, value)
values ('access', '{"adminCode":"MIA-ADMIN-2026","staffCode":"MIA-STAFF-2026"}')
on conflict (key) do nothing;
