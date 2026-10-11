-- ============================================================================
-- hamkar-mvp — Migration 002: ثبت‌نام خودکار بدون Edge Function
-- ----------------------------------------------------------------------------
-- جریان کامل فقط با supabase.auth.signUp از مرورگر کار می‌کند:
--   * role = 'manager'  → ساخت سازمان + پروفایل مدیر به‌صورت خودکار
--   * role = 'employee' → اتصال به سازمان از طریق join_code یا organization_id
-- مدیر با RPC امن public.my_join_code() کد دعوت سازمان خودش را می‌گیرد و
-- در اختیار همکاران می‌گذارد؛ هیچ سرویس سمت سرور دیگری لازم نیست.
-- ============================================================================

-- 1) کد دعوت برای هر سازمان ----------------------------------------------------
alter table public.organizations add column if not exists join_code text unique;

update public.organizations
set join_code = upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8))
where join_code is null;

-- 2) RPC: مدیر فقط کد سازمان خودش را می‌بیند (security definer تا RLS دور زده شود)
create or replace function public.my_join_code() returns text
language sql stable security definer set search_path = public, auth as $$
  select o.join_code
  from public.organizations o
  join public.profiles p on p.organization_id = o.id
  where p.id = auth.uid() and p.role = 'manager'
$$;

create or replace function public.rotate_my_join_code() returns text
language plpgsql security definer set search_path = public, auth as $$
declare v_code text; v_org uuid;
begin
  select organization_id into v_org from public.profiles
  where id = auth.uid() and role = 'manager';
  if v_org is null then raise exception 'فقط مدیر به این عمل دسترسی دارد'; end if;
  loop
    v_code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
    begin
      update public.organizations set join_code = v_code where id = v_org;
      exit;
    exception when unique_violation then continue;
    end;
  end loop;
  return v_code;
end $$;

revoke all on function public.my_join_code() from public;
revoke all on function public.rotate_my_join_code() from public;
grant execute on function public.my_join_code() to authenticated;
grant execute on function public.rotate_my_join_code() to authenticated;

-- 3) تریگر خودکار پس از auth.signUp --------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare
  v_role text;
  v_name text;
  v_org  uuid;
  v_mgr  uuid;
  v_code text;
begin
  v_role := coalesce(new.raw_user_meta_data->>'role', '');
  v_name := coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1));

  if v_role = 'manager' then
    -- ساخت سازمان و پروفایل مدیر در یک تراکنش
    insert into public.organizations(name)
    values (coalesce(nullif(new.raw_user_meta_data->>'organization_name', ''), 'سازمان من'))
    returning id into v_org;

    insert into public.profiles(id, organization_id, role, full_name, email)
    values (new.id, v_org, 'manager', v_name, new.email);

  elsif v_role = 'employee' then
    -- اتصال به سازمان: اولویت با join_code، سپس organization_id صریح
    v_code := nullif(new.raw_user_meta_data->>'join_code', '');
    if v_code is not null then
      select o.id into v_org from public.organizations o where o.join_code = v_code;
      if v_org is null then
        raise exception 'کد دعوت نامعتبر است';
      end if;
    else
      v_org := (new.raw_user_meta_data->>'organization_id')::uuid;
    end if;

    if v_org is null then
      raise exception 'برای ثبت‌نام همکار، join_code لازم است';
    end if;

    -- مدیر پیش‌فرض سازمان (اولین مدیر ثبت‌شده) به‌عنوان مدیر مستقیم
    select p.id into v_mgr
    from public.profiles p
    where p.organization_id = v_org and p.role = 'manager'
    order by p.created_at
    limit 1;

    insert into public.profiles(
      id, organization_id, manager_id, role, full_name, email, phone, title, department
    ) values (
      new.id, v_org, v_mgr, 'employee', v_name, new.email,
      nullif(new.raw_user_meta_data->>'phone', ''),
      nullif(new.raw_user_meta_data->>'title', ''),
      nullif(new.raw_user_meta_data->>'department', '')
    );
  else
    raise exception 'ثبت‌نام بدون role در user_metadata مجاز نیست';
  end if;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- 4) یادداشت‌های عملیاتی --------------------------------------------------------
-- * در Supabase → Authentication → Providers → Email، گزینه‌ی «Confirm email»
--   را برای تست محلی خاموش کنید تا بلافاصله با signInWithPassword وارد شوید.
-- * ارزیابی مدیر (manager_score / manager_feedback) از قبل با RLS پالیسی
--   reports_update_manager روی daily_reports مستقیم مجاز است؛ نیازی به تابع سرور نیست.
-- * رونویسی/خلاصه‌ی صوت بدون OpenAI: کارمند متن را تایپ می‌کند یا یک «پردازش شبیه‌سازی‌شده»
--   سمت کلاینت رونویسی را در voice_reports.transcript ذخیره می‌کند (RLS پشتیبانی می‌کند).
