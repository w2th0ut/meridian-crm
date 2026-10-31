#!/usr/bin/env bash
# Local safety tests for the Node release pack/activate scripts and the workflow file.
# They do not SSH and they do not touch /opt.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
REAL_NODE="$(command -v node)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

expect_fail() {
  local pattern="$1"
  shift
  local out code
  set +e
  out="$("$@" 2>&1)"
  code=$?
  set -e
  if [[ "$code" -eq 0 ]]; then
    printf 'expected failure: %s\n%s\n' "$*" "$out" >&2
    exit 1
  fi
  if ! grep -q "$pattern" <<<"$out"; then
    printf 'failure output missing "%s"\n%s\n' "$pattern" "$out" >&2
    exit 1
  fi
}

write_tree() {
  local dest="$1"
  mkdir -p \
    "$dest/backend/dist" \
    "$dest/backend/resources/document-templates" \
    "$dest/frontend/dist" \
    "$dest/integration-sdk/dist" \
    "$dest/integration-worker" \
    "$dest/keduoduo-runner" \
    "$dest/agent-skills" \
    "$dest/agent-knowledge"
  printf '%s\n' '{"name":"keduoduo-crm","private":true}' > "$dest/package.json"
  printf '%s\n' '{"lockfileVersion":3}' > "$dest/package-lock.json"
  printf '%s\n' '{"name":"keduoduo-crm-backend","type":"module"}' > "$dest/backend/package.json"
  printf '%s\n' '{"name":"keduoduo-crm-frontend","type":"module"}' > "$dest/frontend/package.json"
  printf '%s\n' '{"name":"@keduoduo/integration-connector-sdk","type":"module"}' > "$dest/integration-sdk/package.json"
  printf '%s\n' '{"name":"keduoduo-crm-integration-worker"}' > "$dest/integration-worker/package.json"
  printf '%s\n' '{"name":"@keduoduo/local-runner"}' > "$dest/keduoduo-runner/package.json"
  printf '%s\n' 'export {}' > "$dest/backend/dist/server.js"
  printf '%s\n' 'export {}' > "$dest/backend/dist/migrate-mysql.js"
  printf '%s\n' 'export function loadLocalEnv() {}' > "$dest/backend/dist/runtime-env.js"
  printf '%s\n' 'template' > "$dest/backend/resources/document-templates/proforma-invoice-variable-base.xlsx"
  printf '%s\n' '<!doctype html>' > "$dest/frontend/dist/index.html"
  printf '%s\n' 'export {}' > "$dest/integration-sdk/dist/index.js"
  printf '%s\n' 'skill' > "$dest/agent-skills/README.md"
  printf '%s\n' '{}' > "$dest/agent-knowledge/00-system-contract.json"
  mkdir -p "$dest/node_modules/express"
  printf '%s\n' 'decoy' > "$dest/node_modules/express/index.js"
}

setup_stubs() {
  local dir="$1"
  mkdir -p "$dir"
  cat > "$dir/npm" <<'EOF'
#!/bin/bash
set -euo pipefail
printf '%s\n' "$*" >> "${NPM_LOG:?}"
if [[ "${NPM_FAIL:-}" == "1" ]]; then
  exit 1
fi
prefix=""
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  if [[ "${args[$i]}" == "--prefix" ]]; then
    prefix="${args[$((i + 1))]}"
  fi
done
[[ -n "$prefix" ]]
mkdir -p "$prefix/node_modules/express" "$prefix/node_modules/@keduoduo/integration-connector-sdk"
EOF
  cat > "$dir/node" <<'EOF'
#!/bin/bash
set -euo pipefail
printf '%s\n' "$*" >> "${NODE_LOG:?}"
if [[ "${NODE_FAIL:-}" == "1" ]]; then
  exit 1
fi
script="${1:-}"
root="${2:-}"
[[ -f "$script" ]]
[[ -L "$root/.env" ]]
[[ -f "$root/backend/dist/migrate-mysql.js" ]]
EOF
  cat > "$dir/curl" <<'EOF'
#!/bin/bash
set -euo pipefail
url="${*: -1}"
printf '%s\n' "$url" >> "${CURL_LOG:?}"
case "${CURL_MODE:-ok}" in
  fail)
    printf '%s\n' '{"ok":false}'
    ;;
  nginx-only)
    case "$url" in
      *4188*) exit 1 ;;
    esac
    printf '%s\n' '{"ok":true,"store":"mysql"}'
    ;;
  ok)
    printf '%s\n' '{"ok":true,"store":"mysql","prospectQueue":{"mode":"mysql_polling"}}'
    ;;
  *)
    exit 1
    ;;
