#!/usr/bin/env bash
# Uses a new disposable, network-isolated local PostgreSQL container only.
set -euo pipefail
fixture_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_dir=$(cd -- "$fixture_dir/../../.." && pwd)
container_name="flowledger-account-forecast-tests-$$"
logs_dir=$(mktemp -d /tmp/flowledger-account-forecast-tests.XXXXXX)
docker_local=(env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock)
if ! "${docker_local[@]}" image inspect postgres:17-alpine >/dev/null 2>&1; then
  echo 'Cache the official postgres:17-alpine image locally before running this test.' >&2
  exit 1
fi
cleanup() { "${docker_local[@]}" rm -f "$container_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
"${docker_local[@]}" run -d --name "$container_name" --network none \
  -e POSTGRES_HOST_AUTH_METHOD=trust --tmpfs /var/lib/postgresql/data \
  postgres:17-alpine -c listen_addresses='' > "$logs_dir/container.log"
ready=false
for attempt in {1..60}; do
  if "${docker_local[@]}" exec "$container_name" pg_isready -U postgres >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
if [[ "$ready" != true ]]; then echo "Local PostgreSQL did not start. Logs: $logs_dir" >&2; exit 1; fi
pg=("${docker_local[@]}" exec -i "$container_name" psql -U postgres -v ON_ERROR_STOP=1)
"${pg[@]}" -c 'CREATE DATABASE account_forecast_fixture;' > "$logs_dir/setup.log"
if ! "${pg[@]}" -d account_forecast_fixture < "$fixture_dir/fixture.sql" > "$logs_dir/fixture.log" 2>&1 \
  || ! "${pg[@]}" -d account_forecast_fixture < "$repo_dir/supabase/migrations/20261111155130_account_forecasts_and_savings_apy.sql" > "$logs_dir/migration.log" 2>&1 \
  || ! "${pg[@]}" -d account_forecast_fixture < "$fixture_dir/test.sql" > "$logs_dir/test.log" 2>&1; then
  echo "Account forecast database tests failed. Logs: $logs_dir" >&2
  exit 1
fi
if ! rg -q 'ACCOUNT FORECAST DATABASE TESTS COMPLETE' "$logs_dir/test.log"; then
  echo "Test completion marker missing. Logs: $logs_dir" >&2
  exit 1
fi
echo "Account forecast database tests passed. Logs: $logs_dir"
