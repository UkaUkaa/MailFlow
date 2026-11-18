# Docker and deployment

## Services

| Service | Image | Networks | Purpose |
|---|---|---|---|
| `nginx` | `nginxinc/nginx-unprivileged` | web | Only published port. `/api/` → backend, everything else → frontend |
| `frontend` | built from `frontend/` | web | Next.js standalone server |
| `backend` | built from `backend/` | web, data | FastAPI (uvicorn) |
| `celery_worker` | same image as backend | data, egress | Sync and maintenance tasks |
| `celery_beat` | same image as backend | data | Scheduler |
| `migrate` | same image as backend | data | Runs `alembic upgrade head` as the owner role, then exits |
| `postgres` | `postgres:17-alpine` | data | Primary database (volume `pgdata`) |
| `redis` | `redis:7-alpine` | data | Broker, locks, rate limits (volume `redisdata`) |
| `mailpit` | `axllent/mailpit` | data, web | Local mail catcher (not in production) |

`data` is an internal network: PostgreSQL and Redis have no route to or from the host or the
internet. Backend, worker and beat start only after `migrate` completed successfully.

Hardening applied to application containers: non-root user, read-only root filesystem with a
`tmpfs` `/tmp`, all capabilities dropped, `no-new-privileges`, health checks.

## Local stack

```bash
./scripts/generate-env.sh
```

```bash
docker compose up --build
```

Open <http://localhost:8080>. Mail catcher: <http://127.0.0.1:8025>.

## Production

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Requirements:

- `ENVIRONMENT=production`, `APP_BASE_URL=https://your.domain`, `ALLOWED_HOSTS=["your.domain"]`.
  The backend refuses to start in production without an https base URL, vault keys and a real
  encrypted SMTP server (`SMTP_HOST` not empty/`mailpit`/loopback; `SMTP_STARTTLS` or `SMTP_TLS`).
- TLS certificate and key at `infra/nginx/certs/fullchain.pem` and `privkey.pem`
  (for example from certbot); Nginx listens on 443 and redirects 80.
- Real SMTP settings (`SMTP_HOST`, …); Mailpit is disabled by the override.
- Secrets supplied through `.env` with mode 600 or, better, your orchestrator's secret store.
- Backups for `pgdata` (see `DATABASE.md`) and a separate backup of the vault key.

### Auto-deploy from `main`

`.github/workflows/ci.yml` runs every test on each pull request and each push to `main`. When
backend and frontend jobs are both green on `main`, the `deploy` job connects to the server over
SSH and runs `scripts/deploy.sh <sha>` in the checkout: it moves to exactly the tested commit
(`git reset --hard`, so edits to tracked files on the server are lost; `.env`, certificates and
volumes are untouched), runs `docker compose up -d --build` (migrations included), waits for
backend, frontend and nginx to be healthy, then prunes dangling images. A red test means no
deploy; a failed deploy marks the job red and leaves the previous containers where `up` stopped.
Deploys never run in parallel. There is no automatic rollback: revert on `main` to roll back.

One-time setup:

1. On the server: Docker with the compose plugin and git; the repository cloned at the deploy
   path with a working `.env` and certificates; the stack started once by hand; the deploy user
   in the `docker` group.
2. A dedicated key pair: `ssh-keygen -t ed25519 -f ~/.ssh/mailflow_deploy -N ""`, public key in
   the deploy user's `~/.ssh/authorized_keys`.
3. GitHub, Settings → Secrets and variables → Actions:
   - secrets `DEPLOY_SSH_KEY` (the private key) and `DEPLOY_KNOWN_HOSTS`
     (`ssh-keyscan -p <port> <host>`);
   - variables `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PATH`, `DEPLOY_URL`
     (`https://your.domain`, checked for HTTP 200 on `/en/login`) and optional `DEPLOY_PORT`.

The script runs plain `docker compose`, so the server chooses the files with `COMPOSE_FILE` in
its `.env`: unset means `docker-compose.yml` only (a host reverse proxy terminates TLS and forwards
to the bundled Nginx), `COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml` when the bundled
Nginx owns ports 80/443.