esac
EOF
  cat > "$dir/systemctl" <<'EOF'
#!/bin/bash
set -euo pipefail
printf '%s\n' "$*" >> "${SYSTEMCTL_LOG:?}"
cmd="${1:-}"
unit="${2:-}"
case "$cmd" in
  cat)
    [[ -f "${UNIT_DIR:?}/$unit" ]] || exit 1
    ;;
  restart|stop|reload)
    ;;
  *)
    exit 1
    ;;
esac
EOF
  chmod 755 "$dir/npm" "$dir/node" "$dir/curl" "$dir/systemctl"
}

prepare_app() {
  local app="$1"
  local previous="$app/releases/20261029012526"
  write_tree "$previous"
  mkdir -p "$app/shared"
  printf '%s\n' 'DATABASE_URL=mysql://fixture:secret@127.0.0.1/db' > "$app/shared/.env"
  chmod 600 "$app/shared/.env"
  ln -sfn "$previous" "$app/current"
  mkdir -p "$UNIT_DIR"
  printf '%s\n' '[Service]' > "$UNIT_DIR/keduoduo-crm.service"
}

activate() {
  env \
    APP_ROOT="$APP" \
    APP_USER="$(id -un)" \
    NODE_RELEASE_NO_SUDO=1 \
    HEALTH_ATTEMPTS=2 \
    HEALTH_SLEEP_SECONDS=0 \
    PATH="$STUBS:/usr/bin:/bin" \
    NPM_LOG="$NPM_LOG" \
    NODE_LOG="$NODE_LOG" \
    CURL_LOG="$CURL_LOG" \
    SYSTEMCTL_LOG="$SYSTEMCTL_LOG" \
    UNIT_DIR="$UNIT_DIR" \
    CURL_MODE="${CURL_MODE:-ok}" \
    NPM_FAIL="${NPM_FAIL:-}" \
    NODE_FAIL="${NODE_FAIL:-}" \
    RESTART_COMMAND="${RESTART_COMMAND:-}" \
    bash "$ROOT/deploy/node-releases/activate-release.sh" "$@"
}

new_case() {
  local name="$1"
  CASE="$TMP/cases/$name"
  rm -rf "$CASE"
  mkdir -p "$CASE"
  STUBS="$CASE/stubs"
  APP="$CASE/app"
  UNIT_DIR="$CASE/units"
  NPM_LOG="$CASE/npm.log"
  NODE_LOG="$CASE/node.log"
  CURL_LOG="$CASE/curl.log"
  SYSTEMCTL_LOG="$CASE/systemctl.log"
  : > "$NPM_LOG"
  : > "$NODE_LOG"
  : > "$CURL_LOG"
  : > "$SYSTEMCTL_LOG"
  setup_stubs "$STUBS"
  prepare_app "$APP"
  FIXTURE="$CASE/fixture"
  write_tree "$FIXTURE"
  PACK="$CASE/release.tar.gz"
  GIT_SHA=abc1234 bash "$ROOT/deploy/node-releases/pack-release.sh" "$FIXTURE" "$PACK" >/dev/null
  CURL_MODE=ok
  NPM_FAIL=
  NODE_FAIL=
  RESTART_COMMAND=
}

assert_env_unchanged() {
  [[ "$(stat -c %a "$APP/shared/.env")" == "600" ]] || fail "shared env mode changed"
  grep -q 'mysql://fixture:secret@127.0.0.1/db' "$APP/shared/.env" || fail "shared env content changed"
}

test_pack_omits_secrets_and_modules() {
  local listing
  listing="$(tar -tzf "$PACK")"
  grep -q './backend/dist/server.js' <<<"$listing" || grep -q 'backend/dist/server.js' <<<"$listing" || fail "tarball missing server.js"
  grep -q 'frontend/dist/index.html' <<<"$listing" || fail "tarball missing frontend"
  grep -q 'RELEASE.txt' <<<"$listing" || fail "tarball missing RELEASE.txt"
  if grep -Eq '(^|/)(\.env|deploy\.env|node_modules)(/|$)' <<<"$listing"; then
    fail "tarball contains env or node_modules: $listing"
  fi
}

