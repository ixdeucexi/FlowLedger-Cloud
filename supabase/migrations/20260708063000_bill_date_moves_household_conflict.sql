-- Keep household calendar bill moves stable across multiple household editors.
-- Personal legacy rows still use the existing (user_id, bill_id, from_date) key.

with ranked_moves as (
  select
    id,
    row_number() over (
      partition by household_id, bill_id, from_date
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as row_number
  from public.bill_date_moves
  where household_id is not null
)
delete from public.bill_date_moves moves
using ranked_moves ranked
where moves.id = ranked.id
  and ranked.row_number > 1;

create unique index if not exists bill_date_moves_household_bill_from_unique
  on public.bill_date_moves (household_id, bill_id, from_date);
