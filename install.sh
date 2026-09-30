#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# DetectKB — automated installer
#
#   ./install.sh                       # install / start (production, port 80)
#   ./install.sh --port 8080 -y        # non-interactive, custom port
#   ./install.sh --dev                 # development stack (hot reload)
#   ./install.sh update                # dump DB, git pull, rebuild, restart
#   ./install.sh status                # container status + health
#   ./install.sh uninstall [--purge]   # stop stack (--purge also deletes DB data)
#
# One-liner on a fresh server (clones into /opt/detectkb):
#   curl -fsSL https://raw.githubusercontent.com/st0p3r/detectkb-pub/master/install.sh | sudo bash
#
# Run ./install.sh --help for all options.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_URL="${DETECTKB_REPO:-https://github.com/st0p3r/detectkb-pub.git}"
INSTALL_DIR="${DETECTKB_DIR:-/opt/detectkb}"
HEALTH_TIMEOUT=300

COMMAND="install"
MODE=""
HTTP_PORT=""
HTTP_BIND=""
ADMIN_USERNAME=""
ADMIN_PASSWORD=""
ASSUME_YES=0
SKIP_DOCKER_INSTALL=0
PURGE=0

# ── output helpers ──────────────────────────────────────────────────────────
if [ -t 1 ]; then
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'; C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
else
  C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_BOLD=""; C_RESET=""
fi
info()  { echo "${C_BLUE}==>${C_RESET} $*"; }
ok()    { echo "${C_GREEN}✔${C_RESET} $*"; }
warn()  { echo "${C_YELLOW}!${C_RESET} $*" >&2; }
err()   { echo "${C_RED}✖ $*${C_RESET}" >&2; }
die()   { err "$*"; exit 1; }

usage() {
  cat <<EOF
Usage: $0 [command] [options]

Commands:
  install      Install and start DetectKB (default)
  update       Dump the database, pull latest code, rebuild and restart
  status       Show container status and health
  uninstall    Stop and remove containers (keeps data unless --purge)

Options:
  --port N               Host port for the web UI (default 80)
  --bind ADDR            Address to bind the web UI to (default 0.0.0.0)
  --admin-user NAME      Initial admin username (default admin)
  --admin-password PASS  Initial admin password (default: random)
  --dev                  Development stack (Vite on :5173, API on :3001, hot reload)
  --prod                 Production stack (default)
  --dir PATH             Install directory when run outside a checkout (default $INSTALL_DIR)
  --skip-docker-install  Never try to install Docker automatically
  --purge                With 'uninstall': also delete the MySQL data volume
  -y, --yes              Don't ask for confirmation
  -h, --help             Show this help
EOF
}

# ── argument parsing ────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    install|update|status|uninstall) COMMAND="$1" ;;
    --port)            HTTP_PORT="${2:?--port needs a value}"; shift ;;
    --bind)            HTTP_BIND="${2:?--bind needs a value}"; shift ;;
    --admin-user)      ADMIN_USERNAME="${2:?--admin-user needs a value}"; shift ;;
    --admin-password)  ADMIN_PASSWORD="${2:?--admin-password needs a value}"; shift ;;
    --dev)             MODE="dev" ;;
    --prod)            MODE="prod" ;;
    --dir)             INSTALL_DIR="${2:?--dir needs a value}"; shift ;;
    --skip-docker-install) SKIP_DOCKER_INSTALL=1 ;;
    --purge)           PURGE=1 ;;
    -y|--yes)          ASSUME_YES=1 ;;
    -h|--help)         usage; exit 0 ;;
    *) usage; die "Unknown argument: $1" ;;
  esac
  shift
done

if [ -n "$HTTP_PORT" ] && ! [[ "$HTTP_PORT" =~ ^[0-9]+$ && "$HTTP_PORT" -ge 1 && "$HTTP_PORT" -le 65535 ]]; then
  die "Invalid port: $HTTP_PORT"
fi

confirm() {
  [ "$ASSUME_YES" -eq 1 ] && return 0
  # When piped from curl, stdin is the script — read from the terminal instead.
  local reply
  if [ -r /dev/tty ]; then
    read -r -p "$1 [y/N] " reply </dev/tty || return 1
  else
    return 1
  fi
  [[ "$reply" =~ ^[Yy]$ ]]
}

