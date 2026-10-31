#!/usr/bin/env bash
# Publish or roll back one Node release under /opt/keduoduo-crm.
# This is the ECS entry for CI. It does not call baota-update and it does not
# write shared/.env. Run it on the server as root (or with passwordless sudo).
# Website lead ingress settings live in backend/.data/private, which is not in
# the tarball. Publish points that path at shared/private and, when shared is
# empty, copies the two existing files from the current release. It does not
# create a key and it does not print the files.
# After publish or rollback succeeds, old directories under releases/ are
# removed. The three newest release ids stay. The directory current points at
# and the previous release stay even when they are older. shared/ is left
# alone. Cleanup errors are warnings and do not undo the activation.
# ssh-activate-release.sh is the remote entry; it runs this script, so the
# same cleanup applies on that path.
set -Eeuo pipefail

APP_ROOT="${APP_ROOT:-/opt/keduoduo-crm}"
APP_USER="${APP_USER:-keduoduo-crm}"
SERVICE_NAME="${SERVICE_NAME:-keduoduo-crm}"
BACKEND_PORT="${BACKEND_PORT:-4188}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${BACKEND_PORT}/api/health}"
NGINX_HEALTH_URL="${NGINX_HEALTH_URL:-http://127.0.0.1/api/health}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-30}"
HEALTH_SLEEP_SECONDS="${HEALTH_SLEEP_SECONDS:-2}"
SKIP_MIGRATE="${SKIP_MIGRATE:-false}"
SKIP_NPM_CI="${SKIP_NPM_CI:-false}"
# Newest release directory names kept after a successful activate.
# current and the previous release are kept in addition to this count.
RELEASE_KEEP_COUNT=3

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CURRENT_LINK="${APP_ROOT}/current"
RELEASES_DIR="${APP_ROOT}/releases"
ENV_FILE="${APP_ROOT}/shared/.env"
SHARED_PRIVATE="${APP_ROOT}/shared/private"
INGRESS_SETTINGS="website-lead-ingress.enc.json"
INGRESS_KEY="website-lead-ingress.key"

SWITCHED=false
CREATED=false
PREVIOUS=""
RELEASE_DIR=""
UNPACK_DIR=""
NPM_HOME=""

log() {
  printf '%s\n' "$*"
}

warn() {
  printf 'warning: %s\n' "$*" >&2
}

restore_previous() {
  if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
    log "restoring current -> ${PREVIOUS}"
    ln -sfn "$PREVIOUS" "$CURRENT_LINK"
    restart_service || true
  elif [[ "$SWITCHED" == true ]]; then
    log "removing current; there was no previous release"
    rm -f -- "$CURRENT_LINK"
    stop_service || true
  fi
  SWITCHED=false
}

fail() {
  trap - ERR
  printf 'error: %s\n' "$*" >&2
  if [[ -n "$UNPACK_DIR" && -d "$UNPACK_DIR" ]]; then
    rm -rf -- "$UNPACK_DIR" || true
    UNPACK_DIR=""
  fi
  if [[ "$SWITCHED" == true ]]; then
    restore_previous || true
  elif [[ "$CREATED" == true && -n "$RELEASE_DIR" && -d "$RELEASE_DIR" ]]; then
    log "removing incomplete release ${RELEASE_DIR}"
    rm -rf -- "$RELEASE_DIR" || true
  fi
  exit 1
}

on_err() {
  local line="${1:-unknown}"
  fail "command failed at line ${line}"
}
trap 'on_err "$LINENO"' ERR

validate_release_id() {
  local rid="${1:-}"
  [[ "$rid" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$ ]]
}

