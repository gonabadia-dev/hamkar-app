-- Hamkar advanced reporting and manager assignments
create table if not exists public.daily_penalties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  penalty_score numeric not null default -5,
  exempt boolean not null default false,
  created_at timestamptz not null default now(),
  unique(user_id,date)
);
create index if not exists daily_penalties_user_date_idx on public.daily_penalties(user_id,date desc);
alter table public.daily_penalties enable row level security;
drop policy if exists penalties_read on public.daily_penalties;
create policy penalties_read on public.daily_penalties for select to authenticated using(user_id=auth.uid() or public.is_manager_of(user_id));
drop policy if exists penalties_manager_insert on public.daily_penalties;
create policy penalties_manager_insert on public.daily_penalties for insert to authenticated with check(public.is_manager_of(user_id));
drop policy if exists penalties_manager_update on public.daily_penalties;
create policy penalties_manager_update on public.daily_penalties for update to authenticated using(public.is_manager_of(user_id)) with check(public.is_manager_of(user_id));

create table if not exists public.manager_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  manager_id uuid not null references public.profiles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check(length(title) between 1 and 180),
  description text not null default '',
  due_date date not null,
  created_at timestamptz not null default now(),
  check(manager_id <> user_id)
);
create index if not exists manager_tasks_user_due_idx on public.manager_tasks(user_id,due_date);
alter table public.manager_tasks enable row level security;
drop policy if exists manager_tasks_read on public.manager_tasks;
create policy manager_tasks_read on public.manager_tasks for select to authenticated using(user_id=auth.uid() or public.is_manager_of(user_id));
drop policy if exists manager_tasks_insert on public.manager_tasks;
create policy manager_tasks_insert on public.manager_tasks for insert to authenticated with check(manager_id=auth.uid() and public.is_manager_of(user_id) and organization_id=public.current_org());
drop policy if exists manager_tasks_update on public.manager_tasks;
create policy manager_tasks_update on public.manager_tasks for update to authenticated using(manager_id=auth.uid() and public.is_manager_of(user_id)) with check(manager_id=auth.uid() and public.is_manager_of(user_id));
drop policy if exists manager_tasks_delete on public.manager_tasks;
create policy manager_tasks_delete on public.manager_tasks for delete to authenticated using(manager_id=auth.uid() and public.is_manager_of(user_id));

-- Managers can create future-dated reports for their own direct reports.
drop policy if exists reports_insert_manager_future on public.daily_reports;
create policy reports_insert_manager_future on public.daily_reports for insert to authenticated
  with check(public.is_manager_of(user_id) and organization_id=public.current_org() and report_date>current_date);
create or replace function public.guard_future_manager_report() returns trigger
language plpgsql security definer set search_path=public,auth as $$
begin
  if auth.uid() is distinct from new.user_id then
    if not public.is_manager_of(new.user_id) or new.report_date<=current_date then
      raise exception 'manager may only create future reports for direct reports';
    end if;
    if new.organization_id is distinct from public.current_org() then raise exception 'organization mismatch'; end if;
  end if;
  return new;
end $$;
drop trigger if exists report_insert_future_guard on public.daily_reports;
create trigger report_insert_future_guard before insert on public.daily_reports for each row execute function public.guard_future_manager_report();

-- Catch up missing days (excluding Fridays). Run on a schedule via pg_cron or call manually.
create or replace function public.calculate_missing_report_days(p_through date default current_date)
returns integer language plpgsql security definer set search_path=public,auth as $$
declare v_manager uuid:=auth.uid(); v_inserted integer:=0; v_count integer;
begin
  if v_manager is null or not exists(select 1 from public.profiles where id=v_manager and role='manager') then
    raise exception 'manager authorization required';
  end if;
  insert into public.daily_penalties(user_id,date,penalty_score,exempt)
  select e.id,d.day,-5,false
  from public.profiles e
  cross join lateral generate_series(
    coalesce((select max(p.date)+1 from public.daily_penalties p where p.user_id=e.id), e.created_at::date),
    least(p_through,current_date), interval '1 day') as d(day)
  where e.role='employee' and e.manager_id=v_manager
    and extract(isodow from d.day)::integer<>5
    and not exists(select 1 from public.daily_reports r where r.user_id=e.id and r.report_date=d.day::date)
    and not exists(select 1 from public.daily_penalties p where p.user_id=e.id and p.date=d.day::date)
  on conflict(user_id,date) do nothing;
  get diagnostics v_inserted=row_count;
  return v_inserted;
end $$;
revoke all on function public.calculate_missing_report_days(date) from public;
grant execute on function public.calculate_missing_report_days(date) to authenticated;

-- A lightweight aggregate for the employee team chart.
create or replace function public.team_activity_overview()
returns table(full_name text,report_count bigint,average_score numeric)
language sql stable security definer set search_path=public,auth as $$
 select e.full_name,count(r.id),round(avg(coalesce(r.manager_score,r.score)),1)
 from public.profiles me join public.profiles e on e.organization_id=me.organization_id and e.role='employee'
 left join public.daily_reports r on r.user_id=e.id
 where me.id=auth.uid() and me.role='employee' and e.manager_id=me.manager_id
 group by e.id,e.full_name order by e.full_name
$$;
revoke all on function public.team_activity_overview() from public;
grant execute on function public.team_activity_overview() to authenticated;