test_pack_rejects_env_file() {
  printf '%s\n' 'SECRET=1' > "$FIXTURE/agent-skills/.env"
  expect_fail 'refusing to pack' bash "$ROOT/deploy/node-releases/pack-release.sh" "$FIXTURE" "$CASE/bad.tar.gz"
  rm -f "$FIXTURE/agent-skills/.env"
}

test_pack_drops_sdk_prepare() {
  # The real manifest's prepare is `npm run build` -> `tsc -p tsconfig.json`.
  # Activate's npm ci still runs that prepare for the workspace link.
  # The tarball must keep the prebuilt dist and must not keep prepare.
  cp "$ROOT/integration-sdk/package.json" "$FIXTURE/integration-sdk/package.json"
  python3 - "$FIXTURE/integration-sdk/package.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
prepare = (data.get("scripts") or {}).get("prepare")
if prepare != "npm run build":
    raise SystemExit(f"integration-sdk prepare changed; pack test needs an update: {prepare!r}")
PY
  [[ ! -e "$FIXTURE/integration-sdk/tsconfig.json" ]] || fail "fixture unexpectedly has tsconfig.json"
  local packed="$CASE/sdk-prepare.tar.gz"
  local extracted="$CASE/sdk-prepare"
  GIT_SHA=abc1234 bash "$ROOT/deploy/node-releases/pack-release.sh" "$FIXTURE" "$packed" >/dev/null
  mkdir -p "$extracted"
  tar -xzf "$packed" -C "$extracted"
  [[ -f "$extracted/integration-sdk/dist/index.js" ]] || fail "tarball missing prebuilt integration-sdk dist"
  [[ ! -e "$extracted/integration-sdk/tsconfig.json" ]] || fail "tarball should not need tsconfig.json"
  [[ ! -d "$extracted/integration-sdk/src" ]] || fail "tarball should not ship integration-sdk sources"
  python3 - "$extracted/integration-sdk/package.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
scripts = data.get("scripts") or {}
if "prepare" in scripts:
    raise SystemExit(f"packed integration-sdk still has prepare: {scripts!r}")
if data.get("type") != "module":
    raise SystemExit("packed integration-sdk lost type module")
if scripts.get("build") != "tsc -p tsconfig.json":
    raise SystemExit(f"packed build script drifted: {scripts!r}")
PY
}

test_publish_links_env_and_switches_current() {
  activate publish "$PACK" 20261030120000
  [[ "$(readlink -f "$APP/current")" == "$APP/releases/20261030120000" ]] || fail "current was not switched"
  [[ -L "$APP/releases/20261030120000/.env" ]] || fail "release .env is not a symlink"
  [[ "$(readlink -f "$APP/releases/20261030120000/.env")" == "$(readlink -f "$APP/shared/.env")" ]] || fail "env link target"
  [[ -f "$APP/releases/20261030120000/frontend/dist/index.html" ]] || fail "frontend missing"
  [[ "$(stat -c %a "$APP/releases/20261030120000/frontend/dist/index.html")" == "644" ]] || fail "frontend not world-readable"
  grep -q 'ci --omit=dev --ignore-scripts' "$NPM_LOG" || fail "npm ci was not production install: $(cat "$NPM_LOG")"
  grep -q 'migrate-with-shared-env.mjs' "$NODE_LOG" || fail "migrate helper was not run"
  grep -q 'restart keduoduo-crm.service' "$SYSTEMCTL_LOG" || fail "systemd restart missing"
  grep -q '127.0.0.1:4188/api/health' "$CURL_LOG" || fail "health url missing"
  assert_env_unchanged
  if compgen -G "$APP/releases/.unpack.*" >/dev/null; then
    fail "unpack dir left behind"
  fi
}

test_health_failure_restores_previous() {
  CURL_MODE=fail
  expect_fail 'health check failed' activate publish "$PACK" 20261030120001
  [[ "$(readlink -f "$APP/current")" == "$APP/releases/20261029012526" ]] || fail "current was not restored"
  [[ -d "$APP/releases/20261030120001" ]] || fail "failed release should be kept for inspection"
  assert_env_unchanged
}

