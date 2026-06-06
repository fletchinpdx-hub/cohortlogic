-- ═══════════════════════════════════════════════════════════════════════
-- Cohort Logic — Complete School Isolation
--
-- Prerequisites (do these FIRST in the admin panel):
--   1. Create at least one school (Admin → Schools)
--   2. Assign approved users to their school (Admin → Pending Approvals,
--      or update profiles.school_id manually if already approved)
--
-- Then run this script. It does two things:
--   PART 1 — Backfills all existing null school_id records to the first school
--   PART 2 — Replaces transition RLS with strict isolation (null records
--             are no longer visible after this point)
-- ═══════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────
-- PART 1: Backfill existing data
-- Assigns all records with school_id = null to the first school.
-- Safe to run when you have one school and all data belongs to it.
-- ─────────────────────────────────────────────────────────────────────

do $$ declare
  v_school_id uuid;
begin
  select id into v_school_id from public.schools order by created_at limit 1;

  if v_school_id is null then
    raise exception
      'No schools found. Create a school in the admin panel first, then re-run this script.';
  end if;

  raise notice 'Backfilling to school: %', v_school_id;

  update public.cico_students
    set school_id = v_school_id where school_id is null;

  update public.cico_checkins
    set school_id = v_school_id where school_id is null;

  update public.cico_settings
    set school_id = v_school_id where school_id is null;

  update public.cico_categories
    set school_id = v_school_id where school_id is null;

  update public.cico_incident_types
    set school_id = v_school_id where school_id is null;

  -- Only backfill approved users who have not yet been assigned a school
  update public.profiles
    set school_id = v_school_id
    where school_id is null and approved = true;

  raise notice 'Backfill complete.';
end $$;


-- ─────────────────────────────────────────────────────────────────────
-- PART 2: Strict isolation RLS
-- Removes the "school_id is null" fallback. After this:
--   - Users with a school assigned → see only their school's data
--   - Users with no school assigned → see nothing (safe default)
--   - Admins → see everything
-- ─────────────────────────────────────────────────────────────────────

-- Drop all existing CICO table policies
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
create policy "Strict school isolation: students"
  on public.cico_students for all
  using (
    public.is_admin() or
    (public.my_school_id() is not null and school_id = public.my_school_id())
  )
  with check (
    public.is_admin() or
    (public.my_school_id() is not null and school_id = public.my_school_id())
  );

-- cico_checkins
create policy "Strict school isolation: checkins"
  on public.cico_checkins for all
  using (
    public.is_admin() or
    (public.my_school_id() is not null and school_id = public.my_school_id())
  )
  with check (
    public.is_admin() or
    (public.my_school_id() is not null and school_id = public.my_school_id())
  );

-- cico_period_scores (no direct school_id — checked via parent checkin)
create policy "Strict school isolation: period scores"
  on public.cico_period_scores for all
  using (
    public.is_admin() or
    exists (
      select 1 from public.cico_checkins c
      where c.id = checkin_id
      and public.my_school_id() is not null
      and c.school_id = public.my_school_id()
    )
  );

-- cico_incidents (no direct school_id — checked via parent checkin)
create policy "Strict school isolation: incidents"
  on public.cico_incidents for all
  using (
    public.is_admin() or
    exists (
      select 1 from public.cico_checkins c
      where c.id = checkin_id
      and public.my_school_id() is not null
      and c.school_id = public.my_school_id()
    )
  );

-- cico_settings
create policy "Strict school isolation: settings"
  on public.cico_settings for all
  using (
    public.is_admin() or
    (public.my_school_id() is not null and school_id = public.my_school_id())
  )
  with check (
    public.is_admin() or
    (public.my_school_id() is not null and school_id = public.my_school_id())
  );

-- cico_categories
create policy "Strict school isolation: categories"
  on public.cico_categories for all
  using (
    public.is_admin() or
    (public.my_school_id() is not null and school_id = public.my_school_id())
  )
  with check (
    public.is_admin() or
    (public.my_school_id() is not null and school_id = public.my_school_id())
  );

-- cico_incident_types
create policy "Strict school isolation: incident types"
  on public.cico_incident_types for all
  using (
    public.is_admin() or
    (public.my_school_id() is not null and school_id = public.my_school_id())
  )
  with check (
    public.is_admin() or
    (public.my_school_id() is not null and school_id = public.my_school_id())
  );