as_root() {
  if [ "$(id -u)" -eq 0 ]; then "$@"
  elif command -v sudo >/dev/null 2>&1; then sudo "$@"
  else die "This step needs root privileges (run as root or install sudo): $*"
  fi
}

gen_secret() {
  ( set +o pipefail; LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1" )
}

# ── locate project ──────────────────────────────────────────────────────────
locate_project() {
  local script_dir=""
  if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  fi

  if [ -n "$script_dir" ] && [ -f "$script_dir/docker-compose.yml" ]; then
    PROJECT_DIR="$script_dir"
  elif [ -f "$INSTALL_DIR/docker-compose.yml" ]; then
    PROJECT_DIR="$INSTALL_DIR"
  else
    [ "$COMMAND" = "install" ] || die "DetectKB is not installed in $INSTALL_DIR"
    command -v git >/dev/null 2>&1 || install_packages git
    info "Cloning $REPO_URL into $INSTALL_DIR"
    as_root mkdir -p "$(dirname "$INSTALL_DIR")"
    as_root git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
    [ "$(id -u)" -eq 0 ] || as_root chown -R "$(id -u):$(id -g)" "$INSTALL_DIR"
    PROJECT_DIR="$INSTALL_DIR"
  fi
  cd "$PROJECT_DIR"
  ENV_FILE="$PROJECT_DIR/.env"
  # docker-compose.yml sets `name: detectkb`, so this is the same from any folder
  DB_VOLUME="detectkb_mysql_data"
}

# ── dependencies ────────────────────────────────────────────────────────────
install_packages() {
  if command -v apt-get >/dev/null 2>&1; then
    as_root apt-get update -qq && as_root apt-get install -y -qq "$@"
  elif command -v dnf >/dev/null 2>&1; then as_root dnf install -y -q "$@"
  elif command -v yum >/dev/null 2>&1; then as_root yum install -y -q "$@"
  elif command -v apk >/dev/null 2>&1; then as_root apk add --no-cache "$@"
  elif command -v pacman >/dev/null 2>&1; then as_root pacman -Sy --noconfirm "$@"
  else die "Could not install '$*': unsupported package manager, please install it manually."
  fi
}

ensure_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    [ "$SKIP_DOCKER_INSTALL" -eq 1 ] && die "Docker is not installed (and --skip-docker-install was given)."
    [ "$(uname -s)" = "Linux" ] || die "Docker is not installed. Install Docker Desktop from https://docs.docker.com/get-docker/ and re-run."
    confirm "Docker is not installed. Install it now using get.docker.com?" \
      || die "Docker is required. Install it from https://docs.docker.com/engine/install/ and re-run."
    command -v curl >/dev/null 2>&1 || install_packages curl
    info "Installing Docker Engine"
    curl -fsSL https://get.docker.com | as_root sh
    if [ "$(id -u)" -ne 0 ]; then
      as_root usermod -aG docker "$USER" || true
      warn "Added $USER to the 'docker' group — log out and back in to use docker without sudo."
    fi
  fi

  if command -v systemctl >/dev/null 2>&1 && ! docker info >/dev/null 2>&1; then
    as_root systemctl enable --now docker >/dev/null 2>&1 || true
  fi

  # Use sudo for docker when the current user can't reach the daemon directly.
  if docker info >/dev/null 2>&1; then DOCKER=(docker)
  elif as_root docker info >/dev/null 2>&1; then DOCKER=(as_root docker)
  else die "Docker is installed but the daemon is not reachable. Start it (e.g. 'sudo systemctl start docker') and re-run."
  fi

  "${DOCKER[@]}" compose version >/dev/null 2>&1 \
    || die "Docker Compose v2 plugin not found. Install 'docker-compose-plugin' (https://docs.docker.com/compose/install/)."
  local v
  v="$("${DOCKER[@]}" compose version --short 2>/dev/null | sed 's/^v//')"
  if [ -n "$v" ] && [ "$(printf '%s\n%s\n' "2.24.4" "$v" | sort -V | head -n1)" != "2.24.4" ]; then
    warn "Docker Compose $v detected; 2.24.4+ is recommended (needed for --dev)."
  fi
  ok "Docker $("${DOCKER[@]}" version --format '{{.Server.Version}}' 2>/dev/null || echo '?') / Compose ${v:-?}"
}

compose() { "${DOCKER[@]}" compose "$@"; }