test_nginx_health_is_enough() {
  CURL_MODE=nginx-only
  activate publish "$PACK" 20261030120002
  [[ "$(readlink -f "$APP/current")" == "$APP/releases/20261030120002" ]] || fail "nginx health did not publish"
  grep -q '127.0.0.1/api/health' "$CURL_LOG" || fail "nginx health url missing"
}

test_npm_failure_removes_incomplete_release() {
  NPM_FAIL=1
  expect_fail 'removing incomplete release' activate publish "$PACK" 20261030120003
  [[ ! -e "$APP/releases/20261030120003" ]] || fail "incomplete release was kept"
  [[ "$(readlink -f "$APP/current")" == "$APP/releases/20261029012526" ]] || fail "current changed after npm failure"
  assert_env_unchanged
}

test_refuse_overwrite() {
  activate publish "$PACK" 20261030120004
  expect_fail 'refusing to overwrite' activate publish "$PACK" 20261030120004
  [[ -f "$APP/releases/20261030120004/backend/dist/server.js" ]] || fail "existing release damaged"
}

test_refuse_env_in_tarball() {
  local bad="$CASE/with-env"
  rm -rf "$bad"
  mkdir -p "$bad"
  tar -xzf "$PACK" -C "$bad"
  printf '%s\n' 'SECRET=from-tar' > "$bad/.env"
  tar -C "$bad" -czf "$CASE/with-env.tar.gz" .
  expect_fail 'tarball contains' activate publish "$CASE/with-env.tar.gz" 20261030120005
  [[ ! -e "$APP/releases/20261030120005" ]] || fail "env tarball was installed"
  assert_env_unchanged
}

test_refuse_regular_env_file_on_rollback() {
  printf '%s\n' 'SECRET=local' > "$APP/releases/20261029012526/.env"
  expect_fail 'refusing to replace regular file' activate rollback 20261029012526
  grep -q 'SECRET=local' "$APP/releases/20261029012526/.env" || fail "regular env was modified"
  [[ ! -L "$APP/releases/20261029012526/.env" ]] || fail "regular env became a symlink"
}

test_rollback_does_not_rebuild() {
  activate rollback 20261029012526
  [[ ! -s "$NPM_LOG" ]] || fail "rollback ran npm: $(cat "$NPM_LOG")"
  [[ ! -s "$NODE_LOG" ]] || fail "rollback ran node: $(cat "$NODE_LOG")"
  grep -q 'restart keduoduo-crm.service' "$SYSTEMCTL_LOG" || fail "rollback did not restart"
  [[ -L "$APP/releases/20261029012526/.env" ]] || fail "rollback did not link shared env"
  assert_env_unchanged
}

test_missing_unit_restores_current() {
  rm -f "$UNIT_DIR/keduoduo-crm.service"
  expect_fail 'systemd unit keduoduo-crm.service was not found' activate publish "$PACK" 20261030120006
  [[ "$(readlink -f "$APP/current")" == "$APP/releases/20261029012526" ]] || fail "missing unit left current moved"
}

test_restart_command_override() {
  rm -f "$UNIT_DIR/keduoduo-crm.service"
  RESTART_COMMAND="printf restarted >> '$CASE/restarted.txt'"
  activate publish "$PACK" 20261030120007
  grep -q restarted "$CASE/restarted.txt" || fail "RESTART_COMMAND did not run"
  if grep -q 'restart keduoduo-crm.service' "$SYSTEMCTL_LOG"; then
    fail "RESTART_COMMAND still called systemctl restart"
  fi
}

test_refuse_baota_root() {
  APP_ROOT=/opt/keduoduocrm expect_fail 'refusing' \
    env APP_ROOT=/opt/keduoduocrm NODE_RELEASE_NO_SUDO=1 PATH="$STUBS:/usr/bin:/bin" \
    bash "$ROOT/deploy/node-releases/activate-release.sh" rollback 20261029012526
}

test_missing_shared_env() {
  rm -f "$APP/shared/.env"
  expect_fail 'refusing to create secrets' activate publish "$PACK" 20261030120008
  [[ ! -e "$APP/shared/.env" ]] || fail "script created shared env"
}

