#!/bin/sh
# Syncs the Prisma schema to MySQL, then starts the API.
#   NODE_ENV=production  -> refuses destructive schema changes, runs compiled dist/
#   otherwise            -> allows data loss on schema change, runs ts-node-dev (hot reload)
set -e

if [ "$NODE_ENV" = "production" ]; then
  PUSH_ARGS="--skip-generate"
else
  PUSH_ARGS="--accept-data-loss"
fi

attempt=1
max_attempts=${DB_WAIT_ATTEMPTS:-20}
echo "Syncing database schema..."
until output=$(npx prisma db push $PUSH_ARGS 2>&1); do
  echo "$output"
  # A wrong password won't fix itself: explain instead of retrying
  if echo "$output" | grep -q "P1000"; then
    cat >&2 <<'EOF'

MySQL rejected the DetectKB user's password (Prisma P1000).
MySQL sets MYSQL_USER / MYSQL_PASSWORD only when its data volume is first
created; the database was most likely created with other credentials than
the ones in the current .env (e.g. a new .env next to an old database).
  - Keep the data: put the MYSQL_PASSWORD / MYSQL_ROOT_PASSWORD the database
    was created with back into .env, then: docker compose up -d
  - Start empty (DELETES all DetectKB data):
      docker compose down -v && docker compose up -d
    or: ./install.sh uninstall --purge && ./install.sh
EOF
    exit 1
  fi
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "Database schema sync failed after $attempt attempts, giving up." >&2
    exit 1
  fi
  echo "Database not ready (attempt $attempt/$max_attempts), retrying in 3s..."
  attempt=$((attempt + 1))
  sleep 3
done
echo "$output"
echo "Database schema synced."

if [ "$NODE_ENV" = "production" ]; then
  exec node dist/index.js
else
  exec npm run dev
fi
