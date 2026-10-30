-- READ ONLY: catalog-only postflight. No customer rows, journal rows, or RPC calls.
-- Project imqmhfdquqlqxgtcdbvc; FlowLedger link_6a503490139c819193052154d4922f3d.
-- Source 501174de671fc02bfd4d364cd1433b51398ab16d.
-- Migration SHA256 6164d30afc55406c61b32f1f05bb0ba555e002612f4b084c98eed73630756fdd.
-- Run only AFTER the exact reviewed migration is applied. allPassed must be true.
-- Expected advisor delta: exactly two deny-all private rls_enabled_no_policy INFO.
WITH
expected_functions(ns,name,args,language_name,security_definer,return_type,volatility,defaults,authenticated_execute,body_md5) AS (
  VALUES
    ('private','recent_change_scope','uuid, uuid, boolean','plpgsql',true,'text','v',0,false,'c9883c89cfa06771640942b147e584cf'),
    ('private','capture_recent_change','','plpgsql',true,'trigger','v',0,false,'6b7f9db5f780786b0973b998871fffb8'),
    ('private','recent_change_fields','text, jsonb, jsonb','sql',false,'text[]','i',0,false,'767306c64c5660a676375a606599a2cd'),
    ('private','recent_change_has_links','text, text, uuid, uuid','plpgsql',true,'boolean','v',0,false,'e4277b4f2c1d4e567bbe0d5633660eb5'),
    ('private','recent_change_reason','private.recent_changes','plpgsql',true,'text','v',0,false,'6cb0a061ee028574b1673874888aa31f'),
    ('private','recent_change_diff','private.recent_changes','plpgsql',false,'jsonb','s',0,false,'077b3e4a570395f044cc2fda8d72ebea'),
    ('private','list_recent_changes','uuid, uuid, bigint, integer','plpgsql',true,'jsonb','v',2,true,'40bb6c321a95242a50cabbef22961ac6'),
    ('public','list_recent_changes','uuid, uuid, bigint, integer','sql',false,'jsonb','v',2,true,'331ad427c825c5265bb9287164d7f898'),
    ('private','undo_recent_change','uuid, uuid, uuid','plpgsql',true,'jsonb','v',0,true,'0d843db8a3cf6540676c8123bce35d01'),
    ('public','undo_recent_change','uuid, uuid, uuid','sql',false,'jsonb','v',0,true,'551aaeedf6cb0a3be9bf042dfbea8008')
),
functions AS (
  SELECT e.*,p.oid,p.prosecdef,p.prorettype,p.provolatile,p.pronargdefaults,
    p.proconfig,p.prosrc,p.proacl,p.proowner,l.lanname,r.rolname AS owner_name
  FROM expected_functions e
  LEFT JOIN pg_catalog.pg_namespace n ON n.nspname=e.ns
  LEFT JOIN pg_catalog.pg_proc p ON p.pronamespace=n.oid AND p.proname=e.name
    AND pg_catalog.oidvectortypes(p.proargtypes)=e.args
  LEFT JOIN pg_catalog.pg_language l ON l.oid=p.prolang
  LEFT JOIN pg_catalog.pg_roles r ON r.oid=p.proowner
),
expected_tables(name) AS (VALUES ('recent_changes'),('recent_change_versions')),
tables AS (
  SELECT e.name,c.oid,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relacl,
    r.rolname AS owner_name
  FROM expected_tables e
  LEFT JOIN pg_catalog.pg_namespace n ON n.nspname='private'
  LEFT JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid AND c.relname=e.name
  LEFT JOIN pg_catalog.pg_roles r ON r.oid=c.relowner
),
expected_indexes(table_name,index_name,definition) AS (VALUES
 ('recent_changes','recent_changes_pkey','CREATE UNIQUE INDEX recent_changes_pkey ON private.recent_changes USING btree (id)'),
 ('recent_changes','recent_changes_sequence_key','CREATE UNIQUE INDEX recent_changes_sequence_key ON private.recent_changes USING btree (sequence)'),
 ('recent_change_versions','recent_change_versions_pkey','CREATE UNIQUE INDEX recent_change_versions_pkey ON private.recent_change_versions USING btree (entity_table, entity_id)'),
 ('recent_changes','recent_changes_scope_page_idx','CREATE INDEX recent_changes_scope_page_idx ON private.recent_changes USING btree (household_id, budget_id, sequence DESC)'),
 ('recent_changes','recent_changes_group_idx','CREATE INDEX recent_changes_group_idx ON private.recent_changes USING btree (group_id)'),
 ('recent_changes','recent_changes_entity_idx','CREATE INDEX recent_changes_entity_idx ON private.recent_changes USING btree (entity_table, entity_id, entity_version DESC)'),
 ('recent_changes','recent_changes_actor_idx','CREATE INDEX recent_changes_actor_idx ON private.recent_changes USING btree (actor_id) WHERE (actor_id IS NOT NULL)'),
 ('recent_changes','recent_changes_undo_actor_idx','CREATE INDEX recent_changes_undo_actor_idx ON private.recent_changes USING btree (undone_by) WHERE (undone_by IS NOT NULL)'),
 ('flo_creation_receipts','flo_creation_receipts_recent_actor_idx','CREATE INDEX flo_creation_receipts_recent_actor_idx ON private.flo_creation_receipts USING btree (actor_id, household_id, budget_id, created_at)')
),
indexes AS (
 SELECT e.*,c.oid,i.indisvalid,i.indisready,pg_catalog.pg_get_indexdef(c.oid) AS actual_definition,
   parent.relname AS actual_table
 FROM expected_indexes e
 LEFT JOIN pg_catalog.pg_namespace n ON n.nspname='private'
 LEFT JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid AND c.relname=e.index_name
 LEFT JOIN pg_catalog.pg_index i ON i.indexrelid=c.oid
 LEFT JOIN pg_catalog.pg_class parent ON parent.oid=i.indrelid
),
triggers AS (
 SELECT t.*,n.nspname AS table_schema,c.relname AS table_name
 FROM pg_catalog.pg_trigger t
 JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE NOT t.tgisinternal AND (t.tgname='recent_changes_capture' OR t.tgfoid IN
   (SELECT oid FROM functions WHERE ns='private' AND name='capture_recent_change'))
),
sequence_metadata AS (
 SELECT c.oid,c.relkind,c.relacl,r.rolname AS owner_name,
   EXISTS(SELECT 1 FROM pg_catalog.pg_depend d
     JOIN pg_catalog.pg_attribute a ON a.attrelid=d.refobjid AND a.attnum=d.refobjsubid
     JOIN pg_catalog.pg_class parent ON parent.oid=a.attrelid
     JOIN pg_catalog.pg_namespace pn ON pn.oid=parent.relnamespace
     WHERE d.classid='pg_catalog.pg_class'::regclass AND d.objid=c.oid
       AND d.refclassid='pg_catalog.pg_class'::regclass AND d.deptype='i'
       AND pn.nspname='private' AND parent.relname='recent_changes'
       AND a.attname='sequence' AND a.attidentity='a') AS correct_identity_dependency
 FROM pg_catalog.pg_class c
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_catalog.pg_roles r ON r.oid=c.relowner
 WHERE n.nspname='private' AND c.relname='recent_changes_sequence_seq'
),
checks(name,passed,detail) AS (
 SELECT 'schema.authenticated_private_usage',pg_catalog.has_schema_privilege('authenticated','private','USAGE'),
   'Invoker wrappers require the existing private schema USAGE grant'::text
 UNION ALL SELECT 'schema.anon_private_usage_denied',NOT pg_catalog.has_schema_privilege('anon','private','USAGE'),
   'Matches baseline; no private schema grant added for anon'
 UNION ALL SELECT 'functions.exact_ten_expected_overloads',
   (SELECT count(*)=10 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE (n.nspname='private' AND p.proname IN ('capture_recent_change','recent_change_scope','recent_change_fields','recent_change_has_links','recent_change_reason','recent_change_diff','list_recent_changes','undo_recent_change'))
      OR (n.nspname='public' AND p.proname IN ('list_recent_changes','undo_recent_change'))),
   'Reject missing or unexpected overloads for all release functions'
 UNION ALL SELECT 'function.'||ns||'.'||name||'.shape',
   oid IS NOT NULL AND prosecdef=security_definer AND lanname=language_name
     AND pg_catalog.format_type(prorettype,NULL)=return_type AND provolatile::text=volatility
     AND pronargdefaults=defaults AND owner_name NOT IN ('anon','authenticated','service_role')
     AND proconfig=ARRAY['search_path=""']::text[],
   'Expected language/security mode/result/default count, non-client owner and empty fixed search_path'
 FROM functions
 UNION ALL SELECT 'function.'||ns||'.'||name||'.exact_reviewed_body',
   oid IS NOT NULL AND pg_catalog.md5(prosrc)=body_md5,
   'Body fingerprint from the exact reviewed local migration; includes SQL invoker wrapper delegation'
 FROM functions
 UNION ALL SELECT 'function.'||ns||'.'||name||'.execute_acl',
   oid IS NOT NULL
     AND pg_catalog.has_function_privilege('authenticated',oid,'EXECUTE')=authenticated_execute
     AND NOT pg_catalog.has_function_privilege('anon',oid,'EXECUTE')
     AND NOT pg_catalog.has_function_privilege('service_role',oid,'EXECUTE')
     AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(proacl,pg_catalog.acldefault('f',proowner))) acl
       WHERE acl.grantee=0 OR (acl.grantee<>proowner AND NOT
         (authenticated_execute AND acl.grantee=(SELECT r.oid FROM pg_catalog.pg_roles r WHERE r.rolname='authenticated')
          AND acl.privilege_type='EXECUTE' AND NOT acl.is_grantable))),
   'Only authenticated may execute the four list/undo entry points; helpers and PUBLIC/anon/service_role denied'
 FROM functions
 UNION ALL SELECT 'table.private.'||name||'.deny_all_rls',
   oid IS NOT NULL AND relkind='r' AND relrowsecurity AND NOT relforcerowsecurity
     AND owner_name NOT IN ('anon','authenticated','service_role')
     AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid=tables.oid),
   'Private, RLS enabled, no policies; server-owned implementation intentionally bypasses owner RLS'
 FROM tables
 UNION ALL SELECT 'table.private.'||name||'.no_direct_client_or_public_grants',
   oid IS NOT NULL AND NOT EXISTS(
     SELECT 1 FROM (VALUES ('anon'),('authenticated'),('service_role')) roles(role_name)
     WHERE pg_catalog.has_table_privilege(roles.role_name,tables.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
        OR pg_catalog.has_any_column_privilege(roles.role_name,tables.oid,'SELECT,INSERT,UPDATE,REFERENCES'))
     AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(relacl) acl WHERE acl.grantee=0)
     AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a,
       LATERAL pg_catalog.aclexplode(a.attacl) acl
       WHERE a.attrelid=tables.oid AND acl.grantee=0),
   'No table-level or column-level access including BYPASSRLS service_role; no PUBLIC grants'
 FROM tables
 UNION ALL SELECT 'sequence.private.recent_changes_sequence_seq.identity',
   (SELECT count(*)=1 AND bool_and(relkind='S' AND correct_identity_dependency
      AND owner_name NOT IN ('anon','authenticated','service_role')) FROM sequence_metadata),
   'Identity ALWAYS sequence owned internally by private.recent_changes.sequence'
 UNION ALL SELECT 'sequence.private.recent_changes_sequence_seq.no_direct_client_or_public_grants',
   (SELECT count(*)=1 AND bool_and(NOT EXISTS(
      SELECT 1 FROM (VALUES ('anon'),('authenticated'),('service_role')) roles(role_name)
      WHERE pg_catalog.has_sequence_privilege(roles.role_name,sequence_metadata.oid,'USAGE,SELECT,UPDATE'))
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(sequence_metadata.relacl) acl WHERE acl.grantee=0))
    FROM sequence_metadata),
   'No sequence usage/read/write for client/service roles or PUBLIC'
 UNION ALL SELECT 'triggers.exactly_four_capture_triggers',
   (SELECT count(*)=4 FROM triggers),
   'No duplicate, missing, or stray capture-function triggers'
 UNION ALL SELECT 'trigger.public.'||expected.table_name||'.capture',
   (SELECT count(*)=1 AND bool_and(t.tgname='recent_changes_capture' AND t.tgenabled='O'
      AND t.tgtype=29 AND t.tgnargs=0 AND t.tgqual IS NULL
      AND NOT t.tgdeferrable AND NOT t.tginitdeferred
      AND t.tgfoid=(SELECT oid FROM functions WHERE ns='private' AND name='capture_recent_change'))
    FROM triggers t WHERE t.table_schema='public' AND t.table_name=expected.table_name),
   'Enabled AFTER INSERT/UPDATE/DELETE FOR EACH ROW, unconditional, expected function'
 FROM (VALUES ('bills'),('incomes'),('goals'),('transactions')) expected(table_name)
 UNION ALL SELECT 'index.private.'||index_name,
   oid IS NOT NULL AND indisvalid AND indisready AND actual_table=table_name AND actual_definition=definition,
   'Exact valid/ready index key order, uniqueness, DESC direction and predicate'
 FROM indexes
)
SELECT pg_catalog.jsonb_build_object(
 'projectId','imqmhfdquqlqxgtcdbvc',
 'sourceCommit','501174de671fc02bfd4d364cd1433b51398ab16d',
 'migrationSha256','6164d30afc55406c61b32f1f05bb0ba555e002612f4b084c98eed73630756fdd',
 'allPassed',bool_and(COALESCE(passed,false)),
 'checkCount',count(*),
 'failures',COALESCE(jsonb_agg(jsonb_build_object('name',name,'passed',passed,'detail',detail) ORDER BY name)
    FILTER (WHERE passed IS DISTINCT FROM true),'[]'::jsonb),
 'checks',jsonb_agg(jsonb_build_object('name',name,'passed',COALESCE(passed,false)) ORDER BY name),
 'schemaUsage',jsonb_build_object(
   'authenticated',pg_catalog.has_schema_privilege('authenticated','private','USAGE'),
   'anon',pg_catalog.has_schema_privilege('anon','private','USAGE'),
   'serviceRole',pg_catalog.has_schema_privilege('service_role','private','USAGE'))
) AS recent_changes_catalog_postflight
FROM checks;