test_current_directory_not_symlink() {
  rm -f "$APP/current"
  mkdir -p "$APP/current"
  expect_fail 'not a symlink' activate publish "$PACK" 20261030120009
  [[ -d "$APP/current" && ! -L "$APP/current" ]] || fail "non-symlink current was replaced"
  [[ ! -e "$APP/releases/20261030120009" ]] || fail "release kept after refusing current"
}

test_release_id_rules() {
  # shellcheck source=deploy/node-releases/validate-release-id.sh
  source "$ROOT/deploy/node-releases/validate-release-id.sh"
  validate_release_id 20261029012526 || fail "timestamp id rejected"
  validate_release_id '2.0.6-abc1234' || fail "version-sha id rejected"
  if validate_release_id '../etc' || validate_release_id '/tmp/x' || validate_release_id '..' || validate_release_id ''; then
    fail "unsafe release id accepted"
  fi
  grep -F '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$' "$ROOT/deploy/node-releases/activate-release.sh" >/dev/null \
    || fail "activate release-id regex drifted"
}

test_migrate_helper_does_not_print_secrets() {
  local rel="$CASE/migrate-release" marker="$CASE/marker" out
  rm -rf "$rel"
  mkdir -p "$rel/backend/dist"
  printf '%s\n' 'DATABASE_URL=mysql://user:supersecret@127.0.0.1/db' > "$rel/.env"
  cat > "$rel/backend/dist/runtime-env.js" <<'EOF'
import { readFileSync } from "node:fs";
export function loadLocalEnv() {
  for (const line of readFileSync(new URL("../../.env", import.meta.url), "utf8").split(/\n/)) {
    if (!line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
EOF
  cat > "$rel/backend/dist/migrate-mysql.js" <<EOF
import { writeFileSync } from "node:fs";
if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.includes("supersecret")) process.exit(2);
writeFileSync(process.env.MARKER, "migrated\\n");
EOF
  set +e
  out="$(MARKER="$marker" "$REAL_NODE" "$ROOT/deploy/node-releases/migrate-with-shared-env.mjs" "$rel" 2>&1)"
  local code=$?
  set -e
  [[ "$code" -eq 0 ]] || fail "migrate helper failed: $out"
  [[ "$(cat "$marker")" == "migrated" ]] || fail "migrate marker missing"
  if grep -q supersecret <<<"$out"; then
    fail "migrate helper printed a secret"
  fi
  rm -f "$rel/.env"
  printf '%s\n' 'OTHER=1' > "$rel/.env"
  set +e
  out="$(MARKER="$marker.missing" "$REAL_NODE" "$ROOT/deploy/node-releases/migrate-with-shared-env.mjs" "$rel" 2>&1)"
  code=$?
  set -e
  [[ "$code" -ne 0 ]] || fail "migrate helper ran without DATABASE_URL"
  grep -q 'DATABASE_URL' <<<"$out" || fail "missing database url was not reported"
  [[ ! -e "$marker.missing" ]] || fail "migrate ran without a database url"
}

test_ssh_remote_scripts() {
  local probe="$ROOT/deploy/node-releases/ssh-probe-release.sh"
  local activate="$ROOT/deploy/node-releases/ssh-activate-release.sh"
  bash -n "$probe"
  bash -n "$activate"
  expect_fail 'refusing unexpected APP_ROOT' \
    env APP_ROOT=/opt/keduoduocrm RID=20261031081642 bash "$probe"
  expect_fail 'invalid release id' \
    env APP_ROOT=/opt/keduoduo-crm RID='../etc' bash "$probe"
  expect_fail 'invalid release id' \
    env APP_ROOT=/opt/keduoduo-crm RID='' bash "$probe"
  [[ ! -e /opt/keduoduo-crm/releases/20261031081642 ]] || fail "refusing to probe a live release path"
  local out code
  set +e
  out="$(APP_ROOT=/opt/keduoduo-crm RID=20261031081642 bash "$probe" 2>&1)"
  code=$?
  set -e
  [[ "$code" -eq 2 ]] || fail "probe missing release exited ${code}: ${out}"

  expect_fail 'refusing unexpected APP_ROOT' \
    env APP_ROOT=/opt/keduoduocrm MODE=publish RID=20261031081642 bash "$activate"
  expect_fail 'refusing unexpected MODE' \
    env APP_ROOT=/opt/keduoduo-crm MODE=ship RID=20261031081642 bash "$activate"

  local stage="$CASE/stage"
  mkdir -p "$stage"
  cat > "$stage/activate-release.sh" <<'EOF'
#!/bin/bash
printf '%s\n' "$*" > "$(dirname "$0")/args.txt"
EOF
  chmod 0755 "$stage/activate-release.sh"
  printf 'not-a-real-tar\n' > "$stage/release.tar.gz"
  env APP_ROOT=/opt/keduoduo-crm APP_USER=keduoduo-crm SERVICE_NAME=keduoduo-crm \
    MODE=publish RID=20261031081642 NODE_RELEASE_SSH_TEST=1 STAGING_DIR="$stage" \
    bash "$activate"
  [[ "$(cat "$stage/args.txt")" == "publish ./release.tar.gz 20261031081642" ]] \
    || fail "publish args drifted"
  [[ ! -e "$stage/release.tar.gz" ]] || fail "publish left the tarball"

  printf 'not-a-real-tar\n' > "$stage/release.tar.gz"
  env APP_ROOT=/opt/keduoduo-crm MODE=rollback RID=20261029012526 \
    NODE_RELEASE_SSH_TEST=1 STAGING_DIR="$stage" \
    bash "$activate"
  [[ "$(cat "$stage/args.txt")" == "rollback 20261029012526" ]] || fail "rollback args drifted"
  [[ ! -e "$stage/release.tar.gz" ]] || fail "rollback left the tarball"

  rm -f "$stage/release.tar.gz" "$stage/args.txt"
  set +e
  out="$(APP_ROOT=/opt/keduoduo-crm MODE=publish RID=20261031081642 NODE_RELEASE_SSH_TEST=1 STAGING_DIR="$stage" bash "$activate" 2>&1)"
  code=$?
  set -e
  [[ "$code" -ne 0 ]] || fail "publish without a tarball succeeded: ${out}"
  [[ ! -e "$stage/args.txt" ]] || fail "publish without a tarball invoked activate"

  # Same shape drone-ssh uses when script_stop is off: export lines, then the file as one script.
  local wrapped
  wrapped="$(STAGING_DIR="$stage" python3 - "$activate" <<'PY'
import os, pathlib, shlex, sys
body = pathlib.Path(sys.argv[1]).read_text()
stage = shlex.quote(os.environ["STAGING_DIR"])
prefix = "\n".join([
    "export APP_ROOT='/opt/keduoduo-crm'",
    "export APP_USER='keduoduo-crm'",
    "export SERVICE_NAME='keduoduo-crm'",
    "export MODE='publish'",
    "export RID='20261031081642'",
    "export NODE_RELEASE_SSH_TEST='1'",
    f"export STAGING_DIR={stage}",
])
print(prefix + "\n" + body)
PY
)"
  printf 'not-a-real-tar\n' > "$stage/release.tar.gz"
  bash -c "$wrapped"
  [[ "$(cat "$stage/args.txt")" == "publish ./release.tar.gz 20261031081642" ]] \
    || fail "bash -c publish args drifted"

  # script_stop splits that file and recreates the production syntax error.
  local broken
  broken="$(python3 - "$activate" <<'PY'
import pathlib, sys
body = pathlib.Path(sys.argv[1]).read_text()
check = "DRONE_SSH_PREV_COMMAND_EXIT_CODE=$? ; if [ $DRONE_SSH_PREV_COMMAND_EXIT_CODE -ne 0 ]; then exit $DRONE_SSH_PREV_COMMAND_EXIT_CODE; fi;"
lines = []
for cmd in body.split("\n"):
    cmd = cmd.strip()
    if not cmd:
        continue
    lines.append(cmd)
    if not cmd.endswith("\\"):
        lines.append(check)
prefix = [
    "export APP_ROOT='/opt/keduoduo-crm'",
    "export APP_USER='keduoduo-crm'",
    "export SERVICE_NAME='keduoduo-crm'",
    "export MODE='publish'",
    "export RID='20261031081642'",
]
print("\n".join(prefix + lines))
PY
)"
  set +e
  out="$(bash -c "$broken" 2>&1)"
  code=$?
  set -e
  [[ "$code" -eq 2 ]] || fail "script_stop rewrite exited ${code}, want syntax status 2: ${out}"
  grep -q "syntax error near unexpected token \`" <<<"$out" \
    || fail "script_stop rewrite did not report the production syntax error: ${out}"
  [[ ! -e /tmp/keduoduo-node-release/args.txt ]] || fail "script_stop rewrite executed activate"
}

