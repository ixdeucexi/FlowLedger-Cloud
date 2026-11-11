-- Forecast metadata only. These tables/RPCs never initiate bank transfers or
-- create ledger rows, goal contributions, or bank-balance observations.
create table public.planned_account_transfers (
 id text primary key,
 household_id uuid not null references public.households(id) on delete cascade,
 budget_id uuid not null references public.budgets(id) on delete cascade,
 created_by uuid references auth.users(id) on delete set null,
 name text not null check (name=btrim(name) and char_length(name) between 1 and 80),
 amount numeric not null check (amount>0 and amount<=1000000000 and amount=round(amount,2) and lower(amount::text) not in ('nan','infinity','-infinity')),
 from_account_ref text not null check (char_length(from_account_ref) between 8 and 240),
 to_account_ref text not null check (char_length(to_account_ref) between 8 and 240),
 frequency text not null check (frequency in ('once','monthly')),
 start_date date not null check (start_date between date '0001-01-01' and date '9999-12-31'),
 end_date date check (end_date>=start_date and end_date<=date '9999-12-31'),
 status text not null check (status in ('active','paused')),
 deleted_at timestamptz,
 revision integer not null default 1 check (revision>0),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 last_intent jsonb not null,
 constraint planned_account_transfers_distinct_refs check (from_account_ref<>to_account_ref),
 constraint planned_account_transfers_scope_unique unique (id,household_id,budget_id),
 constraint planned_account_transfers_id check (id=btrim(id) and char_length(id) between 1 and 160)
);
create index planned_account_transfers_scope_idx on public.planned_account_transfers(household_id,budget_id,id);
create index planned_account_transfers_budget_idx on public.planned_account_transfers(budget_id);
create index planned_account_transfers_creator_idx on public.planned_account_transfers(created_by);
create table public.planned_account_transfer_occurrences (
 id uuid primary key default gen_random_uuid(),
 transfer_id text not null,
 household_id uuid not null,
 budget_id uuid not null,
 occurrence_date date not null check (occurrence_date between date '0001-01-01' and date '9999-12-31'),
 scheduled_date_snapshot date not null check (scheduled_date_snapshot between date '0001-01-01' and date '9999-12-31'),
 skipped boolean not null default false,
 from_reflected boolean not null default false,
 to_reflected boolean not null default false,
 from_balance_as_of date,
 to_balance_as_of date,
 amount_snapshot numeric not null check (amount_snapshot>0 and amount_snapshot<=1000000000 and amount_snapshot=round(amount_snapshot,2) and lower(amount_snapshot::text) not in ('nan','infinity','-infinity')),
 from_account_ref_snapshot text not null,
 to_account_ref_snapshot text not null,
 template_revision_snapshot integer not null check (template_revision_snapshot>0),
 revision integer not null default 1 check (revision>0),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 last_intent jsonb not null,
 foreign key (transfer_id,household_id,budget_id) references public.planned_account_transfers(id,household_id,budget_id) on delete cascade,
 unique (transfer_id,occurrence_date),
 check (from_account_ref_snapshot<>to_account_ref_snapshot),
 check (date_trunc('month',scheduled_date_snapshot::timestamp)=date_trunc('month',occurrence_date::timestamp)),
 check (from_reflected=(from_balance_as_of is not null)),
 check (to_reflected=(to_balance_as_of is not null)),
 check (from_balance_as_of is null or from_balance_as_of between date '0001-01-01' and date '9999-12-31'),
 check (to_balance_as_of is null or to_balance_as_of between date '0001-01-01' and date '9999-12-31')
);
-- A reviewed monthly occurrence supersedes any later series-day change in its month.
create unique index planned_account_transfer_occurrences_month_unique on public.planned_account_transfer_occurrences(transfer_id,(date_trunc('month',occurrence_date::timestamp)::date));
create index planned_account_transfer_occurrences_scope_idx on public.planned_account_transfer_occurrences(household_id,budget_id,occurrence_date,transfer_id);
comment on column public.planned_account_transfers.last_intent is 'Internal exact authenticated mutation receipt, omitted from RPC results.';
comment on column public.planned_account_transfer_occurrences.last_intent is 'Internal exact authenticated mutation receipt, omitted from RPC results.';
alter table public.planned_account_transfers enable row level security;
alter table public.planned_account_transfer_occurrences enable row level security;
revoke all on public.planned_account_transfers,public.planned_account_transfer_occurrences from public,anon,authenticated,service_role;
-- Read fields are allowlisted: direct table reads cannot expose mutation receipts.
grant select(id,household_id,budget_id,created_by,name,amount,from_account_ref,to_account_ref,frequency,start_date,end_date,status,deleted_at,revision,created_at,updated_at) on public.planned_account_transfers to authenticated;
grant select(id,transfer_id,household_id,budget_id,occurrence_date,scheduled_date_snapshot,skipped,from_reflected,to_reflected,from_balance_as_of,to_balance_as_of,amount_snapshot,from_account_ref_snapshot,to_account_ref_snapshot,template_revision_snapshot,revision,created_at,updated_at) on public.planned_account_transfer_occurrences to authenticated;
create policy planned_account_transfers_member_read on public.planned_account_transfers for select to authenticated
 using ((select auth.uid()) is not null and (select private.is_household_member(household_id)));
