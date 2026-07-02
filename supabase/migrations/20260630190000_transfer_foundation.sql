-- Account transfer foundation. A transfer is stored as two normal
-- transactions tied together by one group id: money out of one account,
-- money into another account.
alter table transactions add column if not exists transfer_group_id text;

create index if not exists transactions_user_transfer_group_idx
  on transactions(user_id, transfer_group_id)
  where transfer_group_id is not null;