test_require_ecs_secrets() {
  expect_fail 'ECS_HOST' env -u ECS_HOST ECS_USER=user ECS_SSH_KEY=key \
    bash "$ROOT/deploy/node-releases/require-ecs-secrets.sh"
  expect_fail 'ECS_SSH_KEY' env ECS_HOST=host ECS_USER=user \
    bash "$ROOT/deploy/node-releases/require-ecs-secrets.sh"
  env ECS_HOST=host ECS_USER=user ECS_SSH_PASSWORD='not-printed' \
    bash "$ROOT/deploy/node-releases/require-ecs-secrets.sh"
}

test_workflow_contract() {
  python3 - "$ROOT/.github/workflows/deploy-node-release.yml" <<'PY'
import pathlib, re, sys
import yaml
path = pathlib.Path(sys.argv[1])
text = path.read_text()
assert "baota-update" not in text, "workflow still calls baota-update"
assert "/opt/keduoduocrm" not in text, "workflow still targets the baota root"
assert re.search(r"(?m)^name: node-release$", text), "workflow name drifted; branch protection check names depend on it"
on_block = text.split("jobs:", 1)[0]
assert "push:" in on_block
assert "pull_request:" in on_block, "pull_request trigger missing"
pr = on_block.split("pull_request:", 1)[1].split("workflow_dispatch:", 1)[0]
assert "master" in pr, "pull_request must target master"
for kind in ("opened", "synchronize", "reopened"):
    assert kind in pr, f"pull_request missing type {kind}"
assert text.count("appleboy/ssh-action@") == 2
assert "script_stop" not in text, "script_stop rewrites each remote line and breaks case/if"
assert text.count("script_path:") == 2
assert "deploy/node-releases/ssh-probe-release.sh" in text
assert "deploy/node-releases/ssh-activate-release.sh" in text
assert "\n          script:" not in text, "ssh steps must not use an inline script"
for rel in (
    "deploy/node-releases/ssh-probe-release.sh",
    "deploy/node-releases/ssh-activate-release.sh",
):
    assert (path.parents[2] / rel).is_file(), rel
assert "default: false" in text
assert "cancel-in-progress: false" in text
jobs_blob = text.split("jobs:", 1)[1]
jobs = re.split(r"\n(?=  [A-Za-z0-9-]+:\n)", jobs_blob)

def job_named(name):
    matches = [job for job in jobs if job.startswith(f"  {name}:\n")]
    assert len(matches) == 1, name
    return matches[0]

def job_head(job):
    return job.split("steps:", 1)[0]

verify = job_named("verify-scripts")
assert "run-tests.sh" in verify
assert "\n    if:" not in job_head(verify), "verify-scripts must run on pull_request"

build = job_named("build")
bhead = job_head(build)
needs_line = next(line for line in bhead.splitlines() if line.strip().startswith("needs:"))
assert "verify-scripts" in needs_line, needs_line
assert "needs.verify-scripts.result == 'success'" in bhead
assert "appleboy/ssh-action@" not in build
assert "appleboy/scp-action@" not in build

ssh_jobs = [job for job in jobs if "appleboy/ssh-action@" in job]
assert len(ssh_jobs) == 2
for job in ssh_jobs:
    head = job_head(job)
    assert "deploy_ecs" in head, head
    assert "workflow_dispatch" in head, head
    assert "github.event_name != 'pull_request'" in head, head
    assert "script_path:" in job
    assert "script_stop" not in job
    assert "\n          script:" not in job

for name in ("guard-ecs", "probe-ecs", "deploy-ecs", "push-acr"):
    head = job_head(job_named(name))
    assert "github.event_name == 'workflow_dispatch'" in head, name
    assert "github.event_name != 'pull_request'" in head, name
    assert "github.event_name == 'pull_request'" not in head, name

probe = job_named("probe-ecs")
phead = job_head(probe)
assert "verify-scripts" in next(line for line in phead.splitlines() if line.strip().startswith("needs:"))
assert "needs.verify-scripts.result == 'success'" in phead

deploy = job_named("deploy-ecs")
dhead = job_head(deploy)
assert "needs: [verify-scripts, guard-ecs, probe-ecs, build]" in dhead
assert "needs.verify-scripts.result == 'success'" in dhead
assert "needs.build.result == 'success'" in dhead
assert "appleboy/scp-action@" in deploy

wf = yaml.safe_load(text)
ssh_steps = []
for job_name, job in wf["jobs"].items():
    for step in job.get("steps") or []:
        uses = str(step.get("uses") or "")
        if "appleboy/ssh-action@" in uses:
            ssh_steps.append((job_name, step))
assert [name for name, _step in ssh_steps] == ["probe-ecs", "deploy-ecs"], ssh_steps
expected_paths = {
    "probe-ecs": "deploy/node-releases/ssh-probe-release.sh",
    "deploy-ecs": "deploy/node-releases/ssh-activate-release.sh",
}
for job_name, step in ssh_steps:
    body = step.get("with") or {}
    assert "script" not in body, job_name
    assert "script_stop" not in body, job_name
    assert body.get("script_path") == expected_paths[job_name], (job_name, body.get("script_path"))
    assert "NODE_RELEASE_SSH_TEST" not in str(body.get("envs"))
    assert "STAGING_DIR" not in str(body.get("envs"))

acr = job_named("push-acr")
ahead = job_head(acr)
assert "appleboy/ssh-action@" not in acr
assert "secrets.ACR_USERNAME" in acr
assert "needs: [build]" in ahead
assert "needs.build.result == 'success'" in ahead

upload = build.split("- name: Upload dist for deploy or ACR", 1)[1].split("- name:", 1)[0]
assert "workflow_dispatch" in upload
assert "github.event_name != 'pull_request'" in upload
assert "always()" not in upload
assert "failure()" not in upload
print("workflow contract ok")
PY
  [[ ! -e "$ROOT/.github/workflows/deploy-acr.yml" ]] || fail "legacy deploy-acr.yml is still present"
  if grep -R -n "baota-update" "$ROOT/.github" >/dev/null; then
    fail "baota-update is still referenced under .github"
  fi
}