create policy planned_account_transfer_occurrences_member_read on public.planned_account_transfer_occurrences for select to authenticated
 using ((select auth.uid()) is not null and (select private.is_household_member(household_id)));

-- Narrow private writer functions own the new metadata tables. They deliberately
-- do not grant callers direct write access or change any existing RLS policy.
create function private.planned_transfer_scope(p_household_id uuid,p_budget_id uuid,p_write boolean)
returns void language plpgsql volatile security invoker set search_path='' as $$
begin
 if auth.uid() is null or p_household_id is null or not private.is_household_member(p_household_id) then raise exception 'Household access required'; end if;
 if p_write and not private.is_household_editor(p_household_id) then raise exception 'Household edit access required'; end if;
 if p_budget_id is null or not exists(select 1 from public.budgets where id=p_budget_id and household_id=p_household_id) then raise exception 'Choose a budget in this household'; end if;
end;$$;
-- Acquire authorization rows only after the household planning advisory lock.
-- Revocation/role changes then linearize before or after the metadata mutation,
-- including waits inside account validation, without an advisory/member lock inversion.
create function private.planned_transfer_lock_scope(p_household_id uuid,p_budget_id uuid)
returns void language plpgsql volatile security invoker set search_path='' as $$
begin
 perform 1 from public.household_members where household_id=p_household_id and user_id=auth.uid() for share;
 if not found then raise exception 'Household access required'; end if;
 perform private.planned_transfer_scope(p_household_id,p_budget_id,true);
 perform 1 from public.budgets where id=p_budget_id and household_id=p_household_id for share;
 if not found then raise exception 'Choose a budget in this household'; end if;
 perform private.planned_transfer_scope(p_household_id,p_budget_id,true);
end;$$;
create function private.planned_transfer_date(p_text text)
returns date language plpgsql immutable security invoker set search_path='' as $$
declare d date;
begin
 if p_text is null or p_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Choose a valid date (YYYY-MM-DD)'; end if;
 d:=p_text::date;
 if d::text<>p_text or d<date '0001-01-01' or d>date '9999-12-31' then raise exception 'Choose a valid date (YYYY-MM-DD)'; end if;
 return d;
end;$$;
create function private.planned_transfer_occurs(p_start date,p_end date,p_frequency text,p_date date)
returns boolean language sql immutable security invoker set search_path='' as $$
 select p_date>=p_start and (p_end is null or p_date<=p_end) and
 case when p_frequency='once' then p_date=p_start when p_frequency='monthly' then
 extract(day from p_date)=least(extract(day from p_start),extract(day from (date_trunc('month',p_date)::date+interval '1 month - 1 day')))
 else false end
$$;
-- A reviewed date is a stable identity, separate from its financial date.
-- Reset may move the scheduled date inside that same calendar month; subsequent
-- series edits must never reinterpret this dated snapshot again.
create function private.planned_transfer_scheduled_date(p_start date,p_end date,p_frequency text,p_month date)
returns date language sql immutable security invoker set search_path='' as $$
 with candidate as (
 select case when p_frequency='once' then
  case when date_trunc('month',p_start::timestamp)=date_trunc('month',p_month::timestamp) then p_start else null end
 else date_trunc('month',p_month::timestamp)::date+
  (least(extract(day from p_start)::integer,extract(day from (date_trunc('month',p_month::timestamp)+interval '1 month - 1 day'))::integer)-1) end as d)
 select case when private.planned_transfer_occurs(p_start,p_end,p_frequency,d) then d else null end from candidate
