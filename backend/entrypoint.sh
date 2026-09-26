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
until npx prisma db push $PUSH_ARGS; do
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "Database schema sync failed after $attempt attempts, giving up." >&2
    exit 1
  fi
  echo "Database not ready (attempt $attempt/$max_attempts), retrying in 3s..."
  attempt=$((attempt + 1))
  sleep 3
done
echo "Database schema synced."

if [ "$NODE_ENV" = "production" ]; then
  exec node dist/index.js
else
  exec npm run dev
fi
