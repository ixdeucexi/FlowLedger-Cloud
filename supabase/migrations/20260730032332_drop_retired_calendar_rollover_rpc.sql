-- The automatic rollover feature is retired, so no client-callable privileged
-- endpoint should remain in the exposed public schema.
drop function if exists public.rollover_my_pro_calendar(uuid);

notify pgrst, 'reload schema';
