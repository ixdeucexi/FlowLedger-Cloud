create role anon nologin;
create role authenticated nologin;
create schema auth;
create schema private;
grant usage on schema public, private, auth to authenticated;
grant usage on schema public, auth to anon;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table public.households(id uuid primary key, name text not null default 'My Household', created_by uuid not null, is_personal boolean not null default false, created_at timestamptz not null default now());
create table public.household_members(household_id uuid references public.households(id),user_id uuid,role text not null,created_at timestamptz default now(), primary key(household_id,user_id));
create function private.is_household_member(p_household_id uuid) returns boolean language sql security definer set search_path='' as $$ select exists(select 1 from public.household_members where household_id=p_household_id and user_id=auth.uid()) $$;
revoke all on function private.is_household_member(uuid) from public;
grant execute on function private.is_household_member(uuid) to authenticated;
alter table public.households enable row level security;
create policy "households: authenticated read" on public.households for select to authenticated using(created_by=auth.uid() or private.is_household_member(id));
grant select,insert,update,delete on public.households to authenticated;
create table public.financial_fixture(id uuid,household_id uuid,balance numeric,budget_id uuid);
insert into public.households values
('00000000-0000-4000-8000-000000000001','Personal','00000000-0000-4000-8000-000000000011',true,now()),
('00000000-0000-4000-8000-000000000002','Shared','00000000-0000-4000-8000-000000000011',false,now()),
('00000000-0000-4000-8000-000000000003','Other','00000000-0000-4000-8000-000000000099',false,now());
insert into public.household_members(household_id,user_id,role) values
('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011','owner'),
('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000011','owner'),
('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000012','manager'),
('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000013','editor'),
('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000014','viewer');
insert into public.financial_fixture values('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000002',425.12,'00000000-0000-4000-8000-000000000201');
create table public.fixture_before as select (select jsonb_agg(to_jsonb(h)-'name' order by id) from public.households h) as households,(select jsonb_agg(to_jsonb(m) order by household_id,user_id) from public.household_members m) as members,(select jsonb_agg(to_jsonb(f)) from public.financial_fixture f) as finances,(select jsonb_agg(to_jsonb(p)) from pg_policy p where polrelid='public.households'::regclass) as policies;
create function public.fixture_assert(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAIL %',label; end if; raise notice 'PASS %',label; end $$;
create function public.fixture_error(statement text,wanted text) returns void language plpgsql as $$ begin begin execute statement; exception when others then if sqlerrm not like '%'||wanted||'%' then raise exception 'Unexpected error: %',sqlerrm; end if; raise notice 'PASS blocked: %',wanted; return; end; raise exception 'FAIL statement unexpectedly allowed'; end $$;
