-- READ ONLY hosted postflight: metadata and the existing Review Center release switch only.
-- No customer financial rows, plan rows, provider calls, DDL, or DML.
-- FlowLedger project imqmhfdquqlqxgtcdbvc / link_6a503490139c819193052154d4922f3d.
-- Reviewed backend 06e0459e40f0b647b3bfecc97130e3d17e7029b4, merged as c1512b1 + 5ebf0fa.
-- Migration 20261030121749_free_pro_feature_access.sql SHA256 19052bed56c99dbb33fc20c48e59737adc17837ab47f89b5a21e89cc2455ee37.
-- Run only after applying that exact migration. allPassed must be true.
-- Canonical expectations derive from the full hosted BEFORE definitions captured
-- for this release, with only the exact reviewed guard replacements applied.
-- No canonical expectation is taken from the disposable test schema.
BEGIN READ ONLY;
SET LOCAL search_path = pg_catalog, public;
WITH
expected_functions(ns,name,args,language_name,security_definer,result_type,volatility,defaults,auth_execute,service_execute,body_md5) AS (VALUES
  ('private','feature_access_for_user','uuid, uuid, text','plpgsql',true,'jsonb','s',1,false,false,'47e1ba8e20c032ff42a84f39504f8786'),
  ('public','reserve_flo_plan_request','uuid, uuid, uuid, text','sql',false,'jsonb','v',1,false,true,'5001598e4cd9701665b922528565b5d1'),
  ('private','lock_feature_scope','uuid, uuid','plpgsql',true,'void','v',0,false,false,'ca03560bc80253f5e9eaa77755753d26'),
  ('private','get_household_feature_access','uuid, text','sql',true,'jsonb','s',1,true,false,'ba42b39f2e95c83cd90fc00833d996a2'),
  ('public','get_household_feature_access','uuid, text','sql',false,'jsonb','s',1,true,false,'f7df0169d4e7b805b81342a6c0542c35'),
  ('private','reserve_flo_plan_request','uuid, uuid, uuid, text','plpgsql',true,'jsonb','v',1,false,true,'a6848bdab57c1908087ef43b12e47d80'),
  ('private','refund_flo_plan_request','uuid, uuid, uuid','plpgsql',true,'boolean','v',0,false,true,'2e6116aa14c9d7ab4b21c8b83b5a0a4f'),
  ('public','refund_flo_plan_request','uuid, uuid, uuid','sql',false,'boolean','v',0,false,true,'f1fa2f4ca5a54ff7a58412ab6e180178')
),
functions AS (
 SELECT e.*,p.oid,p.prosecdef,p.prorettype,p.provolatile,p.pronargdefaults,p.proconfig,p.prosrc,p.proacl,p.proowner,l.lanname,r.rolname AS owner_name
 FROM expected_functions e
 LEFT JOIN pg_catalog.pg_namespace n ON n.nspname=e.ns
 LEFT JOIN pg_catalog.pg_proc p ON p.pronamespace=n.oid AND p.proname=e.name AND pg_catalog.oidvectortypes(p.proargtypes)=e.args
 LEFT JOIN pg_catalog.pg_language l ON l.oid=p.prolang
 LEFT JOIN pg_catalog.pg_roles r ON r.oid=p.proowner
),
expected_tables(name) AS (VALUES ('founding_planning_access'),('flo_monthly_usage'),('flo_plan_reservations')),
tables AS (
 SELECT e.name,c.oid,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relacl,c.relowner,r.rolname AS owner_name
 FROM expected_tables e
 LEFT JOIN pg_catalog.pg_namespace n ON n.nspname='private'
 LEFT JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid AND c.relname=e.name
 LEFT JOIN pg_catalog.pg_roles r ON r.oid=c.relowner
),
expected_constraints(table_name,name,kind,definition) AS (VALUES
  ('flo_monthly_usage','flo_monthly_usage_request_month_check','c','CHECK ((request_month = (date_trunc(''month''::text, (request_month)::timestamp with time zone))::date))'),
  ('flo_monthly_usage','flo_monthly_usage_request_count_check','c','CHECK ((request_count >= 0))'),
  ('flo_monthly_usage','flo_monthly_usage_pkey','p','PRIMARY KEY (household_id, request_month)'),
  ('flo_monthly_usage','flo_monthly_usage_household_id_fkey','f','FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE'),
  ('flo_plan_reservations','flo_plan_reservations_household_id_fkey','f','FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE'),
  ('flo_plan_reservations','flo_plan_reservations_household_id_request_month_fkey','f','FOREIGN KEY (household_id, request_month) REFERENCES private.flo_monthly_usage(household_id, request_month) ON DELETE CASCADE'),
  ('flo_plan_reservations','flo_plan_reservations_status_check','c','CHECK ((status = ANY (ARRAY[''charged''::text, ''refunded''::text, ''denied''::text])))'),
  ('flo_plan_reservations','flo_plan_reservations_pkey','p','PRIMARY KEY (id)'),
  ('flo_plan_reservations','flo_plan_reservations_user_id_fkey','f','FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'),
  ('founding_planning_access','founding_planning_access_feature_version_check','c','CHECK ((feature_version = 1))'),
  ('founding_planning_access','founding_planning_access_pkey','p','PRIMARY KEY (household_id)'),
  ('founding_planning_access','founding_planning_access_household_id_fkey','f','FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE')
),
expected_indexes(table_name,name,definition) AS (VALUES
  ('flo_monthly_usage','flo_monthly_usage_pkey','CREATE UNIQUE INDEX flo_monthly_usage_pkey ON private.flo_monthly_usage USING btree (household_id, request_month)'),
  ('flo_plan_reservations','flo_plan_reservations_pkey','CREATE UNIQUE INDEX flo_plan_reservations_pkey ON private.flo_plan_reservations USING btree (id)'),
  ('flo_plan_reservations','flo_plan_reservations_user_idx','CREATE INDEX flo_plan_reservations_user_idx ON private.flo_plan_reservations USING btree (user_id)'),
  ('flo_plan_reservations','flo_plan_reservations_month_idx','CREATE INDEX flo_plan_reservations_month_idx ON private.flo_plan_reservations USING btree (household_id, request_month)'),
  ('founding_planning_access','founding_planning_access_pkey','CREATE UNIQUE INDEX founding_planning_access_pkey ON private.founding_planning_access USING btree (household_id)')
),
expected_policies(name,command,using_expression,check_expression) AS (VALUES
  ('plan simulations: pro editors insert','a',NULL,'((EXISTS ( SELECT 1
   FROM household_members member
  WHERE ((member.household_id = plan_simulations.household_id) AND (member.user_id = ( SELECT auth.uid() AS uid)) AND (member.role = ANY (ARRAY[''owner''::text, ''manager''::text, ''editor''::text]))))) AND (EXISTS ( SELECT 1
   FROM household_plans plan
  WHERE ((plan.household_id = plan_simulations.household_id) AND (plan.tier = ''pro''::text)))))'),
  ('plan simulations: pro editors update','w','((EXISTS ( SELECT 1
   FROM household_members member
  WHERE ((member.household_id = plan_simulations.household_id) AND (member.user_id = ( SELECT auth.uid() AS uid)) AND (member.role = ANY (ARRAY[''owner''::text, ''manager''::text, ''editor''::text]))))) AND (EXISTS ( SELECT 1
   FROM household_plans plan
  WHERE ((plan.household_id = plan_simulations.household_id) AND (plan.tier = ''pro''::text)))))','((EXISTS ( SELECT 1
   FROM household_members member
  WHERE ((member.household_id = plan_simulations.household_id) AND (member.user_id = ( SELECT auth.uid() AS uid)) AND (member.role = ANY (ARRAY[''owner''::text, ''manager''::text, ''editor''::text]))))) AND (EXISTS ( SELECT 1
   FROM household_plans plan
  WHERE ((plan.household_id = plan_simulations.household_id) AND (plan.tier = ''pro''::text)))))'),
  ('plan simulations: members read saved data','r','( SELECT is_household_member(plan_simulations.household_id) AS is_household_member)',NULL),
  ('plan simulations: editors delete saved data','d','(EXISTS ( SELECT 1
   FROM household_members member
  WHERE ((member.household_id = plan_simulations.household_id) AND (member.user_id = ( SELECT auth.uid() AS uid)) AND (member.role = ANY (ARRAY[''owner''::text, ''manager''::text, ''editor''::text])))))',NULL)
),
expected_canonical(signature,owner_name,acl,body_md5,definition_md5) AS (VALUES
  ('private.confirm_flo_recurring_bill_proposal(uuid)','postgres','{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}','7fbe37349421f13f4acebdbf9476520c','9c039a6a2dfa3fbda968132992a33786'),
  ('private.create_flo_entity(uuid,text,jsonb,uuid,uuid)','postgres','{postgres=X/postgres,authenticated=X/postgres}','d92979829ac4753686d4c955df51fc08','0cc9feea9cc9e06a99209caf87406577')
),
canonical AS (
 SELECT e.*,p.oid,p.prosrc,p.proacl,p.proowner FROM expected_canonical e
 LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(e.signature)
),
expected_unchanged(name,body_md5) AS (VALUES
  ('assign_default_household_plan','2a9c8bb77a63e1d825b846427ad678c3'),
  ('has_review_center_entitlement','eec02084a558c5d564fda273ad2ac89c'),
  ('protect_plan_simulation_definition','ed8ce762641ed948d75f841e48cf574c')
),
checks(name,passed,detail) AS (
 SELECT 'schema.private_usage',pg_catalog.has_schema_privilege('authenticated','private','USAGE')
    AND pg_catalog.has_schema_privilege('service_role','private','USAGE')
    AND NOT pg_catalog.has_schema_privilege('anon','private','USAGE'),
   'Preserve existing authenticated/service schema usage; anon denied'::text
 UNION ALL SELECT 'functions.exact_expected_overloads',
   (SELECT count(*)=8 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
     WHERE (n.nspname='private' AND p.proname IN ('feature_access_for_user','lock_feature_scope','get_household_feature_access','reserve_flo_plan_request','refund_flo_plan_request'))
        OR (n.nspname='public' AND p.proname IN ('get_household_feature_access','reserve_flo_plan_request','refund_flo_plan_request'))),
   'Reject missing and unexpected overloads for all eight new functions'
 UNION ALL SELECT 'function.'||ns||'.'||name||'.shape_and_body',
   oid IS NOT NULL AND prosecdef=security_definer AND lanname=language_name
     AND pg_catalog.format_type(prorettype,NULL)=result_type AND provolatile::text=volatility
     AND pronargdefaults=defaults AND proconfig=ARRAY['search_path=""']::text[]
     AND owner_name NOT IN ('anon','authenticated','service_role') AND pg_catalog.md5(prosrc)=body_md5,
   'Exact reviewed helper/wrapper body, empty fixed search_path, language/security/defaults and server owner'
 FROM functions
 UNION ALL SELECT 'function.'||ns||'.'||name||'.execute_acl',
   oid IS NOT NULL AND pg_catalog.has_function_privilege('authenticated',oid,'EXECUTE')=auth_execute
     AND pg_catalog.has_function_privilege('service_role',oid,'EXECUTE')=service_execute
     AND NOT pg_catalog.has_function_privilege('anon',oid,'EXECUTE')
     AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(proacl,pg_catalog.acldefault('f',proowner))) a
       WHERE a.grantee<>proowner AND NOT (a.privilege_type='EXECUTE' AND NOT a.is_grantable AND
         ((auth_execute AND a.grantee=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='authenticated'))
          OR (service_execute AND a.grantee=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='service_role'))))),
   'Only authenticated access entrypoints or service-only reservation/refund; all other helpers and PUBLIC denied'
 FROM functions
 UNION ALL SELECT 'table.private.'||name||'.deny_all_rls',
   oid IS NOT NULL AND relkind='r' AND relrowsecurity AND NOT relforcerowsecurity
     AND owner_name NOT IN ('anon','authenticated','service_role')
     AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid=tables.oid)
     AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(relacl,pg_catalog.acldefault('r',relowner))) a WHERE a.grantee<>relowner)
     AND NOT EXISTS(SELECT 1 FROM (VALUES ('anon'),('authenticated'),('service_role')) roles(name)
       WHERE pg_catalog.has_table_privilege(roles.name,tables.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
          OR pg_catalog.has_any_column_privilege(roles.name,tables.oid,'SELECT,INSERT,UPDATE,REFERENCES'))
     AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a,LATERAL pg_catalog.aclexplode(a.attacl) acl WHERE a.attrelid=tables.oid AND acl.grantee<>relowner),
   'Private server-owned RLS tables with zero policies and zero non-owner table/column grants'
 FROM tables
 UNION ALL SELECT 'table.private.'||e.table_name||'.constraint.'||e.name,
   (SELECT count(*)=1 AND bool_and(c.contype::text=e.kind AND c.convalidated AND NOT c.condeferrable AND NOT c.condeferred
      AND pg_catalog.pg_get_constraintdef(c.oid)=e.definition)
    FROM pg_catalog.pg_constraint c WHERE c.conrelid=pg_catalog.to_regclass('private.'||e.table_name) AND c.conname=e.name),
   'Exact validated primary key/check/cascading FK; includes actor, household and captured monthly refund scope'
 FROM expected_constraints e
 UNION ALL SELECT 'tables.exact_constraint_count',
   (SELECT count(*)=12 FROM pg_catalog.pg_constraint c WHERE c.conrelid IN (SELECT oid FROM tables)),
   'No missing or extra constraints on the three new tables'
 UNION ALL SELECT 'index.private.'||e.name,
   (SELECT count(*)=1 AND bool_and(i.indisvalid AND i.indisready AND pg_catalog.pg_get_indexdef(i.indexrelid)=e.definition)
    FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid
    WHERE i.indrelid=pg_catalog.to_regclass('private.'||e.table_name) AND c.relname=e.name),
   'Exact valid/ready primary/actor/month indexes; no unindexed new actor/household/month FK'
 FROM expected_indexes e
 UNION ALL SELECT 'scenarios.exact_four_policies',
   (SELECT count(*)=4 FROM pg_catalog.pg_policy p WHERE p.polrelid=pg_catalog.to_regclass('public.plan_simulations')),
   'Only member read/editor delete and actual-Pro editor INSERT/UPDATE remain'
 UNION ALL SELECT 'scenarios.rls_and_protected_definition_trigger',
   (SELECT c.relrowsecurity AND NOT c.relforcerowsecurity FROM pg_catalog.pg_class c WHERE c.oid=pg_catalog.to_regclass('public.plan_simulations'))
   AND (SELECT count(*)=1 AND bool_and(t.tgenabled='O' AND t.tgtype=23 AND t.tgnargs=0 AND t.tgqual IS NULL
     AND t.tgfoid=pg_catalog.to_regprocedure('private.protect_plan_simulation_definition()'))
    FROM pg_catalog.pg_trigger t WHERE t.tgrelid=pg_catalog.to_regclass('public.plan_simulations') AND t.tgname='plan_simulations_protect_definition' AND NOT t.tgisinternal),
   'RLS enforcement and the original BEFORE INSERT/UPDATE identity/version trigger remain enabled'
 UNION ALL SELECT 'scenarios.policy.'||e.name,
   (SELECT count(*)=1 AND bool_and(p.polcmd::text=e.command AND p.polpermissive
     AND p.polroles=ARRAY[(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='authenticated')]::oid[]
     AND pg_catalog.pg_get_expr(p.polqual,p.polrelid) IS NOT DISTINCT FROM e.using_expression
     AND pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid) IS NOT DISTINCT FROM e.check_expression)
    FROM pg_catalog.pg_policy p WHERE p.polrelid=pg_catalog.to_regclass('public.plan_simulations') AND p.polname=e.name),
   'Exact current-household member/editor predicates; downgrade preserves read/delete while new saves/edits require actual Pro'
 FROM expected_policies e
 UNION ALL SELECT 'canonical.'||signature||'.exact_authorized_transform',
   oid IS NOT NULL AND pg_catalog.md5(prosrc)=body_md5 AND pg_catalog.md5(pg_catalog.pg_get_functiondef(oid))=definition_md5
     AND proowner::regrole::text=owner_name AND proacl::text=acl,
   'Full hosted before-definition plus exact reviewed guard transformation; original owner/security/defaults/search_path/ACL and all remaining financial body preserved'
 FROM canonical
 UNION ALL SELECT 'canonical.'||signature||'.replay_before_new_guard',
   oid IS NOT NULL AND pg_catalog.regexp_count(prosrc,'flo_creation_pro_required')=1
     AND pg_catalog.strpos(prosrc,'private.lock_feature_scope')=0
     AND CASE WHEN signature LIKE 'private.create_flo_entity(%'
       THEN pg_catalog.strpos(prosrc,'return v_existing.receipt;')>0
        AND pg_catalog.strpos(prosrc,'return v_existing.receipt;')<pg_catalog.strpos(prosrc,'flo_creation_pro_required')
       ELSE pg_catalog.strpos(prosrc,'return v_proposal.result;')>0
        AND pg_catalog.strpos(prosrc,'return v_proposal.result;')<pg_catalog.strpos(prosrc,'flo_creation_pro_required') END,
   'Committed receipt/result replay precedes new action eligibility; no lifecycle-inverting plan locks added to financial functions'
 FROM canonical
 UNION ALL SELECT 'safeguard.unchanged.'||e.name,
   (SELECT count(*)=1 AND bool_and(pg_catalog.md5(p.prosrc)=e.body_md5)
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='private' AND p.proname=e.name),
   'Preserve default Free assignment, global Free Review Center/bucket entitlement and scenario identity/version protection'
 FROM expected_unchanged e
 UNION ALL SELECT 'safeguard.review_center_stays_free',
   (SELECT count(*)=1 AND bool_and(free_enabled) FROM private.release_feature_entitlements WHERE feature_key='review_center'),
   'Read only the existing server-owned release configuration, never customer financial records'
 UNION ALL SELECT 'safeguard.plan_is_server_owned',
   NOT pg_catalog.has_table_privilege('authenticated','public.household_plans','INSERT,UPDATE,DELETE,TRUNCATE')
     AND NOT pg_catalog.has_any_column_privilege('authenticated','public.household_plans','INSERT,UPDATE')
     AND NOT pg_catalog.has_table_privilege('anon','public.household_plans','SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),
   'No client promotion or mutation of existing permanent Pro; this migration never rewrites household plan data'
 UNION ALL SELECT 'safeguard.default_plan_trigger',
   (SELECT count(*)=1 AND bool_and(t.tgenabled='O' AND t.tgtype=5 AND t.tgnargs=0 AND t.tgqual IS NULL
     AND t.tgfoid=pg_catalog.to_regprocedure('private.assign_default_household_plan()'))
    FROM pg_catalog.pg_trigger t WHERE t.tgrelid=pg_catalog.to_regclass('public.households') AND t.tgname='assign_default_household_plan' AND NOT t.tgisinternal),
   'New households still receive default Free plans from the original enabled AFTER INSERT trigger'
)
SELECT pg_catalog.jsonb_build_object('projectId','imqmhfdquqlqxgtcdbvc',
 'migrationSha256','19052bed56c99dbb33fc20c48e59737adc17837ab47f89b5a21e89cc2455ee37','backendCommit','06e0459e40f0b647b3bfecc97130e3d17e7029b4',
 'allPassed',bool_and(COALESCE(passed,false)),'checkCount',count(*),
 'failures',COALESCE(jsonb_agg(jsonb_build_object('name',name,'passed',passed,'detail',detail) ORDER BY name) FILTER(WHERE passed IS DISTINCT FROM true),'[]'::jsonb),
 'checks',jsonb_agg(jsonb_build_object('name',name,'passed',COALESCE(passed,false)) ORDER BY name)) AS free_pro_catalog_postflight
FROM checks;
ROLLBACK;
