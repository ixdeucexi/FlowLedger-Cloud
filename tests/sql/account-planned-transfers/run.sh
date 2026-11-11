#!/usr/bin/env bash
# Fake records in fresh, network-isolated PostgreSQL17; no hosted access.
set -euo pipefail
mode=${1:-full}
if [[ "$mode" != full && "$mode" != --catalog-only ]]; then echo "Usage: $0 [--catalog-only]" >&2; exit 2; fi
fixture_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_dir=$(cd -- "$fixture_dir/../../.." && pwd)
container_name="flowledger-planned-transfer-tests-$$"
logs_dir=$(mktemp -d /tmp/flowledger-planned-transfer-tests.XXXXXX)
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
 || ! "${pg[@]}" < "$fixture_dir/catalog.sql" > "$logs_dir/catalog.log" 2>&1; then
 echo "Planned transfer SQL tests failed: $logs_dir" >&2; exit 1
fi
if [[ "$mode" == --catalog-only ]]; then
 echo "Planned transfer catalog checks passed (3 focused FK/index checks). Logs: $logs_dir"
 exit 0
fi
if ! "${pg[@]}" < "$fixture_dir/test.sql" > "$logs_dir/test.log" 2>&1; then
 echo "Planned transfer SQL tests failed: $logs_dir" >&2; exit 1
fi
python3 "$fixture_dir/concurrency.py" "$container_name" "$logs_dir"
if ! rg -q 'PLANNED TRANSFER DATABASE TESTS COMPLETE' "$logs_dir/test.log"; then echo "Completion marker missing: $logs_dir" >&2; exit 1; fi
checks=$(rg -c 'NOTICE:  PASS' "$logs_dir/test.log")
echo "Planned transfer SQL tests passed ($checks SQL checks plus concurrent sessions). Logs: $logs_dir"