run_case() {
  local name="$1"
  shift
  new_case "$name"
  "$@"
  printf 'ok %s\n' "$name"
}

if [[ "${REQUIRE_SHELLCHECK:-}" == "1" ]] && ! command -v shellcheck >/dev/null 2>&1; then
  fail "shellcheck is required"
fi
if command -v shellcheck >/dev/null 2>&1; then
  shellcheck \
    deploy/node-releases/activate-release.sh \
    deploy/node-releases/pack-release.sh \
    deploy/node-releases/validate-release-id.sh \
    deploy/node-releases/require-ecs-secrets.sh \
    deploy/node-releases/ssh-activate-release.sh \
    deploy/node-releases/ssh-probe-release.sh \
    deploy/node-releases/run-tests.sh
fi

"$REAL_NODE" --check deploy/node-releases/migrate-with-shared-env.mjs

run_case pack test_pack_omits_secrets_and_modules
run_case pack-env test_pack_rejects_env_file
run_case pack-sdk-prepare test_pack_drops_sdk_prepare
run_case publish test_publish_links_env_and_switches_current
run_case health-fail test_health_failure_restores_previous
run_case nginx-health test_nginx_health_is_enough
run_case npm-fail test_npm_failure_removes_incomplete_release
run_case overwrite test_refuse_overwrite
run_case tar-env test_refuse_env_in_tarball
run_case regular-env test_refuse_regular_env_file_on_rollback
run_case rollback test_rollback_does_not_rebuild
run_case missing-unit test_missing_unit_restores_current
run_case restart-command test_restart_command_override
run_case baota-root test_refuse_baota_root
run_case missing-env test_missing_shared_env
run_case current-dir test_current_directory_not_symlink
run_case release-id test_release_id_rules
run_case migrate-helper test_migrate_helper_does_not_print_secrets
run_case ecs-secrets test_require_ecs_secrets
run_case ssh-scripts test_ssh_remote_scripts
test_workflow_contract
printf 'ok workflow\n'
printf 'all node-release tests passed\n'
