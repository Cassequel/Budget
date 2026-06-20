# Homelab Deployment — Proxmox LXC + self-hosted Postgres + Cloudflare Tunnel

This deploys the budget app as a **single Node process** (Express serves both the API
and the built React client) inside a **new Proxmox LXC** (suggested **CT 102 @
192.168.86.102**), backed by a **local Postgres**, and exposed at
**`budget.aidenswanson.com`** by adding a hostname to the **existing cloudflared**
already running on CT 101. Plaid runs in **production** so you can link your real
Mountain America account.

```
Internet ──HTTPS──> Cloudflare edge ──> cloudflared (CT 101) ──> 192.168.86.102:3001
                                                                   (Express: API + SPA)
                                                                        └──> Postgres @ localhost:5432 (in the LXC)
```

> This LXC is intentionally separate from your Docker stacks — it does **not** use
> Portainer or Docker. It updates via `git pull` + systemd restart (step 7), not
> `docker compose`. The only shared piece is your existing Cloudflare Tunnel.

---

## 0. Set your real values in `.env`

`.env` (repo root) is already filled in except for the lines marked `CHANGE-ME`:

| Var | What to set |
|-----|-------------|
| `ADMIN_PASSWORD` | Your app login. Replace `8080` — use a long passphrase. |
| `PLAID_SECRET` | Your Plaid **Production** secret (dashboard → Developers → Keys). |
| `PLAID_WEBHOOK_URL` | already set to `https://budget.aidenswanson.com/api/plaid/webhook` |
| `CLIENT_URL` | already set to `https://budget.aidenswanson.com` |

`JWT_SECRET`, `ENCRYPTION_KEY`, `PLAID_CLIENT_ID`, and the DB password are already set.
> ⚠️ Don't change `ENCRYPTION_KEY` after you've linked accounts — it decrypts stored
> Plaid tokens. Re-linking is the only recovery.

---

## 1. Create the LXC (on the Proxmox host)

Create a new container — suggested **CT 102**, static IP **192.168.86.102** on your
`192.168.86.x` subnet (next free slot after Pi-hole `.100` and Docker `.101`). A Debian
12 / Ubuntu 22.04 container, 1–2 vCPU, 1 GB RAM, 8 GB disk is plenty. Add a DHCP
reservation for `.102` on your router like you planned for `.100`/`.101`.

Inside the container, install the runtime:

```bash
apt update && apt install -y curl git postgresql
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
```

## 2. Postgres

Postgres was installed above. Create the role + database that match `DATABASE_URL`:

```bash
git clone <your-repo-url> /opt/budget   # or copy the project to /opt/budget
cd /opt/budget
sudo bash deploy/setup-postgres.sh
```

This creates role `budget` / database `budget` with the password baked into your
`.env`. (A LAN-only Postgres needs no TLS, so `DATABASE_SSL=false`.)

## 3. Build + migrate

Copy your filled-in `.env` to `/opt/budget/.env`, then:

```bash
cd /opt/budget
bash deploy/deploy.sh
```

This runs `npm install`, builds the server (`server/dist`) and client (`client/dist`),
and applies the database migrations.

## 4. Run it as a service

```bash
# Create a dedicated user that owns the app dir (optional but tidy)
useradd --system --home /opt/budget budget || true
chown -R budget:budget /opt/budget

cp deploy/budget.service /etc/systemd/system/budget.service
systemctl daemon-reload
systemctl enable --now budget
systemctl status budget        # should be "active (running)"
curl -s localhost:3001/api/health   # -> {"ok":true}
```

The service runs `node server/dist/index.js` from `/opt/budget`; Express serves the
client from `client/dist` on the same origin, so there's no separate frontend host.

## 5. Expose it via your EXISTING Cloudflare Tunnel

You already run a `cloudflared` container on CT 101 (in the media-pipeline stack)
serving `watch.aidenswanson.com`. **Don't create a new tunnel** — just add a second
public hostname, `budget.aidenswanson.com`, pointing at this LXC.

First find out how that tunnel is configured. Look at the cloudflared service in
`/opt/media-pipeline/docker-compose.yml` on CT 101:

- **If it uses a `TUNNEL_TOKEN` env var** → the tunnel is **dashboard-managed** (most
  common). Use option A.
- **If it mounts a `config.yml` / credentials file and runs `tunnel run`** → it's
  **config-file managed**. Use option B.

### Option A — dashboard-managed (TUNNEL_TOKEN)

No SSH or file edits needed. In the Cloudflare **Zero Trust** dashboard:

1. **Networks → Tunnels** → open the tunnel that serves `watch.aidenswanson.com`.
2. **Public Hostname → Add a public hostname.**
3. Subdomain `budget`, domain `aidenswanson.com`.
4. Service: **HTTP** → `192.168.86.102:3001`.
5. Save. DNS is created automatically.

> The cloudflared container on CT 101 must be able to reach `192.168.86.102:3001` over
> the LAN. If it can already reach other `192.168.86.x` hosts, you're set.

### Option B — config-file managed (config.yml)

Add an ingress rule **above** the catch-all to the existing config (see
`deploy/cloudflared-config.example.yml` for the exact snippet), create the DNS route,
and restart the cloudflared container:

```bash
# on CT 101
cloudflared tunnel route dns <existing-tunnel-name> budget.aidenswanson.com
# edit the mounted config.yml to add the budget.aidenswanson.com ingress rule, then:
cd /opt/media-pipeline && docker compose restart cloudflared
```

### Verify

From anywhere: `https://budget.aidenswanson.com` should show the login page. Sign in
with `ADMIN_PASSWORD`.

## 6. Point Plaid at the webhook

In the Plaid dashboard → **Developers → Webhooks**, set:

```
https://budget.aidenswanson.com/api/plaid/webhook
```

(Same value as `PLAID_WEBHOOK_URL`.) This is what enables live transaction pushes.

## 7. Link your Mountain America account

In the app, go to **Accounts → Connect Account**. Plaid Link opens; search for
**Mountain America Credit Union**, log in with your MACU credentials *inside Plaid's
window* (the app never sees them), and authorize. Venmo links the same way.

---

## Updating later

```bash
cd /opt/budget && git pull && bash deploy/deploy.sh && sudo systemctl restart budget
```

## Troubleshooting

- **`systemctl status budget` shows a FATAL missing-env error** — a required var is
  blank in `.env`. Check `DATABASE_URL`, `JWT_SECRET`, `ADMIN_PASSWORD`, `ENCRYPTION_KEY`.
- **DB connection refused** — confirm Postgres is listening on `localhost:5432`
  (`sudo -u postgres psql -c '\conninfo'`) and the password matches `DATABASE_URL`.
- **Plaid Link won't open / blank** — make sure you're on `https://` (the tunnel
  hostname), not the raw LAN IP; production Plaid requires HTTPS.
- **`logs`** — `journalctl -u budget -f` (app) and `journalctl -u cloudflared -f` (tunnel).
