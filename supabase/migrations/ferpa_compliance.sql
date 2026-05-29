-- ═══════════════════════════════════════════════════════════════════════
-- Cohort Logic — FERPA Compliance Migration
-- Run once in the Supabase SQL Editor (Project → SQL Editor → New Query)
-- ═══════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────
-- PART 1: Audit Log
-- Records every INSERT / UPDATE / DELETE on sensitive tables.
-- Only admins can read it. No one can write to it directly.
-- ─────────────────────────────────────────────────────────────────────

create table if not exists public.audit_log (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        references auth.users(id) on delete set null,
  action      text        not null check (action in ('INSERT','UPDATE','DELETE')),
  table_name  text        not null,
  record_id   text,
  old_data    jsonb,
  new_data    jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_audit_log_user_id    on public.audit_log(user_id);
create index if not exists idx_audit_log_table_name on public.audit_log(table_name);
create index if not exists idx_audit_log_created_at on public.audit_log(created_at desc);

alter table public.audit_log enable row level security;

create policy "Admins can view audit logs"
  on public.audit_log for select
  using (public.is_admin());

-- Trigger function — SECURITY DEFINER so it can always write to audit_log
-- regardless of the calling user's permissions.
create or replace function public.log_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log(user_id, action, table_name, record_id, old_data, new_data)
  values (
    auth.uid(),
    TG_OP,
    TG_TABLE_NAME,
    case when TG_OP = 'DELETE' then OLD.id::text else NEW.id::text end,
    case when TG_OP in ('UPDATE','DELETE') then to_jsonb(OLD) else null end,
    case when TG_OP in ('INSERT','UPDATE') then to_jsonb(NEW) else null end
  );
  return case when TG_OP = 'DELETE' then OLD else NEW end;
end;
$$;

-- Triggers on all sensitive tables
drop trigger if exists audit_cico_students       on public.cico_students;
drop trigger if exists audit_cico_checkins       on public.cico_checkins;
drop trigger if exists audit_cico_period_scores  on public.cico_period_scores;
drop trigger if exists audit_cico_incidents      on public.cico_incidents;
drop trigger if exists audit_profiles            on public.profiles;

create trigger audit_cico_students
  after insert or update or delete on public.cico_students
  for each row execute function public.log_audit_event();

create trigger audit_cico_checkins
  after insert or update or delete on public.cico_checkins
  for each row execute function public.log_audit_event();

create trigger audit_cico_period_scores
  after insert or update or delete on public.cico_period_scores
  for each row execute function public.log_audit_event();

create trigger audit_cico_incidents
  after insert or update or delete on public.cico_incidents
  for each row execute function public.log_audit_event();

-- Profiles: track approvals and role changes (not the initial signup insert)
create trigger audit_profiles
  after update on public.profiles
  for each row execute function public.log_audit_event();


-- ─────────────────────────────────────────────────────────────────────
-- PART 2: Schools Table
-- Each school is a tenant. Users and CICO data are scoped to a school.
-- ─────────────────────────────────────────────────────────────────────

create table if not exists public.schools (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  district   text,
  state      text,
  created_at timestamptz not null default now()
);

alter table public.schools enable row level security;

create policy "Authenticated users can view schools"
  on public.schools for select
  using (auth.role() = 'authenticated');

create policy "Admins can manage schools"
  on public.schools for all
  using (public.is_admin())
  with check (public.is_admin());

-- Add school_id to profiles
alter table public.profiles
  add column if not exists school_id uuid references public.schools(id) on delete set null;

-- Helper: returns the current user's school_id from their profile
create or replace function public.my_school_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select school_id from public.profiles where id = auth.uid()
$$;

-- Add school_id to CICO tables
alter table public.cico_students
  add column if not exists school_id uuid references public.schools(id) on delete cascade;

alter table public.cico_checkins
  add column if not exists school_id uuid references public.schools(id) on delete cascade;

alter table public.cico_settings
  add column if not exists school_id uuid references public.schools(id) on delete cascade;

alter table public.cico_categories
  add column if not exists school_id uuid references public.schools(id) on delete cascade;

alter table public.cico_incident_types
  add column if not exists school_id uuid references public.schools(id) on delete cascade;

-- Indexes for query performance
create index if not exists idx_profiles_school_id            on public.profiles(school_id);
create index if not exists idx_cico_students_school_id       on public.cico_students(school_id);
create index if not exists idx_cico_checkins_school_id       on public.cico_checkins(school_id);
create index if not exists idx_cico_settings_school_id       on public.cico_settings(school_id);
create index if not exists idx_cico_categories_school_id     on public.cico_categories(school_id);
create index if not exists idx_cico_incident_types_school_id on public.cico_incident_types(school_id);


-- ─────────────────────────────────────────────────────────────────────
-- PART 3: School-scoped RLS
-- Drop all existing CICO table policies and replace with school-scoped ones.
-- Transition-safe: NULL school_id records remain accessible to all
-- authenticated users (no existing data is locked out). Once school_id
-- is populated, access is restricted to that school's users + admins.
-- ─────────────────────────────────────────────────────────────────────

do $$ declare pol record; begin
  for pol in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
    and tablename in (
      'cico_students','cico_checkins','cico_period_scores',
      'cico_incidents','cico_settings','cico_categories','cico_incident_types'
    )
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

-- cico_students
create policy "School-scoped: students"
  on public.cico_students for all
  using  (school_id is null or school_id = public.my_school_id() or public.is_admin())
  with check (school_id is null or school_id = public.my_school_id() or public.is_admin());

-- cico_checkins
create policy "School-scoped: checkins"
  on public.cico_checkins for all
  using  (school_id is null or school_id = public.my_school_id() or public.is_admin())
  with check (school_id is null or school_id = public.my_school_id() or public.is_admin());

-- cico_period_scores (no direct school_id — checked via parent checkin)
create policy "School-scoped: period scores"
  on public.cico_period_scores for all
  using (
    exists (
      select 1 from public.cico_checkins c
      where c.id = checkin_id
      and (c.school_id is null or c.school_id = public.my_school_id() or public.is_admin())
    )
  );

-- cico_incidents (no direct school_id — checked via parent checkin)
create policy "School-scoped: incidents"
  on public.cico_incidents for all
  using (
    exists (
      select 1 from public.cico_checkins c
      where c.id = checkin_id
      and (c.school_id is null or c.school_id = public.my_school_id() or public.is_admin())
    )
  );

-- cico_settings
create policy "School-scoped: settings"
  on public.cico_settings for all
  using  (school_id is null or school_id = public.my_school_id() or public.is_admin())
  with check (school_id is null or school_id = public.my_school_id() or public.is_admin());

-- cico_categories
create policy "School-scoped: categories"
  on public.cico_categories for all
  using  (school_id is null or school_id = public.my_school_id() or public.is_admin())
  with check (school_id is null or school_id = public.my_school_id() or public.is_admin());

-- cico_incident_types
create policy "School-scoped: incident types"
  on public.cico_incident_types for all
  using  (school_id is null or school_id = public.my_school_id() or public.is_admin())
  with check (school_id is null or school_id = public.my_school_id() or public.is_admin());