# ── .env handling ───────────────────────────────────────────────────────────
env_get() {
  [ -f "$ENV_FILE" ] || return 0
  sed -n "s/^$1=\(.*\)$/\1/p" "$ENV_FILE" | tail -n1 | sed 's/[[:space:]]*#.*$//; s/[[:space:]]*$//'
}

env_set() {
  local key="$1" value="$2"
  if grep -q "^$key=" "$ENV_FILE" 2>/dev/null; then
    local tmp; tmp="$(mktemp)"
    awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k {print k "=" v; next} {print}' "$ENV_FILE" >"$tmp"
    cat "$tmp" >"$ENV_FILE"; rm -f "$tmp"
  else
    echo "$key=$value" >>"$ENV_FILE"
  fi
}

write_env() {
  if [ -f "$ENV_FILE" ]; then
    info "Using existing .env (secrets are kept)"
    if [ -n "$ADMIN_USERNAME$ADMIN_PASSWORD" ] && [ -n "$(env_get ADMIN_USERNAME)" ]; then
      warn "--admin-user/--admin-password only apply on first start (empty database)."
    fi
  else
    # MySQL applies MYSQL_USER / MYSQL_PASSWORD only when its volume is first
    # created. A database left by an earlier install (the volume is named after
    # the compose project, not this folder) would reject new random passwords.
    if "${DOCKER[@]}" volume inspect "$DB_VOLUME" >/dev/null 2>&1; then
      err "A DetectKB database already exists (Docker volume '$DB_VOLUME'), but there is no .env here."
      err "Its passwords are in the .env of the earlier install; new random ones would not match."
      echo "  Either:" >&2
      echo "    - copy the .env from the earlier install (or from a backup) to $ENV_FILE and run '$0' again, or" >&2
      echo "    - start with an empty database — this DELETES all DetectKB data:" >&2
      echo "        docker volume rm $DB_VOLUME   (with sudo if needed), then run '$0' again" >&2
      exit 1
    fi
    info "Generating .env with random secrets"
    GENERATED_ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(gen_secret 16)}"
    umask 077
    cat >"$ENV_FILE" <<EOF
# Generated by install.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ) — keep this file private.
HTTP_PORT=${HTTP_PORT:-80}
HTTP_BIND=${HTTP_BIND:-0.0.0.0}

MYSQL_ROOT_PASSWORD=$(gen_secret 32)
MYSQL_DATABASE=detectkb
MYSQL_USER=detectkb
MYSQL_PASSWORD=$(gen_secret 32)
MYSQL_PORT=3306

NODE_ENV=production
JWT_SECRET=$(gen_secret 64)

ADMIN_USERNAME=${ADMIN_USERNAME:-admin}
ADMIN_PASSWORD=${GENERATED_ADMIN_PASSWORD}
ADMIN_EMAIL=admin@detectkb.local
EOF
    umask 022
  fi

  [ -n "$HTTP_PORT" ] && env_set HTTP_PORT "$HTTP_PORT"
  [ -n "$HTTP_BIND" ] && env_set HTTP_BIND "$HTTP_BIND"

  # COMPOSE_FILE in .env makes plain `docker compose ...` pick the right stack.
  if [ "$MODE" = "dev" ]; then
    env_set COMPOSE_FILE "docker-compose.yml:docker-compose.dev.yml"
  elif [ "$MODE" = "prod" ] && grep -q '^COMPOSE_FILE=' "$ENV_FILE"; then
    sed -i.bak '/^COMPOSE_FILE=/d' "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  fi
  chmod 600 "$ENV_FILE"
}

current_mode() {
  case "$(env_get COMPOSE_FILE)" in *docker-compose.dev.yml*) echo dev ;; *) echo prod ;; esac
}

check_port_free() {
  local port="$1"
  # Our own frontend already holding the port is fine (re-run / update).
  if "${DOCKER[@]}" ps --format '{{.Names}} {{.Ports}}' 2>/dev/null | grep -q "^detectkb-frontend .*:$port->"; then
    return 0
  fi
  if command -v ss >/dev/null 2>&1 && ss -ltnH "sport = :$port" 2>/dev/null | grep -q .; then
    die "Port $port is already in use. Choose another with --port N."
  fi
}

