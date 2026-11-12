#!/usr/bin/env bash
# Fake records in fresh, network-isolated PostgreSQL17; no hosted access.
set -euo pipefail
mode=${1:-full}
if [[ "$mode" != full && "$mode" != --catalog-only ]]; then echo "Usage: $0 [--catalog-only]" >&2; exit 2; fi
fixture_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_dir=$(cd -- "$fixture_dir/../../.." && pwd)
container_name="flowledger-bill-conversion-tests-$$"
logs_dir=$(mktemp -d /tmp/flowledger-bill-conversion-tests.XXXXXX)
sha256sum "$repo_dir/supabase/migrations/20261112144704_bill_account_transfer_conversion.sql" > "$logs_dir/migration-sha256.txt"
docker_local=(env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock)
"${docker_local[@]}" image inspect postgres:17-alpine >/dev/null
cleanup() { "${docker_local[@]}" rm -f "$container_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
"${docker_local[@]}" run -d --name "$container_name" --network none -e POSTGRES_HOST_AUTH_METHOD=trust --tmpfs /var/lib/postgresql/data postgres:17-alpine -c listen_addresses='' > "$logs_dir/container.log"
ready=false
for attempt in {1..60}; do
 if "${docker_local[@]}" exec "$container_name" pg_isready -U postgres >/dev/null 2>&1; then ready=true; break; fi
 sleep 1
done
if [[ "$ready" != true ]]; then echo "PostgreSQL startup failed: $logs_dir" >&2; exit 1; fi
pg=("${docker_local[@]}" exec -i "$container_name" psql -U postgres -v ON_ERROR_STOP=1 -d postgres)
python3 "$repo_dir/tests/sql/account-flow-repair/expand-fixture.py" "$fixture_dir/fixture.sql" > "$logs_dir/expanded-fixture.sql"
if ! "${pg[@]}" < "$logs_dir/expanded-fixture.sql" > "$logs_dir/fixture.log" 2>&1 \
 || ! "${pg[@]}" < "$repo_dir/supabase/migrations/20261111194401_planned_account_transfers.sql" > "$logs_dir/migration.log" 2>&1 \
 || ! "${pg[@]}" < "$repo_dir/supabase/migrations/20261111203004_planned_transfer_occurrence_scope_index.sql" > "$logs_dir/scope-index-migration.log" 2>&1 \
 || ! "${pg[@]}" < "$repo_dir/supabase/migrations/20261112144704_bill_account_transfer_conversion.sql" > "$logs_dir/conversion-migration.log" 2>&1 \
 || ! "${pg[@]}" < "$fixture_dir/catalog.sql" > "$logs_dir/catalog.log" 2>&1; then
 echo "Bill conversion SQL tests failed: $logs_dir" >&2; exit 1
fi
# Paired baseline/current proof of existing raw funded-parent deletion limits.
"${pg[@]}" -c 'create database baseline_parent_probe' > "$logs_dir/baseline-create.log" 2>&1
pg_baseline=("${docker_local[@]}" exec -i "$container_name" psql -U postgres -v ON_ERROR_STOP=1 -d baseline_parent_probe)
"${pg_baseline[@]}" < "$logs_dir/expanded-fixture.sql" > "$logs_dir/baseline-fixture.log" 2>&1
"${pg_baseline[@]}" < "$repo_dir/supabase/migrations/20261111194401_planned_account_transfers.sql" > "$logs_dir/baseline-plans.log" 2>&1
"${pg_baseline[@]}" < "$fixture_dir/baseline-parent-probe.sql" > "$logs_dir/baseline-parent-probe.log" 2>&1
"${pg[@]}" < "$fixture_dir/baseline-parent-probe.sql" > "$logs_dir/current-parent-probe.log" 2>&1
python3 - "$logs_dir" <<'PYPROOF'
import json,pathlib,sys
p=pathlib.Path(sys.argv[1]);a=[x for x in (p/'baseline-parent-probe.log').read_text().splitlines() if 'PARENT_PROBE' in x];b=[x for x in (p/'current-parent-probe.log').read_text().splitlines() if 'PARENT_PROBE' in x];assert a==b and len(a)==2,(a,b);assert any('Household edit access required' in x for x in a)
(p/'parent-baseline-proof.json').write_text(json.dumps({'status':'UNCHANGED_BASELINE_LIMIT','baselineWithoutNewMigration':a,'currentWithConvertedSource':b,'actualPreparePathTestedSeparately':True},indent=2)+'\n')
PYPROOF

if [[ "$mode" == --catalog-only ]]; then
 echo "Bill conversion catalog checks passed (5 focused schema/security checks). Logs: $logs_dir"
 exit 0
fi
if ! "${pg[@]}" < "$repo_dir/tests/sql/account-planned-transfers/test.sql" > "$logs_dir/planned-transfer-regression.log" 2>&1 \
 || ! "${pg[@]}" < "$fixture_dir/test.sql" > "$logs_dir/test.log" 2>&1; then
 echo "Bill conversion SQL tests failed: $logs_dir" >&2; exit 1
fi
if ! "${pg[@]}" < "$fixture_dir/c2-scope-test.sql" > "$logs_dir/c2-scope.log" 2>&1; then echo "Bill conversion C2 scope tests failed: $logs_dir" >&2; exit 1; fi
if ! "${pg[@]}" < "$fixture_dir/c2-restoration-test.sql" > "$logs_dir/c2-restoration.log" 2>&1; then echo "Bill conversion C2 restoration tests failed: $logs_dir" >&2; exit 1; fi
if ! "${pg[@]}" < "$fixture_dir/lifecycle-test.sql" > "$logs_dir/lifecycle.log" 2>&1; then echo "Bill conversion lifecycle tests failed: $logs_dir" >&2; exit 1; fi
python3 "$repo_dir/tests/sql/account-planned-transfers/concurrency.py" "$container_name" "$logs_dir"
python3 "$fixture_dir/concurrency.py" "$container_name" "$logs_dir"
if ! rg -q 'BILL CONVERSION DATABASE TESTS COMPLETE' "$logs_dir/test.log"; then echo "Completion marker missing: $logs_dir" >&2; exit 1; fi
sha256sum --check "$logs_dir/migration-sha256.txt" > "$logs_dir/source-hash-guard.log"
checks=$(rg -c 'NOTICE:  PASS' "$logs_dir/test.log")
scope_checks=$(rg -c 'NOTICE:  PASS' "$logs_dir/c2-scope.log")
restore_checks=$(rg -c 'NOTICE:  PASS' "$logs_dir/c2-restoration.log")
lifecycle_checks=$(rg -c 'NOTICE:  PASS' "$logs_dir/lifecycle.log")
regression_checks=$(rg -c 'NOTICE:  PASS' "$logs_dir/planned-transfer-regression.log")
echo "Bill conversion SQL tests passed ($checks conversion +$scope_checks C2scope +$restore_checks C2restore +$lifecycle_checks lifecycle +$regression_checks existing-plan SQL checks, 7+10 concurrent cases). Logs: $logs_dir"
