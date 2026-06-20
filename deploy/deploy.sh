#!/usr/bin/env bash
# Build + migrate the app in place. Run from the repo root on the LXC after
# editing .env:  bash deploy/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Installing dependencies"
npm install

echo "==> Building server + client"
npm run build

echo "==> Running database migrations"
npm run db:migrate --workspace=server

echo "==> Done. Start (or restart) the service:"
echo "    sudo systemctl restart budget"