wait_healthy() {
  info "Waiting for the backend to become healthy (up to ${HEALTH_TIMEOUT}s)..."
  local waited=0 status
  while [ "$waited" -lt "$HEALTH_TIMEOUT" ]; do
    status="$("${DOCKER[@]}" inspect --format '{{.State.Health.Status}}' detectkb-backend 2>/dev/null || echo missing)"
    case "$status" in
      healthy) ok "Backend is healthy"; return 0 ;;
      unhealthy) break ;;
    esac
    sleep 5; waited=$((waited + 5))
  done
  compose logs --tail 40 backend >&2 || true
  die "Backend did not become healthy (status: $status). See logs above or run: docker compose logs backend"
}

print_summary() {
  local mode port bind host url
  mode="$(current_mode)"
  port="$(env_get HTTP_PORT)"; port="${port:-80}"
  bind="$(env_get HTTP_BIND)"; bind="${bind:-0.0.0.0}"
  if [ "$bind" = "0.0.0.0" ]; then
    host="$(hostname -I 2>/dev/null | awk '{print $1}')"; host="${host:-localhost}"
  else
    host="$bind"
  fi
  if [ "$mode" = "dev" ]; then url="http://localhost:5173"
  elif [ "$port" = "80" ]; then url="http://$host"
  else url="http://$host:$port"
  fi

  echo
  echo "${C_BOLD}${C_GREEN}DetectKB is running!${C_RESET}"
  echo "  URL:       $url"
  echo "  Mode:      $mode"
  echo "  Directory: $PROJECT_DIR"
  if [ -n "${GENERATED_ADMIN_PASSWORD:-}" ]; then
    echo "  Username:  $(env_get ADMIN_USERNAME)"
    echo "  Password:  $GENERATED_ADMIN_PASSWORD"
    echo "  ${C_YELLOW}Save this password now and change it after first login (it is also in .env).${C_RESET}"
  fi
  echo
  echo "  Logs:      cd $PROJECT_DIR && docker compose logs -f"
  echo "  Update:    $PROJECT_DIR/install.sh update"
  echo "  Stop:      cd $PROJECT_DIR && docker compose down"
}

dump_database() {
  if [ "$("${DOCKER[@]}" inspect --format '{{.State.Running}}' detectkb-mysql 2>/dev/null)" != "true" ]; then
    warn "MySQL container is not running — skipping pre-update database dump."
    return 0
  fi
  mkdir -p backups
  local file
  file="backups/pre-update-$(date +%Y%m%d-%H%M%S).sql"
  info "Dumping database to $file"
  # shellcheck disable=SC2016  # expanded inside the container
  "${DOCKER[@]}" exec detectkb-mysql sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction "$MYSQL_DATABASE"' >"$file" \
    || die "Database dump failed; aborting update."
  chmod 600 "$file"
  ok "Database dumped ($(du -h "$file" | cut -f1))"
}

# ── commands ────────────────────────────────────────────────────────────────
cmd_install() {
  ensure_docker
  write_env
  [ "$(current_mode)" = "prod" ] && check_port_free "$(env_get HTTP_PORT)"
  mkdir -p backups
  info "Building and starting containers (first build can take a few minutes)"
  compose up -d --build --remove-orphans
  wait_healthy
  print_summary
}

cmd_update() {
  ensure_docker
  [ -f "$ENV_FILE" ] || die "No .env found — run '$0 install' first."
  dump_database
  if [ -d .git ]; then
    info "Pulling latest code"
    git pull --ff-only || die "git pull failed (local changes?). Resolve it and re-run."
  else
    warn "Not a git checkout — rebuilding current files only."
  fi
  write_env
  compose up -d --build --remove-orphans
  wait_healthy
  "${DOCKER[@]}" image prune -f >/dev/null 2>&1 || true
  print_summary
}

cmd_status() {
  ensure_docker
  compose ps
  echo
  echo "Backend health: $("${DOCKER[@]}" inspect --format '{{.State.Health.Status}}' detectkb-backend 2>/dev/null || echo 'not running')"
}

cmd_uninstall() {
  ensure_docker
  if [ "$PURGE" -eq 1 ]; then
    confirm "This deletes ALL DetectKB data (MySQL volume). Continue?" || die "Aborted."
    compose down -v --remove-orphans
    ok "Containers and database volume removed. Files in ./backups and .env were kept."
  else
    compose down --remove-orphans
    ok "Containers removed. Data is kept — run '$0 install' to start again."
  fi
}

locate_project
case "$COMMAND" in
  install)   cmd_install ;;
  update)    cmd_update ;;
  status)    cmd_status ;;
  uninstall) cmd_uninstall ;;
esac
