-- Saldo Express Nicaragua - KYC básico con revisión manual
-- Nota: esta migración NO crea almacenamiento de fotos/documentos.
-- Para documentos de cédula/selfie conviene usar un proveedor KYC especializado
-- o buckets privados con una política de retención clara.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update
    set email = excluded.email;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
on public.profiles
for select
to authenticated
using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update"
on public.profiles
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create table if not exists public.kyc_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  legal_name text not null,
  cedula_number text not null,
  phone text not null,
  paypal_email text not null,
  paypal_account_holder text not null,
  bank_name text not null,
  bank_account_number text not null,
  bank_account_holder text not null,
  user_attests_own_accounts boolean not null default false,
  privacy_accepted boolean not null default false,
  terms_accepted boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'blocked')),
  review_notes text,
  reviewed_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.kyc_profiles enable row level security;

drop trigger if exists kyc_profiles_touch_updated_at on public.kyc_profiles;
create trigger kyc_profiles_touch_updated_at
before update on public.kyc_profiles
for each row execute function public.touch_updated_at();

create index if not exists kyc_profiles_status_idx on public.kyc_profiles (status);
create index if not exists kyc_profiles_paypal_email_idx on public.kyc_profiles (lower(paypal_email));
create index if not exists kyc_profiles_cedula_idx on public.kyc_profiles (cedula_number);

drop policy if exists "kyc_select_own_or_admin" on public.kyc_profiles;
create policy "kyc_select_own_or_admin"
on public.kyc_profiles
for select
to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "kyc_admin_update" on public.kyc_profiles;
create policy "kyc_admin_update"
on public.kyc_profiles
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create table if not exists public.kyc_review_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  old_status text,
  new_status text not null,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.kyc_review_events enable row level security;

drop policy if exists "kyc_review_events_admin_select" on public.kyc_review_events;
create policy "kyc_review_events_admin_select"
on public.kyc_review_events
for select
to authenticated
using (public.is_admin());

drop policy if exists "kyc_review_events_admin_insert" on public.kyc_review_events;
create policy "kyc_review_events_admin_insert"
on public.kyc_review_events
for insert
to authenticated
with check (public.is_admin());

create or replace function public.submit_kyc(
  p_legal_name text,
  p_cedula_number text,
  p_phone text,
  p_paypal_email text,
  p_paypal_account_holder text,
  p_bank_name text,
  p_bank_account_number text,
  p_bank_account_holder text,
  p_user_attests_own_accounts boolean,
  p_privacy_accepted boolean,
  p_terms_accepted boolean
)
returns public.kyc_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_result public.kyc_profiles;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if length(trim(coalesce(p_legal_name, ''))) < 6 then
    raise exception 'legal_name_required' using errcode = '22023';
  end if;

  if length(trim(coalesce(p_cedula_number, ''))) < 8 then
    raise exception 'cedula_required' using errcode = '22023';
  end if;

  if position('@' in coalesce(p_paypal_email, '')) = 0 then
    raise exception 'paypal_email_invalid' using errcode = '22023';
  end if;

  if not coalesce(p_user_attests_own_accounts, false) then
    raise exception 'own_accounts_attestation_required' using errcode = '22023';
  end if;

  if not coalesce(p_privacy_accepted, false) or not coalesce(p_terms_accepted, false) then
    raise exception 'legal_acceptance_required' using errcode = '22023';
  end if;

  insert into public.profiles (id, email)
  select id, email
  from auth.users
  where id = v_user_id
  on conflict (id) do nothing;

  insert into public.kyc_profiles (
    user_id,
    legal_name,
    cedula_number,
    phone,
    paypal_email,
    paypal_account_holder,
    bank_name,
    bank_account_number,
    bank_account_holder,
    user_attests_own_accounts,
    privacy_accepted,
    terms_accepted,
    status,
    review_notes,
    reviewed_by,
    submitted_at,
    reviewed_at
  )
  values (
    v_user_id,
    trim(p_legal_name),
    trim(p_cedula_number),
    trim(p_phone),
    lower(trim(p_paypal_email)),
    trim(p_paypal_account_holder),
    trim(p_bank_name),
    trim(p_bank_account_number),
    trim(p_bank_account_holder),
    p_user_attests_own_accounts,
    p_privacy_accepted,
    p_terms_accepted,
    'pending',
    null,
    null,
    now(),
    null
  )
  on conflict (user_id) do update
    set legal_name = excluded.legal_name,
        cedula_number = excluded.cedula_number,
        phone = excluded.phone,
        paypal_email = excluded.paypal_email,
        paypal_account_holder = excluded.paypal_account_holder,
        bank_name = excluded.bank_name,
        bank_account_number = excluded.bank_account_number,
        bank_account_holder = excluded.bank_account_holder,
        user_attests_own_accounts = excluded.user_attests_own_accounts,
        privacy_accepted = excluded.privacy_accepted,
        terms_accepted = excluded.terms_accepted,
        status = 'pending',
        review_notes = null,
        reviewed_by = null,
        submitted_at = now(),
        reviewed_at = null
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function public.review_kyc(
  p_user_id uuid,
  p_status text,
  p_notes text default null
)
returns public.kyc_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_old_status text;
  v_result public.kyc_profiles;
