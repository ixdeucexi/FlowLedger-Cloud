#!/usr/bin/env bash
# Network-isolated fictional PostgreSQL fixture. Never accesses a hosted database.
set -euo pipefail
fixture_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_dir=$(cd -- "$fixture_dir/../../.." && pwd)
container_name="flowledger-household-name-tests-$$"
logs_dir=$(mktemp -d /tmp/flowledger-household-name-tests.XXXXXX)
docker_local=(env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock)
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
sha256sum "$repo_dir/supabase/migrations/20261112190614_rename_household.sql" > "$logs_dir/migration-sha256.txt"
"${pg[@]}" < "$fixture_dir/fixture.sql" > "$logs_dir/fixture.log" 2>&1
"${pg[@]}" < "$repo_dir/supabase/migrations/20261112190614_rename_household.sql" > "$logs_dir/migration.log" 2>&1
"${pg[@]}" < "$fixture_dir/test.sql" > "$logs_dir/test.log" 2>&1
python3 "$fixture_dir/concurrency.py" "$container_name" "$logs_dir"
rg -q 'HOUSEHOLD NAME TESTS COMPLETE' "$logs_dir/test.log"
checks=$(rg -c 'NOTICE:  PASS' "$logs_dir/test.log")
echo "Household rename SQL tests passed ($checks SQL checks plus concurrent cases). Logs: $logs_dir"