refuse_foreign_root() {
  case "$APP_ROOT" in
    *..*) fail "APP_ROOT must not contain .." ;;
    /opt/keduoduocrm|/opt/keduoduocrm/*)
      fail "refusing ${APP_ROOT}; that tree is not this host's Node release layout"
      ;;
  esac
}

as_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  elif [[ "${NODE_RELEASE_NO_SUDO:-}" == "1" ]]; then
    "$@"
  else
    sudo -n -- "$@"
  fi
}

as_user() {
  if [[ "$(id -un)" == "$APP_USER" ]]; then
    "$@"
  else
    as_root runuser -u "$APP_USER" -- "$@"
  fi
}

restart_service() {
  local unit="${SERVICE_NAME}.service"
  if [[ -n "${RESTART_COMMAND:-}" ]]; then
    bash -c "$RESTART_COMMAND"
    return
  fi
  if ! as_root systemctl cat "$unit" >/dev/null 2>&1; then
    cat >&2 <<EOF
systemd unit ${unit} was not found.
Expected the unit installed by deploy-ubuntu.sh:
  User=${APP_USER}
  WorkingDirectory=${APP_ROOT}/current
  ExecStart=/usr/bin/node ${APP_ROOT}/current/backend/dist/server.js
Refusing to guess another process manager.
Set SERVICE_NAME to the real unit, or RESTART_COMMAND to an explicit restart command.
EOF
    return 1
  fi
  as_root systemctl restart "$unit"
}

stop_service() {
  if [[ -n "${RESTART_COMMAND:-}" ]]; then
    return 0
  fi
  as_root systemctl stop "${SERVICE_NAME}.service" || true
}

require_layout() {
  refuse_foreign_root
  [[ -d "$APP_ROOT" ]] || fail "APP_ROOT does not exist: ${APP_ROOT}"
  [[ -d "$RELEASES_DIR" ]] || fail "missing ${RELEASES_DIR}"
  id "$APP_USER" >/dev/null 2>&1 || fail "runtime user does not exist: ${APP_USER}"
  [[ -f "$ENV_FILE" ]] || fail "missing ${ENV_FILE}; refusing to create secrets"
  [[ "$HEALTH_ATTEMPTS" =~ ^[0-9]+$ ]] || fail "HEALTH_ATTEMPTS must be a number"
  [[ "$HEALTH_SLEEP_SECONDS" =~ ^[0-9]+$ ]] || fail "HEALTH_SLEEP_SECONDS must be a number"
}

verify_tree() {
  local root="$1"
  local rel
  for rel in \
    package.json \
    package-lock.json \
    backend/package.json \
    backend/dist/server.js \
    backend/dist/migrate-mysql.js \
    frontend/package.json \
    frontend/dist/index.html \
    integration-sdk/package.json \
    integration-sdk/dist/index.js \
    integration-worker/package.json \
    keduoduo-runner/package.json
  do
    [[ -e "$root/$rel" ]] || fail "release tree missing ${rel}"
  done
  [[ -d "$root/agent-skills" ]] || fail "release tree missing agent-skills"
  [[ -d "$root/agent-knowledge" ]] || fail "release tree missing agent-knowledge"
}

require_installed_modules() {
  local root="$1"
  if [[ ! -e "$root/node_modules/express" && ! -e "$root/backend/node_modules/express" ]]; then
    fail "release is missing node_modules/express: ${root}"
  fi
}

link_shared_env() {
  local release_dir="$1"
  [[ -f "$ENV_FILE" ]] || fail "missing ${ENV_FILE}; refusing to create secrets"
  if [[ -e "$release_dir/.env" && ! -L "$release_dir/.env" ]]; then
    fail "refusing to replace regular file ${release_dir}/.env"
  fi
  ln -sfn "$ENV_FILE" "$release_dir/.env"
  local linked target
  linked="$(readlink -f "$release_dir/.env")"
  target="$(readlink -f "$ENV_FILE")"
  [[ "$linked" == "$target" ]] || fail ".env symlink does not point at shared/.env"
}

shared_private_ready() {
  [[ -f "$SHARED_PRIVATE/$INGRESS_SETTINGS" && -f "$SHARED_PRIVATE/$INGRESS_KEY" ]]
}

# The process resolves backend/.data/private from the real release path, not
# from current/. A new release does not contain that directory, so production
# validation sees an empty store and exits. Reuse the store the running
# release already has. Never generate a key here.
link_shared_private() {
  local release_dir="$1"
  local previous="" source="" group="" stage="" parent="" dest="" linked="" target=""
  if [[ -e "$SHARED_PRIVATE/$INGRESS_SETTINGS" || -e "$SHARED_PRIVATE/$INGRESS_KEY" ]]; then
    shared_private_ready || fail "shared/private ingress store is incomplete"
  elif [[ -L "$CURRENT_LINK" ]]; then
    previous="$(readlink -f "$CURRENT_LINK" || true)"
    if [[ -n "$previous" ]]; then
      source="${previous}/backend/.data/private"
    fi
    if [[ -n "$source" && -f "$source/$INGRESS_SETTINGS" && -f "$source/$INGRESS_KEY" ]]; then
      group="$(id -gn "$APP_USER")"
      stage="$(mktemp -d "${APP_ROOT}/shared/.private-seed.XXXXXX")"
      if ! as_root cp -L -- "$source/$INGRESS_SETTINGS" "$source/$INGRESS_KEY" "$stage/"; then
        rm -rf -- "$stage"
        fail "could not copy the current ingress store into shared/private"
      fi
      as_root chown "$APP_USER:$group" "$stage/$INGRESS_SETTINGS" "$stage/$INGRESS_KEY"
      as_root chmod 600 "$stage/$INGRESS_SETTINGS" "$stage/$INGRESS_KEY"
      if [[ -e "$SHARED_PRIVATE" && ! -d "$SHARED_PRIVATE" ]]; then
        rm -rf -- "$stage"
        fail "shared/private exists but is not a directory"
      fi
      if [[ -d "$SHARED_PRIVATE" ]]; then
        if [[ -n "$(find "$SHARED_PRIVATE" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
          rm -rf -- "$stage"
          fail "shared/private exists but has no ingress store"
        fi
        as_root mv -- "$stage/$INGRESS_SETTINGS" "$stage/$INGRESS_KEY" "$SHARED_PRIVATE/"
        rm -rf -- "$stage"
      else
        as_root mv "$stage" "$SHARED_PRIVATE"
      fi
      as_root chown "$APP_USER:$group" "$SHARED_PRIVATE"
      as_root chmod 700 "$SHARED_PRIVATE"
      stage=""
    fi
  fi
  shared_private_ready || return 0
  parent="${release_dir}/backend/.data"
  dest="${parent}/private"
  if [[ -e "$dest" && ! -L "$dest" ]]; then
    fail "refusing to replace regular path ${dest}"
  fi
  group="$(id -gn "$APP_USER")"
  as_root install -d -o "$APP_USER" -g "$group" -m 0700 "$parent"
  ln -sfn "$SHARED_PRIVATE" "$dest"
  linked="$(readlink -f "$dest/$INGRESS_SETTINGS")"
  target="$(readlink -f "$SHARED_PRIVATE/$INGRESS_SETTINGS")"
  [[ -n "$linked" && "$linked" == "$target" ]] || fail "private settings symlink does not point at shared/private"
}

chown_release() {
  local group
  group="$(id -gn "$APP_USER")"
  as_root chown -R "$APP_USER:$group" "$RELEASE_DIR"
}

chmod_frontend() {
  chmod 755 "$RELEASE_DIR" "$RELEASE_DIR/frontend" "$RELEASE_DIR/frontend/dist"
  find "$RELEASE_DIR/frontend/dist" -type d -exec chmod 755 {} +
  find "$RELEASE_DIR/frontend/dist" -type f -exec chmod 644 {} +
}

prepare_npm_home() {
  NPM_HOME="/var/lib/${APP_USER}"
  if [[ -d "$NPM_HOME" ]]; then
    return
  fi
  NPM_HOME="${APP_ROOT}/shared/.npm-home"
  local group
  group="$(id -gn "$APP_USER")"
  as_root install -d -o "$APP_USER" -g "$group" -m 0700 "$NPM_HOME"
}

npm_ci_release() {
  if [[ "$SKIP_NPM_CI" == "true" ]]; then
    log "SKIP_NPM_CI=true"
    return
  fi
  command -v npm >/dev/null 2>&1 || fail "npm is not installed on the server"
  command -v node >/dev/null 2>&1 || fail "node is not installed on the server"
  prepare_npm_home
  as_user env HOME="$NPM_HOME" NODE_ENV=production \
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund --prefix "$RELEASE_DIR"
  [[ -e "$RELEASE_DIR/node_modules/express" ]] || fail "npm ci did not install express"
  [[ -e "$RELEASE_DIR/node_modules/@keduoduo/integration-connector-sdk" ]] \
    || fail "npm ci did not install @keduoduo/integration-connector-sdk"
}

migrate_release() {
  if [[ "$SKIP_MIGRATE" == "true" ]]; then
    log "SKIP_MIGRATE=true"
    return
  fi
  local helper="${SCRIPT_DIR}/migrate-with-shared-env.mjs"
  [[ -f "$helper" ]] || fail "missing ${helper}"
  command -v node >/dev/null 2>&1 || fail "node is not installed on the server"
  prepare_npm_home
  as_user env HOME="$NPM_HOME" node "$helper" "$RELEASE_DIR"
}

switch_current() {
  if [[ -e "$CURRENT_LINK" && ! -L "$CURRENT_LINK" ]]; then
    fail "${CURRENT_LINK} exists and is not a symlink"
  fi
  if [[ -L "$CURRENT_LINK" ]]; then
    PREVIOUS="$(readlink -f "$CURRENT_LINK" || true)"
  fi
  ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"
  SWITCHED=true
  log "current -> ${RELEASE_DIR}"
}

health_once() {
  local url="$1"
  local body
  body="$(curl -fsS --max-time 5 "$url" 2>/dev/null || true)"
  [[ -n "$body" ]] || return 1
  grep -Eq '"ok"[[:space:]]*:[[:space:]]*true([^A-Za-z0-9_]|$)' <<<"$body" || return 1
  printf '%s\n' "$body"
}

wait_for_health() {
  local attempt url body
  for ((attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt++)); do
    for url in "$HEALTH_URL" "$NGINX_HEALTH_URL"; do
      [[ -n "$url" ]] || continue
      if body="$(health_once "$url")"; then
        log "health ok via ${url}"
        log "$body"
        return 0
      fi
    done
    if (( attempt < HEALTH_ATTEMPTS )); then
      sleep "$HEALTH_SLEEP_SECONDS"
    fi
  done
  return 1
}

reload_nginx() {
  command -v nginx >/dev/null 2>&1 || return 0
  as_root nginx -t || return 1
  if as_root systemctl cat nginx.service >/dev/null 2>&1; then
    as_root systemctl reload nginx
  else
    as_root nginx -s reload
  fi
}

# True when candidate is a real directory directly under releases/.
# Empty paths, "..", symlinks, shared/, and anything that resolves elsewhere
# are not removable.
release_dir_is_removable() {
  local candidate="${1:-}"
  local base="" app_real="" releases_real="" resolved="" shared_real=""

  [[ -n "$candidate" && -n "${APP_ROOT:-}" && -n "${RELEASES_DIR:-}" ]] || return 1
  [[ "$candidate" != *..* && "$APP_ROOT" != *..* && "$RELEASES_DIR" != *..* ]] || return 1
  [[ -L "$APP_ROOT" || -L "$RELEASES_DIR" ]] && return 1
  [[ -d "$APP_ROOT" && -d "$RELEASES_DIR" ]] || return 1
  [[ -L "$candidate" ]] && return 1
  [[ -d "$candidate" ]] || return 1

  base="$(basename -- "$candidate")"
  [[ -n "$base" && "$base" != "." && "$base" != ".." && "$base" != *"/"* ]] || return 1
  validate_release_id "$base" || return 1

  app_real="$(readlink -f -- "$APP_ROOT" 2>/dev/null || true)"
  releases_real="$(readlink -f -- "$RELEASES_DIR" 2>/dev/null || true)"
  resolved="$(readlink -f -- "$candidate" 2>/dev/null || true)"
  [[ -n "$app_real" && -n "$releases_real" && -n "$resolved" ]] || return 1
  [[ "$releases_real" == "$app_real/releases" ]] || return 1
  [[ "$resolved" == "$releases_real/$base" ]] || return 1
  [[ "$resolved" != "$releases_real" && "$resolved" != "$app_real" ]] || return 1

  shared_real="$(readlink -f -- "$app_real/shared" 2>/dev/null || true)"
  if [[ -n "$shared_real" ]]; then
    [[ "$resolved" != "$shared_real" && "$resolved" != "$shared_real"/* ]] || return 1
  fi
  [[ "$resolved" != "$app_real/shared" && "$resolved" != "$app_real/shared"/* ]] || return 1
  return 0
}

# Rank release ids by directory name, newest first. UTC timestamp ids sort
# that way. current and previous are added to the keep set even when older.
prune_old_releases() {
  local app_real="" releases_real="" current_resolved="" previous_resolved=""
  local entry="" base="" name="" target="" resolved=""
  local -a names=()
  local -a sorted=()
  local -A keep=()
  local count=0

  if [[ -z "${APP_ROOT:-}" || -z "${RELEASES_DIR:-}" || -z "${CURRENT_LINK:-}" ]]; then
    warn "skip release cleanup: empty APP_ROOT, RELEASES_DIR, or current"
    return 0
  fi
  if [[ "$APP_ROOT" == *..* || "$RELEASES_DIR" == *..* || "$CURRENT_LINK" == *..* ]]; then
    warn "skip release cleanup: path contains .."
    return 0
  fi
  if [[ -L "$APP_ROOT" || -L "$RELEASES_DIR" || ! -d "$APP_ROOT" || ! -d "$RELEASES_DIR" ]]; then
    warn "skip release cleanup: app root or releases is missing or a symlink"
    return 0
  fi
  app_real="$(readlink -f -- "$APP_ROOT" 2>/dev/null || true)"
  releases_real="$(readlink -f -- "$RELEASES_DIR" 2>/dev/null || true)"
  if [[ -z "$app_real" || -z "$releases_real" || "$releases_real" != "$app_real/releases" ]]; then
    warn "skip release cleanup: releases is not APP_ROOT/releases"
    return 0
  fi
  if [[ ! -L "$CURRENT_LINK" ]]; then
    warn "skip release cleanup: current is not a symlink"
    return 0
  fi
  current_resolved="$(readlink -f -- "$CURRENT_LINK" 2>/dev/null || true)"
  if [[ -z "$current_resolved" || -L "$current_resolved" || ! -d "$current_resolved" ]]; then
    warn "skip release cleanup: current does not resolve to a directory"
    return 0
  fi
  base="$(basename -- "$current_resolved")"
  if [[ "$current_resolved" != "$releases_real/$base" ]] || ! validate_release_id "$base"; then
    warn "skip release cleanup: current is outside releases"
    return 0
  fi
  keep["$base"]=1

  if [[ -n "${PREVIOUS:-}" ]]; then
    if [[ "$PREVIOUS" == *..* || -L "$PREVIOUS" || ! -d "$PREVIOUS" ]]; then
      warn "skip release cleanup: previous release is unsafe or missing"
      return 0
    fi
    previous_resolved="$(readlink -f -- "$PREVIOUS" 2>/dev/null || true)"
    if [[ -z "$previous_resolved" || ! -d "$previous_resolved" ]]; then
      warn "skip release cleanup: previous is outside releases"
      return 0
    fi
    base="$(basename -- "$previous_resolved")"
    if [[ "$previous_resolved" != "$releases_real/$base" ]] || ! validate_release_id "$base"; then
      warn "skip release cleanup: previous is outside releases"
      return 0
    fi
    keep["$base"]=1
  fi

  while IFS= read -r -d '' entry; do
    [[ -n "$entry" ]] || continue
    if release_dir_is_removable "$entry"; then
      names+=("$(basename -- "$entry")")
    fi
  done < <(find -P "$releases_real" -mindepth 1 -maxdepth 1 -print0 2>/dev/null || true)

  if ((${#names[@]} == 0)); then
    return 0
  fi

  mapfile -t sorted < <(printf '%s\n' "${names[@]}" | LC_ALL=C sort -r)
  count=0
  for name in "${sorted[@]}"; do
    [[ -n "$name" ]] || continue
    if (( count < RELEASE_KEEP_COUNT )); then
      keep["$name"]=1
      count=$((count + 1))
    fi
  done

  for name in "${sorted[@]}"; do
    [[ -n "$name" ]] || continue
    [[ -n "${keep[$name]:-}" ]] && continue
    if [[ -z "$releases_real" || -z "$name" ]]; then
      warn "skipping release cleanup: empty path"
      continue
    fi
    target="${releases_real}/${name}"
    if [[ "$target" != "$releases_real/$name" ]]; then
      warn "refusing to remove out-of-bounds path ${target}"
      continue
    fi
    if ! release_dir_is_removable "$target"; then
      warn "skipping unsafe release path ${target}"
      continue
    fi
    resolved="$(readlink -f -- "$target" 2>/dev/null || true)"
    if [[ -z "$resolved" || -L "$target" || ! -d "$target" ]]; then
      warn "skipping unsafe release path ${target}"
      continue
    fi
    if [[ "$resolved" == "$current_resolved" || ( -n "$previous_resolved" && "$resolved" == "$previous_resolved" ) ]]; then
      warn "refusing to remove protected release ${target}"
      continue
    fi
    if [[ "$resolved" != "$releases_real/$name" || "$resolved" == "$app_real" || "$resolved" == "$app_real/shared" || "$resolved" == "$app_real/shared"/* ]]; then
      warn "refusing to remove out-of-bounds path ${target}"
      continue
    fi
    log "removing old release ${name}"
    if ! rm -rf -- "$target"; then
      warn "release cleanup failed for ${target}; activation stays in place"
    fi
  done
  return 0
}

# Activation has already succeeded. A cleanup error must not restore current.
run_release_cleanup() {
  trap - ERR
  set +e
  prune_old_releases
  set -e
  trap 'on_err "$LINENO"' ERR
}

publish_release() {
  local tarball="$1"
  local rid="$2"
  validate_release_id "$rid" || fail "invalid release id: ${rid}"
  require_layout
  RELEASE_DIR="${RELEASES_DIR}/${rid}"
  [[ ! -e "$RELEASE_DIR" ]] || fail "release already exists, refusing to overwrite: ${RELEASE_DIR}. Use rollback for an on-disk release."
  [[ -f "$tarball" ]] || fail "missing tarball: ${tarball}"
  UNPACK_DIR="$(mktemp -d "${RELEASES_DIR}/.unpack.XXXXXX")"
  tar -xzf "$tarball" -C "$UNPACK_DIR"
  verify_tree "$UNPACK_DIR"
  if [[ -e "$UNPACK_DIR/.env" || -e "$UNPACK_DIR/deploy.env" ]]; then
    fail "tarball contains .env or deploy.env"
  fi
  mv "$UNPACK_DIR" "$RELEASE_DIR"
  UNPACK_DIR=""
  CREATED=true
  chown_release
  link_shared_env "$RELEASE_DIR"
  link_shared_private "$RELEASE_DIR"
  chmod_frontend
  npm_ci_release
  migrate_release
  switch_current
  if ! restart_service; then
    fail "node process was not restarted"
  fi
  if ! wait_for_health; then
    fail "health check failed; need \"ok\": true from ${HEALTH_URL} or ${NGINX_HEALTH_URL}"
  fi
  if ! reload_nginx; then
    log "warning: nginx reload failed. API health passed. If the UI is stale, reload nginx on the host."
  fi
  log "published ${RELEASE_DIR}"
  run_release_cleanup
}

rollback_release() {
  local rid="$1"
  validate_release_id "$rid" || fail "invalid release id: ${rid}"
  require_layout
  RELEASE_DIR="${RELEASES_DIR}/${rid}"
  [[ -d "$RELEASE_DIR" ]] || fail "rollback target does not exist: ${RELEASE_DIR}"
  verify_tree "$RELEASE_DIR"
  require_installed_modules "$RELEASE_DIR"
  link_shared_env "$RELEASE_DIR"
  switch_current
  if ! restart_service; then
    fail "node process was not restarted"
  fi
  if ! wait_for_health; then
    fail "health check failed after rollback"
  fi
  if ! reload_nginx; then
    log "warning: nginx reload failed after rollback. API health passed."
  fi
  log "rolled back to ${RELEASE_DIR}"
  run_release_cleanup
}

main() {
  local cmd="${1:-}"
  case "$cmd" in
    publish)
      [[ $# -eq 3 ]] || fail "usage: activate-release.sh publish <tarball> <release_id>"
      publish_release "$2" "$3"
      ;;
    rollback)
      [[ $# -eq 2 ]] || fail "usage: activate-release.sh rollback <release_id>"
      rollback_release "$2"
      ;;
    *)
      fail "usage: activate-release.sh publish <tarball> <release_id> | rollback <release_id>"
      ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
