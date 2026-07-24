-- Household records use one authenticated policy per command.
-- Mutations that need broader privileges continue through their guarded RPCs.

drop policy if exists "Household invites can be read by managers" on public.household_invites;
drop policy if exists "household invites: owners read" on public.household_invites;
create policy "household invites: managers read"
  on public.household_invites for select to authenticated
  using ((select public.is_household_manager(household_id)));

drop policy if exists "members: owner manages" on public.household_members;
drop policy if exists "members: household members read" on public.household_members;
drop policy if exists "members: user reads membership" on public.household_members;
create policy "members: authenticated read"
  on public.household_members for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_household_member(household_id)));
create policy "members: owners insert"
  on public.household_members for insert to authenticated
  with check ((select public.household_role(household_id)) = 'owner');
create policy "members: owners update"
  on public.household_members for update to authenticated
  using ((select public.household_role(household_id)) = 'owner')
  with check ((select public.household_role(household_id)) = 'owner');
create policy "members: owners delete"
  on public.household_members for delete to authenticated
  using ((select public.household_role(household_id)) = 'owner');

drop policy if exists "household settings: editors write" on public.household_settings;
drop policy if exists "household settings: members read" on public.household_settings;
create policy "household settings: authenticated read"
  on public.household_settings for select to authenticated
  using ((select public.is_household_member(household_id)));
create policy "household settings: editors insert"
  on public.household_settings for insert to authenticated
  with check ((select public.is_household_editor(household_id)));
create policy "household settings: editors update"
  on public.household_settings for update to authenticated
  using ((select public.is_household_editor(household_id)))
  with check ((select public.is_household_editor(household_id)));
create policy "household settings: editors delete"
  on public.household_settings for delete to authenticated
  using ((select public.is_household_editor(household_id)));

drop policy if exists "households: members read" on public.households;
drop policy if exists "households: owner reads" on public.households;
create policy "households: authenticated read"
  on public.households for select to authenticated
  using (created_by = (select auth.uid()) or (select public.is_household_member(id)));
