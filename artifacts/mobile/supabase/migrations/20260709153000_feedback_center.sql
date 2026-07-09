create table if not exists public.feedback_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  created_at timestamptz not null default now()
);

create table if not exists public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text,
  user_name text,
  feedback_type text not null default 'other'
    check (feedback_type in ('bug', 'idea', 'confusing', 'design', 'setup', 'other')),
  screen text not null default 'unknown',
  message text not null check (char_length(btrim(message)) between 3 and 4000),
  rating integer check (rating between 1 and 5),
  can_contact boolean not null default false,
  status text not null default 'new'
    check (status in ('new', 'reviewing', 'fixed', 'wont_fix')),
  app_version text,
  platform text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_feedback_user_created_idx
  on public.app_feedback (user_id, created_at desc);
create index if not exists app_feedback_status_created_idx
  on public.app_feedback (status, created_at desc);
create index if not exists app_feedback_type_created_idx
  on public.app_feedback (feedback_type, created_at desc);

alter table public.feedback_admins enable row level security;
alter table public.app_feedback enable row level security;

drop policy if exists "feedback admins can read admin list" on public.feedback_admins;
create policy "feedback admins can read admin list"
on public.feedback_admins
for select
to authenticated
using (
  exists (
    select 1
    from public.feedback_admins admins
    where admins.user_id = (select auth.uid())
  )
);

drop policy if exists "users can create their own feedback" on public.app_feedback;
create policy "users can create their own feedback"
on public.app_feedback
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "users can read own feedback and admins can read all" on public.app_feedback;
create policy "users can read own feedback and admins can read all"
on public.app_feedback
for select
to authenticated
using (
  (select auth.uid()) = user_id
  or exists (
    select 1
    from public.feedback_admins admins
    where admins.user_id = (select auth.uid())
  )
);

drop policy if exists "feedback admins can update feedback status" on public.app_feedback;
create policy "feedback admins can update feedback status"
on public.app_feedback
for update
to authenticated
using (
  exists (
    select 1
    from public.feedback_admins admins
    where admins.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.feedback_admins admins
    where admins.user_id = (select auth.uid())
  )
);

grant select on public.feedback_admins to authenticated;
grant select, insert, update on public.app_feedback to authenticated;

insert into public.feedback_admins (user_id, email)
select id, email::text
from auth.users
where lower(email::text) = 'john.collins0515@gmail.com'
on conflict (user_id) do update set email = excluded.email;
