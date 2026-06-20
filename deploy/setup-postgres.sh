#!/usr/bin/env bash
# Creates the "budget" Postgres role + database to match DATABASE_URL in .env.
# Run as a user that can sudo to the postgres role:  sudo bash deploy/setup-postgres.sh
set -euo pipefail

# Must match the password in your .env DATABASE_URL.
DB_PASSWORD="LN7KB1qok3s4Dn8uX-FBse76"
DB_USER="budget"
DB_NAME="budget"

sudo -u postgres psql <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';
  END IF;
END
\$\$;
SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\gexec
SQL

echo "Postgres role '${DB_USER}' and database '${DB_NAME}' are ready."
