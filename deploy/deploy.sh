#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

release=$(cd -- "$(dirname -- "$0")" && pwd)
root=$(cd -- "$release/../.." && pwd)
sha=${1:?Usage: bash deploy.sh COMMIT_SHA}
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid commit SHA' >&2; exit 1; }
test -s "$root/.env"
export APP_ENV_FILE="$root/.env"
export APP_IMAGE="car-city:$sha"
compose=(docker compose --project-name car-city --env-file "$root/.env" -f "$release/compose.yml")
# Prevent simultaneous manual/CI deployments on this host.
exec 9>"$root/deploy.lock"
flock -n 9 || { echo 'Another deployment is running' >&2; exit 1; }
"${compose[@]}" config --quiet
docker load -i "$release/image.tar"
"${compose[@]}" up -d --wait --wait-timeout 120 postgres

# Abort before migrations if a consistent database backup cannot be made.
mkdir -p "$root/backups"
backup="$root/backups/$(date -u +%Y%m%dT%H%M%SZ)-$sha.dump"
"${compose[@]}" exec -T postgres pg_dump -U tasks -d tasks -Fc > "$backup.tmp"
mv -- "$backup.tmp" "$backup"
# Docker creates new volumes owned by root; the app runs as uid 1000.
"${compose[@]}" run --rm --no-deps --user root --entrypoint sh app \
  -c 'mkdir -p /app/apps/server/storage && chown 1000:1000 /app/apps/server/storage'
if ! "${compose[@]}" up -d --wait --wait-timeout 240; then
  echo 'Deployment failed. Backup retained; inspect docker compose logs. No automatic DB rollback.' >&2
  exit 1
fi
# /api/health checks the process; additionally verify a real authenticated DB connection.
"${compose[@]}" exec -T app node --input-type=module -e \
  'import pg from "pg"; const c=new pg.Client({connectionString:process.env.DATABASE_URL}); await c.connect(); await c.query("SELECT 1"); await c.end()'
printf '%s\n' "$sha" > "$root/current-release"
rm -- "$release/image.tar"
echo "Deployed $sha. Database backup: $backup"
