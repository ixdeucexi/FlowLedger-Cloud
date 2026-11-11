\set ON_ERROR_STOP on
-- New-table FK coverage, including all ordered columns of the composite key.
select test.assert((select count(*)=10 from pg_index where indrelid in('public.planned_account_transfers'::regclass,'public.planned_account_transfer_occurrences'::regclass)),'planning tables expose ten intended indexes');
select test.assert(exists(
 select 1 from pg_index i where i.indexrelid='public.planned_account_transfer_occurrences_parent_scope_idx'::regclass
 and i.indisvalid and i.indisready and i.indpred is null and i.indexprs is null and i.indnkeyatts=3
 and (select array_agg(a.attname::text order by k.ordinality) from unnest(i.indkey) with ordinality k(attnum,ordinality)
  join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum where k.ordinality<=i.indnkeyatts)
  =array['transfer_id','household_id','budget_id']
),'occurrence parent FK index has all three ordered columns');
select test.assert(not exists(
 select 1 from pg_constraint c where c.contype='f' and c.conrelid in('public.planned_account_transfers'::regclass,'public.planned_account_transfer_occurrences'::regclass)
 and not exists(select 1 from pg_index i where i.indrelid=c.conrelid and i.indisvalid and i.indisready and i.indpred is null
  and i.indnkeyatts>=cardinality(c.conkey)
  and (select array_agg(k.attnum order by k.ordinality) from unnest(i.indkey) with ordinality k(attnum,ordinality) where k.ordinality<=cardinality(c.conkey))=c.conkey)
),'every new foreign key has a full leading-column index');
\echo PLANNED TRANSFER CATALOG CHECKS COMPLETE
