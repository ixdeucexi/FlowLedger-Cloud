alter table if exists public.bills
  add column if not exists smart_priority text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'bills_smart_priority_check'
      and conrelid = 'public.bills'::regclass
  ) then
    alter table public.bills
      add constraint bills_smart_priority_check
      check (smart_priority is null or smart_priority in ('must', 'flexible', 'optional'));
  end if;
end $$;
