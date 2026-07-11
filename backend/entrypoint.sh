#!/bin/sh
set -e

echo "Waiting for MySQL to be ready..."
until npx prisma db push --accept-data-loss 2>/dev/null; do
  echo "Database not ready, retrying in 3s..."
  sleep 3
done

echo "Database schema synced."
exec npm run dev
