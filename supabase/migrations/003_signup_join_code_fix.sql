-- ============================================================================
-- hamkar-mvp: robust signup + organization join-code setup (Supabase/PostgreSQL)
-- Safe to rerun. Run as a database owner / migration role.
-- This transaction backfills legacy organizations; valid existing codes are
-- preserved (normalized to uppercase), while blank/colliding values are reset.
-- ============================================================================

begin;

-- UUID generation is built into supported Supabase PostgreSQL versions; this
-- avoids depending on whether pgcrypto is installed in public or extensions.
alter table public.organizations
  add column if not exists join_code text;

-- Use 16 hex characters (64 random bits) for new organizations. A UNIQUE
-- expression index below makes uniqueness case-insensitive and retries in RPCs
-- handle even the exceptionally unlikely random collision.
alter table public.organizations
  alter column join_code set default
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));

-- Make legacy values suitable for a case-insensitive unique index. Keep the
-- first occurrence of a repeated code and regenerate later occurrences.
update public.organizations
set join_code = null
where join_code is null or btrim(join_code) = '';

with ranked as (
  select id,
         row_number() over (
           partition by lower(btrim(join_code))
           order by id
         ) as duplicate_number
  from public.organizations
  where join_code is not null
)
update public.organizations as o
set join_code = null
from ranked as r
where r.id = o.id
  and r.duplicate_number > 1;

-- Canonicalize retained legacy codes and regenerate values which cannot safely
-- be used as short, human-entered invitation codes.
update public.organizations
set join_code = upper(btrim(join_code))
where join_code is not null;

update public.organizations
set join_code = null
where join_code is not null
  and join_code !~ '^[A-Z0-9-]{4,64}$';

-- Fill nulls, checking against all existing codes. Repeat on conflicts so this
-- also works for a large legacy table and is not reliant on randomness alone.
do $backfill$
declare
  r record;
  v_code text;
begin
  for r in
    select id from public.organizations where join_code is null order by id
  loop
    loop
      v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
      update public.organizations as o
         set join_code = v_code
       where o.id = r.id
         and not exists (
           select 1 from public.organizations as taken
           where lower(btrim(taken.join_code)) = lower(v_code)
             and taken.id <> r.id
         );
      exit when found;
    end loop;
  end loop;
end
$backfill$;

alter table public.organizations
  alter column join_code set not null;

-- Named index can safely be created on databases where an older migration
-- already added a case-sensitive UNIQUE constraint on join_code.
create unique index if not exists organizations_join_code_ci_uidx
  on public.organizations (lower(btrim(join_code)));

-- Guard against direct writes of empty / malformed codes. Existing rows have
-- already been canonicalized above. The named constraint is idempotent.
do $constraint$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.organizations'::regclass
      and c.conname = 'organizations_join_code_format_check'
  ) then
    alter table public.organizations
      add constraint organizations_join_code_format_check
      check (join_code = upper(btrim(join_code)) and join_code ~ '^[A-Z0-9-]{4,64}$');
  end if;
end
$constraint$;

-- Manager-only read of the caller's code. Fully qualified objects and a
-- restricted search_path prevent search-path object substitution.
create or replace function public.my_join_code()
returns text
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select o.join_code
  from public.organizations as o
  join public.profiles as p on p.organization_id = o.id
  where p.id = auth.uid()
    and p.role = 'manager'
$function$;

-- Rotate only the authenticated manager's own organization's code. UPDATE's
-- unique-index check is retried on the (extremely unlikely) random collision.
create or replace function public.rotate_my_join_code()
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_org uuid;
  v_code text;
begin
  select p.organization_id
    into v_org
  from public.profiles as p
  where p.id = auth.uid()
    and p.role = 'manager';

  if v_org is null then
    raise exception using errcode = '42501',
      message = 'Only an organization manager can rotate its join code';
  end if;

  -- Serialize concurrent rotations so each caller receives the code that
  -- remains current when its transaction commits.
  perform 1 from public.organizations as o where o.id = v_org for update;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'The manager organization no longer exists';
  end if;

  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
    begin
      update public.organizations as o
         set join_code = v_code
       where o.id = v_org;
      if not found then
        raise exception using errcode = 'P0002',
          message = 'The manager organization no longer exists';
      end if;
      return v_code;
    exception when unique_violation then
      -- The failed UPDATE is rolled back to this exception block's savepoint.
      null;
    end;
  end loop;
end
$function$;

revoke all on function public.my_join_code() from public, anon, authenticated;
revoke all on function public.rotate_my_join_code() from public, anon, authenticated;
grant execute on function public.my_join_code() to authenticated;
grant execute on function public.rotate_my_join_code() to authenticated;

-- Create a profile + organization in the same transaction as auth.users insert.
-- Any validation error aborts signup, rather than leaving a partial account.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_role text;
  v_name text;
  v_org_name text;
  v_email text;
  v_org uuid;
  v_mgr uuid;
  v_code text;
  v_org_text text;
begin
  v_role := lower(btrim(coalesce(new.raw_user_meta_data ->> 'role', '')));
  v_email := coalesce(nullif(btrim(new.email), ''), '');
  v_name := left(
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(v_email, '@', 1), ''),
      'کاربر'
    ),
    120
  );

  if v_role = 'manager' then
    v_org_name := left(
      coalesce(nullif(btrim(new.raw_user_meta_data ->> 'organization_name'), ''), 'سازمان من'),
      160
    );

    insert into public.organizations (name)
    values (v_org_name)
    returning id into v_org;

    insert into public.profiles (id, organization_id, role, full_name, email)
    values (new.id, v_org, 'manager', v_name, v_email);

  elsif v_role = 'employee' then
    -- A supplied join code takes precedence. Invalid codes fail closed; do not
    -- silently fall back to a caller-supplied organization UUID.
    v_code := nullif(btrim(new.raw_user_meta_data ->> 'join_code'), '');
    if v_code is not null then
      select o.id
        into v_org
      from public.organizations as o
      where lower(btrim(o.join_code)) = lower(v_code)
      limit 1;

      if v_org is null then
        raise exception using errcode = '22023', message = 'Invalid organization join code';
      end if;
    else
      v_org_text := nullif(btrim(new.raw_user_meta_data ->> 'organization_id'), '');
      if v_org_text is null then
        raise exception using errcode = '22023', message = 'Employee signup requires a join code';
      end if;
      begin
        v_org := v_org_text::uuid;
      exception when invalid_text_representation then
        raise exception using errcode = '22023', message = 'Invalid organization_id UUID';
      end;
      if not exists (select 1 from public.organizations as o where o.id = v_org) then
        raise exception using errcode = '22023', message = 'Organization does not exist';
      end if;
    end if;

    -- Use a stable first manager if the organization has several managers.
    select p.id
      into v_mgr
    from public.profiles as p
    where p.organization_id = v_org
      and p.role = 'manager'
    order by p.created_at, p.id
    limit 1;

    insert into public.profiles (
      id, organization_id, manager_id, role, full_name, email,
      phone, title, department
    ) values (
      new.id, v_org, v_mgr, 'employee', v_name, v_email,
      nullif(btrim(new.raw_user_meta_data ->> 'phone'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'title'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'department'), '')
    );
  else
    raise exception using errcode = '22023',
      message = 'Signup requires user_metadata.role to be manager or employee';
  end if;

  return new;
end
$function$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

commit;
