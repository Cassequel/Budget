# Budget App — Setup & Deployment Guide

## Prerequisites
- Node.js 18+
- A [Neon](https://neon.tech) account (free PostgreSQL)
- A [Plaid](https://dashboard.plaid.com/signup) developer account (free)
- A [Render](https://render.com) account (free backend hosting)
- A [Vercel](https://vercel.com) account (free frontend hosting)

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

## 2. Create the database (Neon)

1. Sign up at https://neon.tech → create a new project
2. Copy the **Connection string** (starts with `postgresql://...`)
3. Save it as `DATABASE_URL`

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

### Backend → Render

1. Push the repo to GitHub
2. Create a new **Web Service** on Render → connect your GitHub repo
3. Set **Root Directory** to `server`
4. Set **Build Command**: `npm install && npm run build`
5. Set **Start Command**: `node dist/index.js`
6. Add all env vars from your `.env` (except `VITE_API_URL` and `CLIENT_URL`)
7. Set `CLIENT_URL` to your Vercel frontend URL (fill in after deploying frontend)
8. Set `PLAID_ENV` to `development` when ready for real accounts

### Frontend → Vercel

1. Import the repo on Vercel → set **Root Directory** to `client`
2. Add env var: `VITE_API_URL=https://your-render-service.onrender.com`
3. Deploy

### Plaid webhooks

After deploying the backend, go to Plaid dashboard → Developers → Webhooks and set:
```
https://your-render-service.onrender.com/api/plaid/webhook
```

---

## 8. Switch to real accounts

1. In Plaid dashboard, request **Development** access (free, instant approval)
2. Update `PLAID_SECRET` to your **Development** secret
3. Set `PLAID_ENV=development`
4. Redeploy the backend
5. Use **Connect Account** in the app to link real bank accounts and Venmo
