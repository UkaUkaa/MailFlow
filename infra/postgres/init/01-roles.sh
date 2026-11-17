#!/bin/sh
# Creates the restricted application role (no table ownership, no BYPASSRLS) and the test database.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mailflow_app') THEN
    CREATE ROLE mailflow_app LOGIN PASSWORD '${MAILFLOW_APP_PASSWORD}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
\$\$;
GRANT CONNECT ON DATABASE "$POSTGRES_DB" TO mailflow_app;
SQL
if [ "${MAILFLOW_CREATE_TEST_DB:-true}" = "true" ]; then
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "CREATE DATABASE mailflow_test OWNER \"$POSTGRES_USER\"" || true
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "GRANT CONNECT ON DATABASE mailflow_test TO mailflow_app"
fi
