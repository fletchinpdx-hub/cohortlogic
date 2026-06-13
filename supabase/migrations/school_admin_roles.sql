-- ═══════════════════════════════════════════════════════════════════════
-- Cohort Logic — School Admin Roles + Per-School Tool Access
--
-- Adds a per-school admin role and product (tool) access control.
--
--   • profiles.role  enum: 'user' | 'school_admin' | 'super_admin'
--   • schools.enabled_products  — school-wide tool default (e.g. {cico})
--   • profiles.product_overrides — per-user allow/deny that overrides default
--   • SECURITY DEFINER RPCs so school admins can approve / deactivate /
--     remove users and set tool access for THEIR school only — with no
--     direct write access to profiles (prevents privilege escalation).
--   • CICO RLS now also requires approval + product access (FERPA gate).
--
-- Run once in the Supabase SQL Editor. Idempotent — safe to re-run.
-- Order matters: role is backfilled BEFORE is_admin() is redefined, so the
-- super-admin never loses access mid-migration.
-- ═══════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────
-- PART 1: Role enum + columns
-- ─────────────────────────────────────────────────────────────────────

do $$ begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('user', 'school_admin', 'super_admin');
  end if;
end $$;

alter table public.profiles
  add column if not exists role public.user_role not null default 'user';

-- Backfill role from the legacy is_admin boolean (before redefining is_admin())
update public.profiles
  set role = 'super_admin'
  where is_admin = true and role <> 'super_admin';

-- School-wide tool default. Existing schools get {cico}; new schools default the same.
alter table public.schools
  add column if not exists enabled_products text[] not null default '{cico}';

-- Per-user override. Keys are product ids; value true=allow, false=deny.
-- Absent key => inherit the school default. e.g. {"cico": false}
alter table public.profiles
  add column if not exists product_overrides jsonb not null default '{}'::jsonb;


-- ─────────────────────────────────────────────────────────────────────
-- PART 2: Role + access helper functions (all SECURITY DEFINER)
-- ─────────────────────────────────────────────────────────────────────

-- Current user's role as text.
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role::text from public.profiles where id = auth.uid()
$$;

-- is_admin() KEEPS ITS NAME so every existing RLS policy keeps working —
-- only its meaning changes to "super admin".
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'super_admin' from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'super_admin' from public.profiles where id = auth.uid()), false)
$$;

-- Strictly the per-school admin (does NOT include super admin).
create or replace function public.is_school_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'school_admin' from public.profiles where id = auth.uid()), false)
$$;

-- Effective tool access for the CURRENT user.
-- Requires the account to be approved, then: per-user override if present,
-- otherwise the school-wide default. Defaults to false (deny) if anything is missing.
create or replace function public.can_access_product(p text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and approved = true)
     and coalesce(
       -- per-user override (null if the key is absent)
       (select (product_overrides ->> p)::boolean from public.profiles where id = auth.uid()),
       -- else school-wide default
       (select p = any(s.enabled_products)
          from public.profiles pr
          join public.schools s on s.id = pr.school_id
         where pr.id = auth.uid()),
       false
     )
$$;


