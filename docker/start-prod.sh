#!/bin/sh
set -eu

python3 -c "from services.v1.database.db_service import init_db; init_db(); print('init_db_ok')"

cd /app/ui
exec npx next start -H 0.0.0.0 -p "${PORT:-3000}"
