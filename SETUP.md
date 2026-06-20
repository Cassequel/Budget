# Budget App — Local Setup Guide

> **Deploying to the homelab?** This file covers running locally for development.
> For the Proxmox LXC + self-hosted Postgres + Cloudflare Tunnel production deploy,
> see **[HOMELAB-DEPLOY.md](HOMELAB-DEPLOY.md)**.

## Prerequisites
- Node.js 18+
- PostgreSQL (local install, Docker, or a hosted DB)
- A [Plaid](https://dashboard.plaid.com/signup) developer account (free)

---

## 1. Generate secrets

Open a terminal and run these two commands — save the output:

```bash
# JWT secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Encryption key (for Plaid access tokens)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 2. Create the database

Use any PostgreSQL instance. For local dev, create a database and set
`DATABASE_URL=postgresql://user:password@localhost:5432/budget` (with
`DATABASE_SSL=false` for a local DB). For the homelab, the
[setup script](deploy/setup-postgres.sh) creates the role + database for you.

---

## 3. Get Plaid credentials

1. Sign up at https://dashboard.plaid.com/signup
2. Create a new app
3. Copy **Client ID** and **Secret** (use **Sandbox** key for now)
4. To connect real accounts later: go to Team → Request Development access (free, up to 100 accounts)

**Note on Venmo**: Venmo can be linked through Plaid Link just like a bank — select it from the institution list.

---

## 4. Set up environment variables

Copy `.env.example` to `.env` in the root and fill in:

```bash
cp .env.example .env
```

Then edit `.env`:
```
DATABASE_URL=postgresql://...      # from Neon
JWT_SECRET=<first hex string>
JWT_EXPIRES_IN=7d
ADMIN_PASSWORD=<your password>
PLAID_CLIENT_ID=<from Plaid>
PLAID_SECRET=<from Plaid sandbox>
PLAID_ENV=sandbox
ENCRYPTION_KEY=<second hex string>
PORT=3001
CLIENT_URL=http://localhost:5173
VITE_API_URL=
```

---

## 5. Run database migrations

```bash
npm run db:generate --workspace=server
npm run db:migrate --workspace=server
```

---

## 6. Run locally

```bash
npm run dev
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3001

Sign in with the password you set in `ADMIN_PASSWORD`.  
Click **Connect Account** on the Accounts page to link a bank (or Venmo) via Plaid.

---

## 7. Deploy to production

The production deploy (Proxmox LXC, self-hosted Postgres, Cloudflare Tunnel, Plaid
production) is documented in **[HOMELAB-DEPLOY.md](HOMELAB-DEPLOY.md)**. In production
the Express server also serves the built client, so there's no separate frontend host.
