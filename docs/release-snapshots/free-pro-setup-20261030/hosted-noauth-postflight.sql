-- OPTIONAL READ ONLY permission smoke; execute only AFTER catalog gate PASS.
-- No customer IDs, financial reads, quota reservations, provider calls or DML.
-- Unauthorized calls stop at EXECUTE ACL; authorized getAccess with no JWT stops
-- at feature_session_required. Do not call service reservation/refund here:
-- their row locks are intentionally incompatible with READ ONLY transactions.
BEGIN READ ONLY;
SET LOCAL "request.jwt.claim.sub"='';
SET LOCAL "request.jwt.claims"='{}';
DO $gate$
DECLARE candidate_role text; rejected boolean; denied integer:=0;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'No-auth smoke requires empty auth.uid()'; END IF;
  FOREACH candidate_role IN ARRAY ARRAY['anon','service_role'] LOOP
    EXECUTE pg_catalog.format('SET LOCAL ROLE %I',candidate_role);
    rejected:=false;
    BEGIN
      PERFORM public.get_household_feature_access(NULL::uuid,NULL::text);
    EXCEPTION WHEN insufficient_privilege THEN rejected:=true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Unexpected getAccess EXECUTE for %',candidate_role; END IF;
    denied:=denied+1;
  END LOOP;
  FOREACH candidate_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    EXECUTE pg_catalog.format('SET LOCAL ROLE %I',candidate_role);
    rejected:=false;
    BEGIN
      PERFORM public.reserve_flo_plan_request(NULL::uuid,NULL::uuid,NULL::uuid,NULL::text);
    EXCEPTION WHEN insufficient_privilege THEN rejected:=true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Unexpected reserve EXECUTE for %',candidate_role; END IF;
    denied:=denied+1;
    rejected:=false;
    BEGIN
      PERFORM public.refund_flo_plan_request(NULL::uuid,NULL::uuid,NULL::uuid);
    EXCEPTION WHEN insufficient_privilege THEN rejected:=true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Unexpected refund EXECUTE for %',candidate_role; END IF;
    denied:=denied+1;
  END LOOP;
  SET LOCAL ROLE authenticated;
  rejected:=false;
  BEGIN
    PERFORM public.get_household_feature_access(NULL::uuid,NULL::text);
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM='feature_session_required' THEN rejected:=true; ELSE RAISE; END IF;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'getAccess failed to reject no-auth authenticated caller'; END IF;
  SET LOCAL ROLE NONE;
  RAISE NOTICE 'PASS: % EXECUTE denials plus no-auth getAccess guard; no financial/customer rows accessed',denied;
END;
$gate$;
ROLLBACK;
