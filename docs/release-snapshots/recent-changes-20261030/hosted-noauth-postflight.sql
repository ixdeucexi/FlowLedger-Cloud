-- OPTIONAL READ ONLY runtime permission smoke. No signed-in identity or customer IDs.
-- Run only AFTER catalog postflight is PASS and exact reviewed migration applied.
-- Calls list/undo as anon/service_role (42501 before body), then authenticated
-- with empty JWT claims (P0001 sign-in guard before any journal/financial SELECT).
-- Contains no DDL/DML and runs in an explicitly read-only transaction.
BEGIN READ ONLY;
SET LOCAL "request.jwt.claim.sub"='';
SET LOCAL "request.jwt.claims"='{}';
DO $gate$
DECLARE candidate_role text; rejected boolean; list_rejections integer:=0; undo_rejections integer:=0;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'No-auth smoke requires empty auth.uid()'; END IF;
  FOREACH candidate_role IN ARRAY ARRAY['anon','service_role'] LOOP
    EXECUTE pg_catalog.format('SET LOCAL ROLE %I',candidate_role);
    rejected:=false;
    BEGIN
      PERFORM public.list_recent_changes(NULL::uuid,NULL::uuid,NULL::bigint,1);
    EXCEPTION WHEN insufficient_privilege THEN rejected:=true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Unexpected list EXECUTE permission for %',candidate_role; END IF;
    list_rejections:=list_rejections+1;
    rejected:=false;
    BEGIN
      PERFORM public.undo_recent_change(NULL::uuid,NULL::uuid,NULL::uuid);
    EXCEPTION WHEN insufficient_privilege THEN rejected:=true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Unexpected Undo EXECUTE permission for %',candidate_role; END IF;
    undo_rejections:=undo_rejections+1;
  END LOOP;
  SET LOCAL ROLE authenticated;
  rejected:=false;
  BEGIN
    PERFORM public.list_recent_changes(NULL::uuid,NULL::uuid,NULL::bigint,1);
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='Sign in to view recent changes' THEN rejected:=true; ELSE RAISE; END IF;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'List failed to reject no-auth authenticated caller'; END IF;
  list_rejections:=list_rejections+1;
  rejected:=false;
  BEGIN
    PERFORM public.undo_recent_change(NULL::uuid,NULL::uuid,NULL::uuid);
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='Sign in to view recent changes' THEN rejected:=true; ELSE RAISE; END IF;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Undo failed to reject no-auth authenticated caller'; END IF;
  undo_rejections:=undo_rejections+1;
  SET LOCAL ROLE NONE;
  RAISE NOTICE 'PASS: % list and % Undo no-auth rejections; no financial/customer records accessed',list_rejections,undo_rejections;
END;
$gate$;
ROLLBACK;
