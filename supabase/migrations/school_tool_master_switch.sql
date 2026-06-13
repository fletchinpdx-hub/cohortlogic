-- ═══════════════════════════════════════════════════════════════════════
-- Cohort Logic — School Tool Toggle = Hard Master Switch
--
-- Supersedes the can_access_product() semantics from school_admin_roles.sql.
--
-- BEFORE: per-user override beat the school default, so a user with an
--         "allow" override kept access even when the school turned the tool off.
-- AFTER:  the school's enabled_products is a REQUIRED gate (logical AND).
--         If the school has the product off, NO ONE has it — regardless of
--         any per-user override. When the product is on, a per-user override
--         can still BLOCK an individual (deny). Per-user "allow" is therefore
--         only ever a no-op above the school setting.
--
-- Effective access = approved
--                AND product ∈ school.enabled_products      (master switch)
--                AND NOT individually blocked               (override = false)
--
-- Also: hardens the JSONB read so a malformed override value can never raise
-- inside an RLS check, and audits changes to the schools table (tool toggles).
--
-- Run once in the Supabase SQL Editor. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.can_access_product(p text)
returns boolean language sql stable security definer set search_path = public as $$
  select
    -- must be an approved account
    exists (select 1 from public.profiles where id = auth.uid() and approved = true)
    -- MASTER SWITCH: the product must be enabled for the user's school
    and exists (
      select 1
        from public.profiles pr
        join public.schools s on s.id = pr.school_id
       where pr.id = auth.uid()
         and p = any(s.enabled_products)
    )
    -- per-user override may only BLOCK (override value of false). Read as text
    -- and compare — never cast to boolean, so a bad value can't error the RLS check.
    and not coalesce(
      (select (product_overrides ->> p) = 'false' from public.profiles where id = auth.uid()),
      false
    )
$$;

-- Audit changes to the schools table (incl. enabled_products tool toggles) so
-- there's a FERPA-grade record of who changed a school's access settings.
-- log_audit_event() is defined in ferpa_compliance.sql.
drop trigger if exists audit_schools on public.schools;
create trigger audit_schools
  after insert or update or delete on public.schools
  for each row execute function public.log_audit_event();
