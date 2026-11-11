#!/usr/bin/env bash
# Fake records in a fresh network-isolated PostgreSQL 17 container only.
set -euo pipefail
fixture_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_dir=$(cd -- "$fixture_dir/../../.." && pwd)
container_name="flowledger-account-flow-tests-$$"
logs_dir=$(mktemp -d /tmp/flowledger-account-flow-tests.XXXXXX)
docker_local=(env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock)
if ! "${docker_local[@]}" image inspect postgres:17-alpine >/dev/null 2>&1; then
  echo 'Cache the official postgres:17-alpine image locally before running.' >&2
  exit 1
fi
cleanup() { "${docker_local[@]}" rm -f "$container_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
"${docker_local[@]}" run -d --name "$container_name" --network none -e POSTGRES_HOST_AUTH_METHOD=trust \
  --tmpfs /var/lib/postgresql/data postgres:17-alpine -c listen_addresses='' > "$logs_dir/container.log"
ready=false
for attempt in {1..60}; do
  if "${docker_local[@]}" exec "$container_name" pg_isready -U postgres >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
if [[ "$ready" != true ]]; then echo "Local PostgreSQL startup failed: $logs_dir" >&2; exit 1; fi
pg=("${docker_local[@]}" exec -i "$container_name" psql -U postgres -v ON_ERROR_STOP=1 -d postgres)
# A separate database reruns the prior financial contracts with the new name
# triggers installed. Its mutations cannot affect this feature's fake setup.
"${pg[@]}" -c 'create database legacy_financial_regression;' > "$logs_dir/legacy-setup.log" 2>&1
legacy_pg=("${docker_local[@]}" exec -i "$container_name" psql -U postgres -v ON_ERROR_STOP=1 -d legacy_financial_regression)
if ! "${legacy_pg[@]}" < "$repo_dir/tests/sql/account-forecasts/fixture.sql" > "$logs_dir/legacy-fixture.log" 2>&1 \
  || ! "${legacy_pg[@]}" < "$repo_dir/supabase/migrations/20261111155130_account_forecasts_and_savings_apy.sql" > "$logs_dir/legacy-base-migration.log" 2>&1 \
  || ! "${legacy_pg[@]}" < "$repo_dir/supabase/migrations/20261111172633_account_flow_names_and_assignment_setup.sql" > "$logs_dir/legacy-new-migration.log" 2>&1 \
  || ! "${legacy_pg[@]}" < "$repo_dir/tests/sql/account-forecasts/test.sql" > "$logs_dir/legacy-financial-test.log" 2>&1; then
  echo "Legacy financial regression failed: $logs_dir" >&2; exit 1
fi
python3 "$fixture_dir/expand-fixture.py" "$fixture_dir/fixture.sql" > "$logs_dir/expanded-fixture.sql"
if ! "${pg[@]}" < "$logs_dir/expanded-fixture.sql" > "$logs_dir/fixture.log" 2>&1; then
  echo "Fixture failed: $logs_dir" >&2; exit 1
fi
if ! "${pg[@]}" < "$repo_dir/supabase/migrations/20261111172633_account_flow_names_and_assignment_setup.sql" > "$logs_dir/migration.log" 2>&1 \
  || ! "${pg[@]}" < "$fixture_dir/test.sql" > "$logs_dir/test.log" 2>&1; then
  echo "Account flow database tests failed. Logs: $logs_dir" >&2; exit 1
fi
"$fixture_dir/concurrency.sh" "$container_name" "$logs_dir"
if ! rg -q 'ACCOUNT FLOW DATABASE TESTS COMPLETE' "$logs_dir/test.log"; then echo "Completion marker missing: $logs_dir" >&2; exit 1; fi
checks=$(rg -c 'NOTICE:  PASS' "$logs_dir/test.log")
legacy_checks=$(rg -c 'NOTICE:  PASS' "$logs_dir/legacy-financial-test.log")
echo "Account flow database tests passed ($checks new SQL checks, $legacy_checks legacy financial checks, plus concurrency cases). Logs: $logs_dir"
