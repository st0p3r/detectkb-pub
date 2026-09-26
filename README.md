# DetectKB — Detection Engineering Knowledge Base

A self-hosted web application for learning, documenting, and organizing detection content.

## Features
- Wiki-style pages with [[backlinks]] and Markdown editing
- Structured detection rules with MITRE ATT&CK mapping and SPL queries
- **Sigma**: import `.yml` rules (single or multi-document), export one or all rules, and convert
  Sigma to SPL (Splunk), KQL (Defender XDR / Sentinel ASIM), EQL and Lucene (Elastic) via pySigma
- **ATT&CK coverage heatmap** of your rules (ATT&CK Enterprise v19) with per-technique drill-down and
  export as an [ATT&CK Navigator](https://mitre-attack.github.io/attack-navigator/) layer
- **Sysmon ↔ rules ↔ data sources**: each Sysmon event lists the rules and data sources that depend
  on it (e.g. "which rules need Event ID 10?"), inferred from the SPL / Sigma logsource or set manually
- Role-based access (admin / editor / viewer) enforced by the API
- SPL command cheat-sheet library with searchable cards
- Global search (Cmd+K) across all content
- Tag and category organization
- JSON backup and restore
- Dark mode, keyboard shortcuts, collapsible sidebar

## Installation (recommended)

The installer sets up Docker if needed, generates `.env` with random secrets,
builds the images, starts the stack and waits until it is healthy.

```bash
git clone https://github.com/st0p3r/detectkb-pub.git && cd detectkb-pub
./install.sh                 # production stack on port 80
./install.sh --port 8080 -y  # custom port, no prompts
```

Or on a fresh Linux server (clones into `/opt/detectkb`):
```bash
curl -fsSL https://raw.githubusercontent.com/st0p3r/detectkb-pub/master/install.sh | sudo bash
```

The generated admin password is printed at the end (and stored in `.env`).

| Command | Description |
|---|---|
| `./install.sh` | Install / start (re-running is safe; existing `.env` is kept) |
| `./install.sh update` | Dump the DB to `backups/`, `git pull`, rebuild, restart |
| `./install.sh status` | Container status and backend health |
| `./install.sh uninstall` | Remove containers, keep data (`--purge` also deletes the DB volume) |
| `./install.sh --dev` | Development stack with hot reload |

Run `./install.sh --help` for all options (`--bind`, `--admin-user`, `--admin-password`, ...).

## Manual Docker setup

```bash
cp .env.example .env         # then edit the secrets
docker compose up -d --build # http://localhost
```

- `docker-compose.yml` — production stack: MySQL, compiled API, nginx-served frontend.
  Only the web port (`HTTP_PORT`, default 80) is published; `/api` is proxied to the backend.
- `docker-compose.dev.yml` — development override: API runs with ts-node-dev and the
  frontend with Vite (http://localhost:5173), both with the source mounted.
  ```bash
  docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
  ```
  (`./install.sh --dev` sets `COMPOSE_FILE` in `.env` so plain `docker compose` uses both files.)

## Local development without Docker

Requires Node.js 20+, a MySQL 8 server and (for Sigma conversion) Python 3.11+.

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d mysql   # optional: MySQL on :3306
cp backend/.env.example backend/.env
cd backend && npm install && npx prisma db push && npm run dev     # API on :3001
cd frontend && npm install && npm run dev                          # UI on :5173
cd sigma && python -m venv .venv && .venv/bin/pip install -r requirements.txt \
  && .venv/bin/uvicorn app:app --port 8000                         # Sigma service on :8000
```

The Sigma service is optional: without it Sigma import/export still works, only query
conversion is unavailable.

To refresh the bundled ATT&CK dataset after a new MITRE release:
```bash
cd backend && node scripts/update-attack-data.js
```

The database schema is managed with `prisma db push` (there are no migration files).

## Environment Variables

Docker settings live in the root `.env` (see `.env.example`); `backend/.env` is only used
when running the backend directly on the host.

| Variable | Default | Description |
|---|---|---|
| HTTP_PORT | 80 | Host port for the web UI |
| HTTP_BIND | 0.0.0.0 | Bind address for the web UI (use 127.0.0.1 behind another reverse proxy) |
| MYSQL_ROOT_PASSWORD / MYSQL_PASSWORD | — | MySQL credentials (URL-safe characters only) |
| MYSQL_DATABASE / MYSQL_USER | detectkb | MySQL database and user |
| NODE_ENV | production | `production` refuses destructive schema changes on start |
| JWT_SECRET | insecure dev default | JWT signing secret — **always set in production** |
| ADMIN_USERNAME / ADMIN_PASSWORD / ADMIN_EMAIL | admin / detectkb | Initial admin, created only when the database has no users |
| DATABASE_URL | — | Backend-only (host dev); built automatically in Docker |
| BACKUP_DIR | ../backups (`/backups` in Docker) | Backup and generated-document directory |
| CORS_ORIGIN | * | Allowed CORS origin for the API |
| SIGMA_SERVICE_URL | http://localhost:8000 (`http://sigma:8000` in Docker) | pySigma conversion service |
| PORT | 3001 | Backend port |

## Users & permissions

Every API endpoint except login and health requires a logged-in user; roles are re-checked on
each request, so role changes and deactivations apply immediately.

| Role | Can |
|---|---|
| viewer | Read pages, rules, tags, docs; convert Sigma; view coverage |
| editor | Everything a viewer can, plus create/edit/delete content, import Sigma, create backups |
| admin | Everything, plus users, audit log, custom page types, restore/delete backups |

The default `admin` / `detectkb` password (and any password set by an admin) must be changed at
first login. After 10 failed logins for the same user from one IP, login is blocked for 15 minutes.

## Backup & Restore
- Click "Backup Now" in the Backups section to export a JSON snapshot
- An automatic JSON backup runs every 24 hours while the backend is up
- Backups are stored in `./backups` on the host and require login to list or download
- To restore: upload a JSON backup file in the Backups section
- Manual MySQL dump (also done automatically by `./install.sh update`):
  ```bash
  docker exec detectkb-mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" detectkb' > backup.sql
  ```

## Keyboard Shortcuts
| Key | Action |
|---|---|
| Cmd/Ctrl+K | Open search |
| n | New page |
| e | Edit current page |
| ? | Show shortcuts |
| Escape | Close modal |

## Tech Stack
- Frontend: React 18 + TypeScript + Vite + Tailwind CSS
- Backend: Node.js + Express + TypeScript + Prisma
- Database: MySQL 8
- Containerization: Docker + Docker Compose
