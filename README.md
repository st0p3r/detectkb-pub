# DetectKB — Detection Engineering Knowledge Base

A self-hosted web application for learning, documenting, and organizing detection content.

A step-by-step user manual (in Persian, with screenshots) is in [`docs/user-manual`](docs/user-manual/): [PDF](docs/user-manual/DetectKB-User-Manual.pdf) · [Word](docs/user-manual/DetectKB-User-Manual.docx).

## Features
- Wiki-style pages with [[backlinks]] and Markdown editing
- Structured detection rules with MITRE ATT&CK mapping and SPL queries
- **Rule import** from Sigma, Splunk ESCU (`security_content`), Elastic `detection-rules` (TOML) and
  Microsoft Sentinel analytics YAML — single files or a whole cloned repository folder
- **Sigma**: import `.yml` rules (single or multi-document), export one or all rules, and convert
  Sigma to SPL (Splunk), KQL (Defender XDR / Sentinel ASIM), EQL and Lucene (Elastic) via pySigma
- **ATT&CK coverage heatmap** of your rules (ATT&CK Enterprise v19) with per-technique drill-down and
  export as an [ATT&CK Navigator](https://mitre-attack.github.io/attack-navigator/) layer
- **Sysmon ↔ rules ↔ data sources**: each Sysmon event lists the rules and data sources that depend
  on it (e.g. "which rules need Event ID 10?"), inferred from the SPL / Sigma logsource or set manually
- **Log sources beyond Sysmon**: Windows Security / System / PowerShell / Defender events, Sysmon for
  Linux, auditd, EDR (CrowdStrike, Defender XDR, Elastic Defend, SentinelOne) and cloud logs, derived
  from each rule's data sources, Sigma logsource or Sentinel tables. Impact analysis ("what if we
  stop collecting Windows Security 4688?"), the Flows view and the detection chain use all of them
- **Threat groups and software**: ATT&CK groups, malware and tools with the coverage of the
  techniques each one uses (e.g. "how well do we detect APT34?"), highlighted on the ATT&CK matrix
- **Mitigations and D3FEND**: ATT&CK mitigations and D3FEND countermeasures on every technique
- **Splunk analytic stories**: the scenarios ESCU rules belong to, with their rules and techniques
- **Atomic Red Team**: the tests for every technique, the telemetry each should produce and the
  rules expected to fire, with the `Invoke-AtomicTest` line to run it in a lab
- **Attacker tools**: LOLBAS, GTFOBins and LOLDrivers references, each linked to the rules that
  mention the binary, driver file or driver hash
- **Knowledge graph** of pages, wiki links, ATT&CK techniques, telemetry, attacker tools, threat
  groups, software, mitigations and analytic stories
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

To refresh the bundled ATT&CK dataset (techniques, groups, software, mitigations) after a new MITRE release:
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
| JWT_SECRET | — | JWT signing secret (32+ characters). In production a missing, short or example value is replaced by a random secret kept in `BACKUP_DIR/.secrets/jwt-secret` |
| ADMIN_USERNAME / ADMIN_PASSWORD / ADMIN_EMAIL | admin / detectkb | Initial admin, created only when the database has no users |
| DATABASE_URL | — | Backend-only (host dev); built automatically in Docker |
| BACKUP_DIR | ../backups (`/backups` in Docker) | Backup and generated-document directory |
| CORS_ORIGIN | (none) | Origins allowed to call the API cross-origin, comma-separated. Not needed when the UI is served by the bundled nginx |
| SIGMA_SERVICE_URL | http://localhost:8000 (`http://sigma:8000` in Docker) | pySigma conversion service |
| REFERENCE_AUTO_FETCH | true | Download LOLBAS / GTFOBins / LOLDrivers, Atomic Red Team tests and analytic story details on first start |
| D3FEND_FETCH | true | Look up D3FEND countermeasures on d3fend.mitre.org (cached 30 days per technique) |
| PORT | 3001 | Backend port |

## Importing rules

**Detection Rules → Import rules** accepts files or a whole folder. Useful sources:

| Source | Clone | Folder to import |
|---|---|---|
| SigmaHQ | `git clone --depth 1 https://github.com/SigmaHQ/sigma` | `rules/windows/…` |
| Splunk ESCU | `git clone --depth 1 https://github.com/splunk/security_content` | `detections/endpoint` |
| Elastic | `git clone --depth 1 https://github.com/elastic/detection-rules` | `rules/windows` |
| Sentinel | `git clone --depth 1 https://github.com/Azure/Azure-Sentinel` | `Solutions/<solution>/Analytic Rules` |

Imported rules start as **Draft** (a vendor's "production" only means it works on *their* data
model) and keep their original source. Re-importing skips rules with the same source id unless
"update" is ticked.

## Attacker tool references

LOLBAS and GTFOBins are GPL-3.0 and LOLDrivers is Apache-2.0, so their data is **not bundled**:
the backend downloads it from the official APIs on first start (`lolbas.json`, `api.json`,
`drivers.json`). On a server without internet access, download those files elsewhere and use
**Attacker Tools → Upload file**; **Update from source** refreshes them.

## Threat intelligence data

- **ATT&CK groups, software and mitigations** are bundled with the ATT&CK techniques
  (`backend/src/data/attack-cti.json`, from MITRE's STIX bundle; see `update-attack-data.js`).
- **Analytic stories**: ESCU rules name their stories (`analytic_story`), so importing ESCU rules
  creates them. Their descriptions come from the `stories/` folder of `splunk/security_content`:
  downloaded on first start, with **Analytic Stories → Download descriptions**, or uploaded with
  **Upload story files** on an offline server.
- **Atomic Red Team** tests come from `atomics/Indexes/index.yaml` of `redcanaryco/atomic-red-team`:
  downloaded on first start or with **Atomic Red Team → Download from GitHub**; an offline server
  takes the index or the technique files (`atomics/T*/T*.yaml`) through **Upload files**.
  DetectKB does not run tests. For each one it infers the telemetry it should produce (process
  creation, 4104 for PowerShell, and e.g. Sysmon 10 for lsass access, 13 for registry writes, 4698
  for scheduled tasks), always labelled *inferred*, and sorts the rules of the test's technique into:
  *sees its telemetry* (one of the rule's inputs, including AND groups, is among what the test
  produces), *needs the EDR* (the rule reads an EDR product), *other telemetry* and *no telemetry
  links*. A rule tagged with a parent technique counts for its sub-techniques' tests, not the other
  way round. Only running the test in a lab proves that a rule fires. How to build such a lab on
  vSphere (Splunk, Sysmon, Atomic Red Team) and connect it to DetectKB:
  [`docs/lab-setup`](docs/lab-setup/DetectKB-Lab-Setup.pdf) (Persian).
- **D3FEND** countermeasures are looked up on d3fend.mitre.org when a technique is opened and cached
  in the database. Offline servers show a link to the D3FEND page instead (`D3FEND_FETCH=false`
  skips the lookup).
- **Log sources** are derived from the rules themselves (ESCU `data_source`, Elastic
  `Data Source:` tags, Sentinel tables and `EventID` filters, Sigma logsource), recomputed when a
  rule is saved or imported. To steer a hand-written rule, name its telemetry in the rule's
  *Data source* field, e.g. `Windows Event Log Security 4688, Powershell Script Block Logging 4104`.
  `A AND B` means the rule needs both: impact analysis counts it lost when either is gone.

## How far each link can be trusted

Every link carries its basis, shown in the UI and used by **Paths → Certain links only**:

| Basis | Meaning |
|---|---|
| official | MITRE ATT&CK data (group/software/mitigation → technique, sub-technique → parent) |
| declared | Named by the rule itself: its ATT&CK field, data sources, Sentinel tables, Sigma logsource service, analytic story |
| manual | Set by a user (manual Sysmon links, wiki links) |
| inferred | Derived by DetectKB: EventID filters in the query, the Windows audit equivalent of a Sigma category |
| text match | An attacker tool's name found in the rule's text |

**Data Health** (Tools menu) shows how many links of each basis there are and lists what needs
attention: unknown or retired ATT&CK IDs, rules without telemetry or techniques, tool names found
only outside the query, unknown data source names, rules needing several events at once, and more.

## How correctness is checked

`npm test` in `backend/` (also run by CI in `.github/workflows/ci.yml`) verifies, among others:

- the bundled ATT&CK data is internally consistent, and retired technique IDs (e.g. `T1562.001`)
  map to their official replacements;
- the built-in Sysmon reference only cites techniques that exist in the current ATT&CK release;
- the Sigma category → Sysmon event mapping equals the table in the official Sigma taxonomy;
- the importers, the Sysmon inference and the attacker-tool matching behave as expected on
  representative samples (including known false-positive cases).

To check the importers against full upstream repositories (nothing is written to the database):
```bash
cd backend && npm run validate:corpus -- ../security_content/detections ../detection-rules/rules ../sigma/rules
```

What this **cannot** tell you is whether a rule works on *your* logs: index/sourcetype names,
field mappings (CIM, ECS, ASIM), macros such as ESCU's `` `sysmon` ``, and Sysmon configuration
differ per environment. Test each rule against real or emulated activity (e.g. Atomic Red Team,
Splunk `attack_data`, which ESCU rules link to) before promoting it from Draft.

## Users & permissions

Every API endpoint except login and health requires a logged-in user; roles are re-checked on
each request, so role changes and deactivations apply immediately.

| Role | Can |
|---|---|
| viewer | Read pages, rules, tags, docs; convert Sigma; view coverage |
| editor | Everything a viewer can, plus create/edit/delete content, import Sigma, create backups |
| admin | Everything, plus users, audit log, custom page types, restore/delete backups |

The default `admin` / `detectkb` password (and any password set by an admin) must be changed at
first login.

### Security measures

- **Login throttling**: failed logins are counted for 15 minutes: 10 for one user from one IP,
  30 from one IP across all usernames (password spraying), 100 for one user across all IPs.
  nginx overwrites `X-Forwarded-For`, so a client can't fake its IP to get around this.
- **No username probing**: unknown, disabled and existing users get the same answer in the same time.
- **Passwords**: at least 10 characters (at most 72 bytes, the bcrypt limit), not containing the
  username and not one repeated character; stored as bcrypt hashes (cost 12, older hashes upgraded at login).
- **Sessions**: JWTs are HS256-only and last 24 hours. Changing or resetting a password ends every
  other session of that user; deactivating a user ends them immediately.
- **Web headers** (nginx): a Content-Security-Policy that allows scripts only from DetectKB itself,
  plus `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` and `Permissions-Policy`.
- **Content**: Markdown (including the editor preview) is sanitised, and links taken from
  data (rule references, imported datasets) are only rendered when they are `http(s)`.
- **Errors**: unexpected server errors return a generic message; details go to the backend log.

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
| / | Focus the list's search box (rules, pages); elsewhere open search |
| n | New page |
| e | Edit current page / highlighted row |
| j / k | Next / previous row in the rules and pages lists |
| Enter | Rules: preview in the side panel · Pages: open |
| o | Open the highlighted row's page |
| x | Rules: select the highlighted row |
| ? | Show shortcuts |
| Escape | Close modal / preview, then clear the selection |

## Troubleshooting

**`P1000: Authentication failed against database server at mysql`** — MySQL sets
the `MYSQL_USER` / `MYSQL_PASSWORD` from `.env` only when its data volume is first
created. The volume is always `detectkb_mysql_data` (the compose project is named
`detectkb`), whatever folder you run from — so a new `.env` (a fresh clone, a
deleted `.env`) next to an existing database has passwords the database doesn't
know. Either:

- keep the data: restore the `.env` the database was created with (or put its
  `MYSQL_PASSWORD` / `MYSQL_ROOT_PASSWORD` back), then `docker compose up -d`; or
- start empty — **deletes all DetectKB data**: `docker compose down -v && docker compose up -d`
  (or `./install.sh uninstall --purge && ./install.sh`).

`install.sh` refuses to generate a new `.env` while that volume exists, and the
backend stops with this explanation instead of retrying.

## Tech Stack
- Frontend: React 18 + TypeScript + Vite + Tailwind CSS
- Backend: Node.js + Express + TypeScript + Prisma
- Database: MySQL 8
- Containerization: Docker + Docker Compose