begin
  if v_actor is null or not public.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_status not in ('pending', 'approved', 'rejected', 'blocked') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select status into v_old_status
  from public.kyc_profiles
  where user_id = p_user_id;

  if v_old_status is null then
    raise exception 'kyc_not_found' using errcode = '02000';
  end if;

  update public.kyc_profiles
  set status = p_status,
      review_notes = nullif(trim(coalesce(p_notes, '')), ''),
      reviewed_by = v_actor,
      reviewed_at = now()
  where user_id = p_user_id
  returning * into v_result;

  insert into public.kyc_review_events (user_id, actor_id, old_status, new_status, notes)
  values (p_user_id, v_actor, v_old_status, p_status, nullif(trim(coalesce(p_notes, '')), ''));

  return v_result;
end;
$$;

create table if not exists public.exchange_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount_usd numeric(12, 2) not null check (amount_usd >= 25),
  mode text not null check (mode in ('express', 'international')),
  note text,
  status text not null default 'submitted' check (status in ('submitted', 'contacted', 'completed', 'cancelled', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.exchange_requests enable row level security;

drop trigger if exists exchange_requests_touch_updated_at on public.exchange_requests;
create trigger exchange_requests_touch_updated_at
before update on public.exchange_requests
for each row execute function public.touch_updated_at();

drop policy if exists "exchange_select_own_or_admin" on public.exchange_requests;
create policy "exchange_select_own_or_admin"
on public.exchange_requests
for select
to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "exchange_admin_update" on public.exchange_requests;
create policy "exchange_admin_update"
on public.exchange_requests
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create or replace function public.submit_exchange_request(
  p_amount_usd numeric,
  p_mode text,
  p_note text default null
)
returns public.exchange_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_result public.exchange_requests;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if not exists (
    select 1
    from public.kyc_profiles
    where user_id = v_user_id
      and status = 'approved'
  ) then
    raise exception 'kyc_not_approved' using errcode = '42501';
  end if;

  if p_mode not in ('express', 'international') then
    raise exception 'invalid_mode' using errcode = '22023';
  end if;

  insert into public.exchange_requests (user_id, amount_usd, mode, note)
  values (v_user_id, p_amount_usd, p_mode, nullif(trim(coalesce(p_note, '')), ''))
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on public.profiles from anon, authenticated;
revoke all on public.kyc_profiles from anon, authenticated;
revoke all on public.kyc_review_events from anon, authenticated;
revoke all on public.exchange_requests from anon, authenticated;

grant select on public.profiles to authenticated;
grant select on public.kyc_profiles to authenticated;
grant select on public.kyc_review_events to authenticated;
grant select on public.exchange_requests to authenticated;

grant update on public.profiles to authenticated;
grant update on public.kyc_profiles to authenticated;
grant update on public.exchange_requests to authenticated;

grant execute on function public.submit_kyc(
  text, text, text, text, text, text, text, text, boolean, boolean, boolean
) to authenticated;
grant execute on function public.review_kyc(uuid, text, text) to authenticated;
grant execute on function public.submit_exchange_request(numeric, text, text) to authenticated;