$$;
create function private.planned_transfer_month_scheduled(p_start date,p_end date,p_frequency text,p_month date)
returns boolean language sql immutable security invoker set search_path='' as $$
 select private.planned_transfer_scheduled_date(p_start,p_end,p_frequency,p_month) is not null
$$;
create function private.planned_transfer_pair(p_household_id uuid,p_budget_id uuid,p_from text,p_to text)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare f jsonb;t jsonb;
begin
 -- Resolution uses only explicit same-household physical aliases. Existing
 -- resolver rejects inactive, foreign, conflicting, credit and non-USD accounts.
 f:=private.forecast_account_details(p_household_id,p_budget_id,p_from,true);
 t:=private.forecast_account_details(p_household_id,p_budget_id,p_to,true);
 if f is null or t is null or f->>'physical_key'=t->>'physical_key' or f->>'ref'=t->>'ref' then raise exception 'Choose two different cash accounts'; end if;
 return jsonb_build_object('from',f->>'ref','to',t->>'ref');
end;$$;

create function private.get_planned_account_transfer_data(p_household_id uuid,p_budget_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform private.planned_transfer_scope(p_household_id,p_budget_id,false);
 -- A single statement observes templates and adjustments at the same snapshot.
 return jsonb_build_object('transfers',coalesce((select jsonb_agg(to_jsonb(t)-'last_intent' order by t.created_at,t.id) from public.planned_account_transfers t where t.household_id=p_household_id and t.budget_id=p_budget_id),'[]'::jsonb),
  'occurrences',coalesce((select jsonb_agg(to_jsonb(o)-'last_intent' order by o.occurrence_date,o.transfer_id) from public.planned_account_transfer_occurrences o where o.household_id=p_household_id and o.budget_id=p_budget_id),'[]'::jsonb));
end;$$;
create function public.get_planned_account_transfer_data(p_household_id uuid,p_budget_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$select private.get_planned_account_transfer_data(p_household_id,p_budget_id)$$;

create function private.save_planned_account_transfer(p_household_id uuid,p_budget_id uuid,p_transfer_id text,p_expected_revision bigint,p_patch jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare r public.planned_account_transfers%rowtype; n public.planned_account_transfers%rowtype; intent jsonb; k text; pair jsonb; creating boolean;
begin
 perform private.planned_transfer_scope(p_household_id,p_budget_id,true);
 if p_transfer_id is null or p_transfer_id<>btrim(p_transfer_id) or length(p_transfer_id) not between 1 and 160 then raise exception 'Choose a valid transfer ID'; end if;
 if p_patch is null or jsonb_typeof(p_patch)<>'object' or p_patch='{}'::jsonb then raise exception 'Provide transfer changes'; end if;
 for k in select jsonb_object_keys(p_patch) loop
  if k not in ('name','amount','from_account_ref','to_account_ref','frequency','start_date','end_date','status') then raise exception 'Unsupported transfer field: %',k; end if;
  if k<>'end_date' and jsonb_typeof(p_patch->k)='null' then raise exception 'Transfer field cannot be empty: %',k; end if;
 end loop;
 if p_expected_revision is not null and (p_expected_revision<1 or p_expected_revision>=2147483647) then raise exception 'Choose a valid transfer revision'; end if;
 intent:=jsonb_build_object('actor',auth.uid(),'expected',p_expected_revision,'patch',p_patch);
 perform pg_advisory_xact_lock(hashtextextended('flowledger:planned-transfers:'||p_household_id::text,0));
 perform private.planned_transfer_lock_scope(p_household_id,p_budget_id);
 select * into r from public.planned_account_transfers where id=p_transfer_id for update;
 creating:=not found;
 if not creating then
  if r.household_id<>p_household_id or r.budget_id<>p_budget_id then raise exception 'Transfer not found in this household plan'; end if;
  if r.last_intent=intent then return jsonb_build_object('transfer',to_jsonb(r)-'last_intent','retry',true); end if;
  if r.deleted_at is not null then raise exception 'This planned transfer was deleted'; end if;
  if p_expected_revision is null or r.revision<>p_expected_revision then raise exception 'Transfer changed. Refresh and try again'; end if;
  n:=r;
 else
  if p_expected_revision is not null then raise exception 'Transfer not found in this household plan'; end if;
  if not (p_patch ?& array['name','amount','from_account_ref','to_account_ref','frequency','start_date','end_date','status']) then raise exception 'Complete the transfer details'; end if;
  n.id:=p_transfer_id;n.household_id:=p_household_id;n.budget_id:=p_budget_id;n.created_by:=auth.uid();n.revision:=1;n.created_at:=clock_timestamp();
 end if;
 if p_patch?'name' then
  if jsonb_typeof(p_patch->'name')<>'string' then raise exception 'Enter a transfer name'; end if;
  n.name:=btrim(p_patch->>'name');
 end if;
 if n.name is null or length(n.name) not between 1 and 80 then raise exception 'Keep the transfer name between 1 and 80 characters'; end if;
 if p_patch?'amount' then
  if jsonb_typeof(p_patch->'amount')<>'number' then raise exception 'Enter a positive amount with at most two decimals'; end if;
  n.amount:=(p_patch->>'amount')::numeric;
 end if;
 if n.amount is null or lower(n.amount::text) in ('nan','infinity','-infinity') or n.amount<=0 or n.amount>1000000000 or n.amount<>round(n.amount,2) then raise exception 'Enter a positive amount with at most two decimals'; end if;
 foreach k in array array['from_account_ref','to_account_ref','frequency','status'] loop
  if p_patch?k and jsonb_typeof(p_patch->k)<>'string' then raise exception 'Choose a valid transfer field: %',k; end if;
 end loop;
 if p_patch?'from_account_ref' then n.from_account_ref:=p_patch->>'from_account_ref'; end if;
 if p_patch?'to_account_ref' then n.to_account_ref:=p_patch->>'to_account_ref'; end if;
 if p_patch?'frequency' then n.frequency:=p_patch->>'frequency'; end if;
 if p_patch?'status' then n.status:=p_patch->>'status'; end if;
 if n.frequency not in ('once','monthly') or n.status not in ('active','paused') then raise exception 'Choose a valid frequency and status'; end if;
 if p_patch?'start_date' then n.start_date:=private.planned_transfer_date(p_patch->>'start_date'); end if;
 if p_patch?'end_date' then n.end_date:=case when p_patch->'end_date'='null'::jsonb then null else private.planned_transfer_date(p_patch->>'end_date') end; end if;
 if n.end_date<n.start_date then raise exception 'The last date must be on or after the first date'; end if;
 -- A pure stop/name edit on an existing paused plan can retain now-unavailable
 -- endpoints. Any creation, active financial edit, resume or endpoint edit
 -- validates the full pair; pausing cannot smuggle a foreign replacement ref.
 if creating or n.status='active' or n.from_account_ref is distinct from r.from_account_ref or n.to_account_ref is distinct from r.to_account_ref then
  pair:=private.planned_transfer_pair(p_household_id,p_budget_id,n.from_account_ref,n.to_account_ref);
  n.from_account_ref:=pair->>'from';n.to_account_ref:=pair->>'to';
 end if;
 if not creating then n.revision:=r.revision+1; end if;
 -- Revalidate after account resolution, which can wait on current account rows.
 perform private.planned_transfer_scope(p_household_id,p_budget_id,true);
 n.updated_at:=clock_timestamp();n.last_intent:=intent;
 if creating then insert into public.planned_account_transfers select n.* returning * into n;
 else update public.planned_account_transfers set name=n.name,amount=n.amount,from_account_ref=n.from_account_ref,to_account_ref=n.to_account_ref,frequency=n.frequency,start_date=n.start_date,end_date=n.end_date,status=n.status,revision=n.revision,updated_at=n.updated_at,last_intent=n.last_intent where id=n.id returning * into n; end if;
 return jsonb_build_object('transfer',to_jsonb(n)-'last_intent','retry',false);
end;$$;
create function public.save_planned_account_transfer(p_household_id uuid,p_budget_id uuid,p_transfer_id text,p_expected_revision bigint,p_patch jsonb)
returns jsonb language sql volatile security invoker set search_path='' as $$select private.save_planned_account_transfer(p_household_id,p_budget_id,p_transfer_id,p_expected_revision,p_patch)$$;

create function private.delete_planned_account_transfer(p_household_id uuid,p_budget_id uuid,p_transfer_id text,p_expected_revision bigint)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare r public.planned_account_transfers%rowtype; intent jsonb;
begin
 perform private.planned_transfer_scope(p_household_id,p_budget_id,true);
 if p_expected_revision is null or p_expected_revision<1 or p_expected_revision>=2147483647 then raise exception 'Choose a valid transfer revision'; end if;
 intent:=jsonb_build_object('actor',auth.uid(),'expected',p_expected_revision,'delete',true);
 perform pg_advisory_xact_lock(hashtextextended('flowledger:planned-transfers:'||p_household_id::text,0));
 perform private.planned_transfer_lock_scope(p_household_id,p_budget_id);
 select * into r from public.planned_account_transfers where id=p_transfer_id and household_id=p_household_id and budget_id=p_budget_id for update;
 if not found then raise exception 'Transfer not found in this household plan'; end if;
 if r.last_intent=intent then return jsonb_build_object('transfer',to_jsonb(r)-'last_intent','retry',true); end if;
 if r.deleted_at is not null or r.revision<>p_expected_revision then raise exception 'Transfer changed. Refresh and try again'; end if;
 update public.planned_account_transfers set deleted_at=clock_timestamp(),updated_at=clock_timestamp(),revision=revision+1,last_intent=intent where id=r.id returning * into r;
 return jsonb_build_object('transfer',to_jsonb(r)-'last_intent','retry',false);
end;$$;
create function public.delete_planned_account_transfer(p_household_id uuid,p_budget_id uuid,p_transfer_id text,p_expected_revision bigint)
returns jsonb language sql volatile security invoker set search_path='' as $$select private.delete_planned_account_transfer(p_household_id,p_budget_id,p_transfer_id,p_expected_revision)$$;

create function private.save_planned_account_transfer_occurrence(p_household_id uuid,p_budget_id uuid,p_transfer_id text,p_occurrence_date date,p_expected_template_revision bigint,p_expected_revision bigint,p_patch jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare t public.planned_account_transfers%rowtype; r public.planned_account_transfer_occurrences%rowtype; n public.planned_account_transfer_occurrences%rowtype; k text; intent jsonb; creating boolean; reset_snapshot boolean; current_month_scheduled boolean; pair jsonb;
begin
 perform private.planned_transfer_scope(p_household_id,p_budget_id,true);
 if p_occurrence_date is null or p_occurrence_date<date '0001-01-01' or p_occurrence_date>date '9999-12-31' then raise exception 'Choose a valid occurrence date'; end if;
 if p_expected_template_revision is null or p_expected_template_revision<1 or p_expected_template_revision>2147483647 or (p_expected_revision is not null and (p_expected_revision<1 or p_expected_revision>=2147483647)) then raise exception 'Choose a valid transfer revision'; end if;
 if p_patch is null or jsonb_typeof(p_patch)<>'object' or p_patch='{}'::jsonb then raise exception 'Provide occurrence changes'; end if;
 for k in select jsonb_object_keys(p_patch) loop
  if k not in ('skipped','from_reflected','to_reflected','from_balance_as_of','to_balance_as_of','use_current_plan') then raise exception 'Unsupported occurrence field: %',k; end if;
  if k in ('skipped','from_reflected','to_reflected','use_current_plan') and jsonb_typeof(p_patch->k)<>'boolean' then raise exception 'Choose a valid occurrence state'; end if;
 end loop;
 if coalesce((p_patch->>'use_current_plan')::boolean,false) and (select count(*) from jsonb_object_keys(p_patch))<>1 then raise exception 'Reset the occurrence separately from other changes'; end if;
 intent:=jsonb_build_object('actor',auth.uid(),'expected_template',p_expected_template_revision,'expected',p_expected_revision,'patch',p_patch);
 perform pg_advisory_xact_lock(hashtextextended('flowledger:planned-transfers:'||p_household_id::text,0));
 perform private.planned_transfer_lock_scope(p_household_id,p_budget_id);
 select * into t from public.planned_account_transfers where id=p_transfer_id and household_id=p_household_id and budget_id=p_budget_id for update;
 if not found then raise exception 'Transfer not found in this household plan'; end if;
 select * into r from public.planned_account_transfer_occurrences where transfer_id=t.id and occurrence_date=p_occurrence_date for update;
 creating:=not found;
 -- An identical successful retry remains a retry even after a later template
 -- edit, without reinterpreting its frozen occurrence snapshot.
 if not creating and r.last_intent=intent then return jsonb_build_object('transfer',to_jsonb(t)-'last_intent','occurrence',to_jsonb(r)-'last_intent','retry',true); end if;
 if t.revision<>p_expected_template_revision then raise exception 'Transfer changed. Refresh and try again'; end if;
 if creating then
  if exists(select 1 from public.planned_account_transfer_occurrences where transfer_id=t.id and date_trunc('month',occurrence_date::timestamp)=date_trunc('month',p_occurrence_date::timestamp)) then raise exception 'This month already has a reviewed occurrence. Edit its original date'; end if;
  if p_expected_revision is not null then raise exception 'Occurrence changed. Refresh and try again'; end if;
  if t.deleted_at is not null or t.status<>'active' or not private.planned_transfer_occurs(t.start_date,t.end_date,t.frequency,p_occurrence_date) then raise exception 'Choose a scheduled occurrence'; end if;
  n.id:=gen_random_uuid();n.transfer_id:=t.id;n.household_id:=t.household_id;n.budget_id:=t.budget_id;n.occurrence_date:=p_occurrence_date;n.skipped:=false;n.from_reflected:=false;n.to_reflected:=false;n.revision:=1;n.created_at:=clock_timestamp();
 else
  if p_expected_revision is null or r.revision<>p_expected_revision then raise exception 'Occurrence changed. Refresh and try again'; end if;
  n:=r;n.revision:=r.revision+1;
 end if;
 reset_snapshot:=coalesce((p_patch->>'use_current_plan')::boolean,false);
 current_month_scheduled:=t.status='active' and t.deleted_at is null and coalesce(private.planned_transfer_month_scheduled(t.start_date,t.end_date,t.frequency,p_occurrence_date),false);
 if reset_snapshot and not current_month_scheduled then raise exception 'This month has no active planned occurrence. Skip the remaining side to cancel it'; end if;
 if creating or reset_snapshot then
  -- Skip-only creation may cancel a scheduled plan after an endpoint became
  -- unavailable. Reset is an explicit new interpretation and requires live refs.
  if reset_snapshot or not (p_patch @> '{"skipped":true}'::jsonb) then
   pair:=private.planned_transfer_pair(p_household_id,p_budget_id,t.from_account_ref,t.to_account_ref);
  end if;
  n.scheduled_date_snapshot:=case when creating then p_occurrence_date else private.planned_transfer_scheduled_date(t.start_date,t.end_date,t.frequency,p_occurrence_date) end;
  n.amount_snapshot:=t.amount;n.from_account_ref_snapshot:=coalesce(pair->>'from',t.from_account_ref);n.to_account_ref_snapshot:=coalesce(pair->>'to',t.to_account_ref);n.template_revision_snapshot:=t.revision;
  if reset_snapshot then n.skipped:=false;n.from_reflected:=false;n.to_reflected:=false;n.from_balance_as_of:=null;n.to_balance_as_of:=null; end if;
 end if;
 if p_patch?'skipped' then n.skipped:=(p_patch->>'skipped')::boolean; end if;
 if p_patch?'from_reflected' then n.from_reflected:=(p_patch->>'from_reflected')::boolean; end if;
 if p_patch?'to_reflected' then n.to_reflected:=(p_patch->>'to_reflected')::boolean; end if;
 if p_patch?'from_balance_as_of' then n.from_balance_as_of:=case when p_patch->'from_balance_as_of'='null'::jsonb then null else private.planned_transfer_date(p_patch->>'from_balance_as_of') end; end if;
 if p_patch?'to_balance_as_of' then n.to_balance_as_of:=case when p_patch->'to_balance_as_of'='null'::jsonb then null else private.planned_transfer_date(p_patch->>'to_balance_as_of') end; end if;
 if not n.from_reflected then n.from_balance_as_of:=null; end if;
 if not n.to_reflected then n.to_balance_as_of:=null; end if;
 if n.from_reflected and n.from_balance_as_of is null or n.to_reflected and n.to_balance_as_of is null then raise exception 'Choose the balance date for each reflected side'; end if;
 if not creating and r.from_reflected<>r.to_reflected and not n.skipped and not n.from_reflected and not n.to_reflected and not current_month_scheduled then
  raise exception 'Skip this occurrence before clearing its last reflected side';
 end if;
 if (n.from_reflected and (creating or not r.from_reflected or n.from_balance_as_of is distinct from r.from_balance_as_of)) or (n.to_reflected and (creating or not r.to_reflected or n.to_balance_as_of is distinct from r.to_balance_as_of)) or (not creating and r.skipped and not n.skipped) then
  perform private.planned_transfer_pair(p_household_id,p_budget_id,n.from_account_ref_snapshot,n.to_account_ref_snapshot);
 end if;
 -- Revalidate after account resolution, which can wait on current account rows.
 perform private.planned_transfer_scope(p_household_id,p_budget_id,true);
 n.updated_at:=clock_timestamp();n.last_intent:=intent;
 if creating then insert into public.planned_account_transfer_occurrences select n.* returning * into n;
 else update public.planned_account_transfer_occurrences set scheduled_date_snapshot=n.scheduled_date_snapshot,skipped=n.skipped,from_reflected=n.from_reflected,to_reflected=n.to_reflected,from_balance_as_of=n.from_balance_as_of,to_balance_as_of=n.to_balance_as_of,amount_snapshot=n.amount_snapshot,from_account_ref_snapshot=n.from_account_ref_snapshot,to_account_ref_snapshot=n.to_account_ref_snapshot,template_revision_snapshot=n.template_revision_snapshot,revision=n.revision,updated_at=n.updated_at,last_intent=n.last_intent where id=n.id returning * into n; end if;
 return jsonb_build_object('transfer',to_jsonb(t)-'last_intent','occurrence',to_jsonb(n)-'last_intent','retry',false);
end;$$;
create function public.save_planned_account_transfer_occurrence(p_household_id uuid,p_budget_id uuid,p_transfer_id text,p_occurrence_date date,p_expected_template_revision bigint,p_expected_revision bigint,p_patch jsonb)
returns jsonb language sql volatile security invoker set search_path='' as $$select private.save_planned_account_transfer_occurrence(p_household_id,p_budget_id,p_transfer_id,p_occurrence_date,p_expected_template_revision,p_expected_revision,p_patch)$$;

revoke all on function private.planned_transfer_scope(uuid,uuid,boolean),private.planned_transfer_lock_scope(uuid,uuid),private.planned_transfer_date(text),private.planned_transfer_occurs(date,date,text,date),private.planned_transfer_month_scheduled(date,date,text,date),private.planned_transfer_scheduled_date(date,date,text,date),private.planned_transfer_pair(uuid,uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function private.get_planned_account_transfer_data(uuid,uuid),public.get_planned_account_transfer_data(uuid,uuid),private.save_planned_account_transfer(uuid,uuid,text,bigint,jsonb),public.save_planned_account_transfer(uuid,uuid,text,bigint,jsonb),private.delete_planned_account_transfer(uuid,uuid,text,bigint),public.delete_planned_account_transfer(uuid,uuid,text,bigint),private.save_planned_account_transfer_occurrence(uuid,uuid,text,date,bigint,bigint,jsonb),public.save_planned_account_transfer_occurrence(uuid,uuid,text,date,bigint,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.get_planned_account_transfer_data(uuid,uuid),public.get_planned_account_transfer_data(uuid,uuid),private.save_planned_account_transfer(uuid,uuid,text,bigint,jsonb),public.save_planned_account_transfer(uuid,uuid,text,bigint,jsonb),private.delete_planned_account_transfer(uuid,uuid,text,bigint),public.delete_planned_account_transfer(uuid,uuid,text,bigint),private.save_planned_account_transfer_occurrence(uuid,uuid,text,date,bigint,bigint,jsonb),public.save_planned_account_transfer_occurrence(uuid,uuid,text,date,bigint,bigint,jsonb) to authenticated;