Until `DEPLOY_HOST` is set the deploy job is skipped. `scripts/deploy.sh <sha>` can also be run
by hand on the server.

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `APP_BASE_URL` | yes | — | Public URL; used for links, OAuth redirect, CSRF origin check |
| `ALLOWED_HOSTS` | yes | — | JSON list of accepted `Host` values |
| `HTTP_PORT` | no | `8080` | Host port for Nginx (local stack) |
| `ENVIRONMENT` | no | `development` | `development` / `production` |
| `LOG_LEVEL` | no | `INFO` | |
| `API_DOCS_ENABLED` | no | `false` | Serve `/api/docs` in production |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | yes | — | Database and owner (migration) role |
| `MAILFLOW_APP_PASSWORD` | yes | — | Password of the restricted `mailflow_app` role |
| `REDIS_PASSWORD` | yes | — | |
| `VAULT_KEYS` | yes | — | `key_id:base64(32 bytes)` pairs, comma separated |
| `VAULT_PRIMARY_KEY_ID` | no | first key | Key used for new encryption |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | no | empty | Enables Gmail and "Sign in with Google". Register both redirect URIs: `{APP_BASE_URL}/api/v1/accounts/oauth/gmail/callback` and `{APP_BASE_URL}/api/v1/auth/oauth/google/callback` |
| `GOOGLE_REDIRECT_URI` | no | derived | Override of the OAuth redirect URI |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | no | empty | Enables Outlook / Microsoft 365 (Microsoft Graph) |
| `MICROSOFT_TENANT` | no | `common` | `common` (work, school and personal accounts), `organizations`, `consumers` or a tenant id |
| `MICROSOFT_REDIRECT_URI` | no | derived | Override of the OAuth redirect URI (`{APP_BASE_URL}/api/v1/accounts/oauth/outlook/callback`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_STARTTLS`, `SMTP_TLS`, `MAIL_FROM` | prod | Mailpit | System mail |
| `REQUIRE_EMAIL_VERIFICATION` | no | `true` | |
| `SESSION_TTL_HOURS`, `SESSION_IDLE_TIMEOUT_HOURS` | no | 336 / 168 | |
| `SYNC_INTERVAL_SECONDS`, `SYNC_BACKFILL_MAX_MESSAGES`, `CELERY_CONCURRENCY` | no | 120 / 5000 / 4 | |
| `GMAIL_SYNC_UNITS_PER_MINUTE` | no | 3600 | Share of Gmail's 6,000 units/min per-user quota used by background sync |
| `OUTLOOK_SYNC_REQUESTS_PER_MINUTE` | no | 300 | Share of Graph's 10,000 requests per 10 min (per app and mailbox) used by background sync |

| `MAIL_CONNECT_TIMEOUT_SECONDS`, `MAIL_IO_TIMEOUT_SECONDS` | no | 10 / 30 | Timeouts for user-supplied IMAP/SMTP servers. IMAP needs no other configuration |
| `SSRF_ALLOW_PRIVATE_NETWORKS`, `MAIL_TLS_CA_FILE` | never | off | **Test only.** The backend refuses to start with either set unless `ENVIRONMENT=test` |

Backend-only settings with defaults are listed in `backend/app/core/config/__init__.py`.

IMAP/SMTP mailboxes need outbound TCP 993, 143, 465 and 587 from `backend` (connect check and
user actions) and `celery_worker` (synchronization). Both already have a route out (`web` /
`egress`); a host firewall or egress policy must allow those ports.

## Development services (`docker-compose.dev.yml`)

| Service | Host ports (loopback only) | Purpose |
|---|---|---|
| `postgres` | 54329 | Test and development database |
| `redis` | 63799 | |
| `mailpit` | 11025 (SMTP), 18025 (UI) | Catches system mail |
| `greenmail` | 13993 (IMAPS), 13143 (IMAP), 13465 (SMTPS), 13025 (SMTP), 18081 (REST API) | Real IMAP + SMTP server for the IMAP adapter's tests. In-memory, nothing persisted |

```bash
docker compose -f docker-compose.dev.yml up -d
```

`greenmail` (image `greenmail/standalone:2.1.3`) serves the certificate in
`infra/greenmail/greenmail.p12` (SAN `localhost`, `mail.localhost`, `127.0.0.1`; regenerate with
`openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -config infra/greenmail/openssl.cnf …` and
`openssl pkcs12 -export`, keystore password `changeit`). The key is a throwaway committed for
this server only. The tests trust `infra/greenmail/test-ca.pem` and reach loopback through the
two test-only switches above; the service is not part of `docker-compose.yml`.

## Operations

```bash
docker compose ps
```

```bash
docker compose logs -f backend celery_worker
```

Migrations run automatically through the `migrate` service on every `up`. To run them by hand:

```bash
docker compose run --rm migrate
```

Changing `POSTGRES_PASSWORD` / `MAILFLOW_APP_PASSWORD` after the first start requires altering the
roles inside PostgreSQL; the init script only runs on an empty data volume.