-- ─────────────────────────────────────────────────────────────────────
-- PART 3: Profiles RLS — let school admins READ their school's users
-- Additive SELECT policy (permissive policies are OR'd). School admins still
-- have NO direct INSERT/UPDATE/DELETE on profiles — see the RPCs in PART 4.
-- ─────────────────────────────────────────────────────────────────────

drop policy if exists "School admins can view their school's profiles" on public.profiles;
create policy "School admins can view their school's profiles"
  on public.profiles for select
  using (
    public.is_school_admin()
    and school_id is not null
    and school_id = public.my_school_id()
  );


-- ─────────────────────────────────────────────────────────────────────
-- PART 4: School-admin RPCs (SECURITY DEFINER)
-- The ONLY way a school admin mutates users. Each validates:
--   caller is super_admin OR (school_admin AND same school as target)
--   target is a plain 'user' (admins can't be modified here)
-- Updates to profiles are captured by the existing audit_profiles trigger.
-- ─────────────────────────────────────────────────────────────────────

-- Shared guard: raises unless the caller may manage `target`. Returns target's school.
create or replace function public._assert_can_manage_user(target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  target_school uuid;
  target_role   public.user_role;
  caller_school uuid;
begin
  if not (public.is_super_admin() or public.is_school_admin()) then
    raise exception 'Not authorized';
  end if;

  select school_id, role into target_school, target_role
    from public.profiles where id = target;

  if target_role is null then
    raise exception 'User not found';
  end if;
  if target_role <> 'user' then
    raise exception 'Cannot modify an administrator account';
  end if;

  if not public.is_super_admin() then
    caller_school := public.my_school_id();
    if caller_school is null or target_school is distinct from caller_school then
      raise exception 'User is not in your school';
    end if;
  end if;

  -- Caller is authorized: green-light the privileged-column UPDATE that the
  -- calling RPC is about to make (checked by guard_profile_privileged_columns,
  -- PART 6). Transaction-local, so it does not leak to other statements.
  perform set_config('app.allow_privileged_profile_update', 'on', true);
end; $$;

-- Approve a pending user in the caller's school.
create or replace function public.approve_school_user(target uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._assert_can_manage_user(target);
  update public.profiles set approved = true where id = target;
end; $$;

-- Deactivate / reactivate a user (keeps them assigned to the school).
create or replace function public.set_school_user_active(target uuid, active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._assert_can_manage_user(target);
  update public.profiles set approved = active where id = target;
end; $$;

-- Remove a user from the school entirely (unassign + deactivate).
-- They drop out of the school admin's view; super-admin can reassign later.
create or replace function public.remove_school_user(target uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._assert_can_manage_user(target);
  update public.profiles set approved = false, school_id = null where id = target;
end; $$;

-- Set a per-user tool override. access = 'allow' | 'deny' | 'inherit'.
create or replace function public.set_user_product_override(target uuid, product text, access text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._assert_can_manage_user(target);

  if product not in ('cico') then
    raise exception 'Unknown product: %', product;
  end if;

  if access = 'allow' then
    update public.profiles
      set product_overrides = product_overrides || jsonb_build_object(product, true)
      where id = target;
  elsif access = 'deny' then
    update public.profiles
      set product_overrides = product_overrides || jsonb_build_object(product, false)
      where id = target;
  elsif access = 'inherit' then
    update public.profiles
      set product_overrides = product_overrides - product
      where id = target;
  else
    raise exception 'Invalid access value: % (expected allow | deny | inherit)', access;
  end if;
end; $$;

-- Set the school-wide enabled products for the CALLER's own school.
create or replace function public.set_school_products(products text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  caller_school uuid;
  allowed       text[] := array['cico'];  -- extend as products are added
  p             text;
begin
  if not (public.is_super_admin() or public.is_school_admin()) then
    raise exception 'Not authorized';
  end if;

  caller_school := public.my_school_id();
  if caller_school is null then
    raise exception 'You are not assigned to a school';
  end if;

  foreach p in array coalesce(products, array[]::text[]) loop
    if p <> all (allowed) then
      raise exception 'Unknown product: %', p;
    end if;
  end loop;

  update public.schools
    set enabled_products = coalesce(products, array[]::text[])
    where id = caller_school;
end; $$;

grant execute on function public.approve_school_user(uuid)               to authenticated;
grant execute on function public.set_school_user_active(uuid, boolean)   to authenticated;
grant execute on function public.remove_school_user(uuid)                to authenticated;
grant execute on function public.set_user_product_override(uuid, text, text) to authenticated;
grant execute on function public.set_school_products(text[])             to authenticated;
-- called by the CICO app to gate access at startup
grant execute on function public.can_access_product(text)                to authenticated;
-- internal guard — not callable directly by clients
revoke execute on function public._assert_can_manage_user(uuid) from public;


-- ─────────────────────────────────────────────────────────────────────
-- PART 6: Privilege-escalation backstop on profiles
-- Defense-in-depth: even if some RLS UPDATE policy lets a user write their own
-- profile row, this trigger forbids changing the security-critical columns
-- (role, approved, school_id, product_overrides, is_admin) unless:
--   • the caller is a super admin, OR
--   • the write comes through a trusted school-admin RPC, which sets the
--     transaction-local flag app.allow_privileged_profile_update (see PART 4).
-- Regular users (and crafted PostgREST calls) can set neither, so they cannot
-- self-promote to super_admin, self-approve, move schools, or self-grant tools.
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.guard_profile_privileged_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Authorized by a trusted RPC in this transaction.
  if current_setting('app.allow_privileged_profile_update', true) = 'on' then
    return new;
  end if;
  -- Super admins may change anything directly.
  if public.is_super_admin() then
    return new;
  end if;
  -- Otherwise none of the privileged columns may change.
  if new.role             is distinct from old.role
     or new.approved          is distinct from old.approved
     or new.school_id         is distinct from old.school_id
     or new.product_overrides is distinct from old.product_overrides
     or new.is_admin          is distinct from old.is_admin then
    raise exception 'Not allowed to modify privileged profile fields';
  end if;
  return new;
end; $$;

drop trigger if exists guard_profiles_privileged on public.profiles;
create trigger guard_profiles_privileged
  before update on public.profiles
  for each row execute function public.guard_profile_privileged_columns();


-- ─────────────────────────────────────────────────────────────────────
-- PART 5: CICO RLS — add the FERPA tool-access gate
-- Rebuilds the strict-isolation policies so access now ALSO requires
-- approval + CICO product access (via can_access_product). Super admins
-- still bypass via is_admin().
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
create policy "CICO access: students"
  on public.cico_students for all
  using (
    public.is_admin() or
    (public.my_school_id() is not null and school_id = public.my_school_id()
     and public.can_access_product('cico'))
  )
  with check (
    public.is_admin() or
    (public.my_school_id() is not null and school_id = public.my_school_id()
     and public.can_access_product('cico'))
  );

-- cico_checkins
create policy "CICO access: checkins"
  on public.cico_checkins for all
  using (
    public.is_admin() or
    (public.my_school_id() is not null and school_id = public.my_school_id()
     and public.can_access_product('cico'))
  )
  with check (
    public.is_admin() or
    (public.my_school_id() is not null and school_id = public.my_school_id()
     and public.can_access_product('cico'))
  );

-- cico_period_scores (no direct school_id — checked via parent checkin)
create policy "CICO access: period scores"
  on public.cico_period_scores for all
  using (
    public.is_admin() or
    (public.can_access_product('cico') and exists (
      select 1 from public.cico_checkins c
      where c.id = checkin_id
      and public.my_school_id() is not null
      and c.school_id = public.my_school_id()
    ))
  );

-- cico_incidents (no direct school_id — checked via parent checkin)
create policy "CICO access: incidents"
  on public.cico_incidents for all
  using (
    public.is_admin() or
    (public.can_access_product('cico') and exists (
      select 1 from public.cico_checkins c
      where c.id = checkin_id
      and public.my_school_id() is not null
      and c.school_id = public.my_school_id()
    ))
  );

-- cico_settings
create policy "CICO access: settings"
  on public.cico_settings for all
  using (
    public.is_admin() or
    (public.my_school_id() is not null and school_id = public.my_school_id()
     and public.can_access_product('cico'))
  )
  with check (
    public.is_admin() or
    (public.my_school_id() is not null and school_id = public.my_school_id()
     and public.can_access_product('cico'))
  );

-- cico_categories
create policy "CICO access: categories"
  on public.cico_categories for all
  using (
    public.is_admin() or
    (public.my_school_id() is not null and school_id = public.my_school_id()
     and public.can_access_product('cico'))
  )
  with check (
    public.is_admin() or
    (public.my_school_id() is not null and school_id = public.my_school_id()
     and public.can_access_product('cico'))
  );

-- cico_incident_types
create policy "CICO access: incident types"
  on public.cico_incident_types for all
  using (
    public.is_admin() or
    (public.my_school_id() is not null and school_id = public.my_school_id()
     and public.can_access_product('cico'))
  )
  with check (
    public.is_admin() or
    (public.my_school_id() is not null and school_id = public.my_school_id()
     and public.can_access_product('cico'))
  );


-- ─────────────────────────────────────────────────────────────────────
-- Done. The legacy profiles.is_admin column is now vestigial — is_admin()
-- reads role instead. Leave the column in place (the signup trigger may
-- still reference it); role is the source of truth going forward.
-- ─────────────────────────────────────────────────────────────────────
