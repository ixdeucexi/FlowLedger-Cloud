-- Repair household invite code generation on Supabase projects where pgcrypto
-- functions live in the extensions schema instead of public.

create schema if not exists extensions;
create extension if not exists "pgcrypto" with schema extensions;

create or replace function public.create_household_invite(
  p_household_id uuid,
  p_role text default 'editor'
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  invite_code text;
begin
  if public.household_role(p_household_id) <> 'owner' then
    raise exception 'Only the household owner can create invites';
  end if;

  if coalesce(p_role, 'editor') not in ('editor', 'viewer') then
    raise exception 'Invalid invite role';
  end if;

  invite_code := upper(substr(encode(gen_random_bytes(9), 'hex'), 1, 12));

  insert into household_invites (household_id, code_hash, role, created_by)
  values (
    p_household_id,
    encode(digest(invite_code, 'sha256'), 'hex'),
    coalesce(p_role, 'editor'),
    auth.uid()
  );

  return invite_code;
end $$;

create or replace function public.accept_household_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  invite household_invites%rowtype;
  clean_code text;
begin
  clean_code := upper(regexp_replace(coalesce(p_code, ''), '\s+', '', 'g'));
  if clean_code = '' then
    raise exception 'Invite code is required';
  end if;

  select *
    into invite
  from household_invites
  where code_hash = encode(digest(clean_code, 'sha256'), 'hex')
    and revoked_at is null
    and accepted_at is null
    and expires_at > now()
  limit 1;

  if invite.id is null then
    raise exception 'Invite code is invalid or expired';
  end if;

  insert into household_members (household_id, user_id, role)
  values (invite.household_id, auth.uid(), invite.role)
  on conflict (household_id, user_id) do update set role = excluded.role;

  update household_invites
    set accepted_by = auth.uid(), accepted_at = now()
  where id = invite.id;

  insert into user_preferences (user_id, active_household_id, updated_at)
  values (auth.uid(), invite.household_id, now())
  on conflict (user_id) do update
    set active_household_id = excluded.active_household_id,
        updated_at = now();

  return invite.household_id;
end $$;
