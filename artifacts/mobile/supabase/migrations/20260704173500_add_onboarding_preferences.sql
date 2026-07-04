alter table public.user_preferences
add column if not exists onboarding_preferences jsonb not null default '{}'::jsonb;
