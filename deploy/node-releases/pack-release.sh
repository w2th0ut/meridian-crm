#!/usr/bin/env bash
# Build a Node release tarball from an already-built checkout.
# The archive has dist, static assets, and package manifests only.
# It does not contain node_modules, .env, or deploy.env. The server runs npm ci.
set -euo pipefail

if [[ $# -ne 2 ]]; then
  printf 'usage: pack-release.sh <repo-root> <output-tarball>\n' >&2
  exit 1
fi

ROOT="$(cd -- "$1" && pwd)"
OUT="$2"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

copy_file() {
  local rel="$1"
  if [[ ! -f "$ROOT/$rel" ]]; then
    printf 'missing file %s\n' "$rel" >&2
    exit 1
  fi
  mkdir -p "$STAGE/$(dirname -- "$rel")"
  cp -a "$ROOT/$rel" "$STAGE/$rel"
}

copy_tree() {
  local rel="$1"
  if [[ ! -d "$ROOT/$rel" ]]; then
    printf 'missing directory %s\n' "$rel" >&2
    exit 1
  fi
  mkdir -p "$STAGE/$rel"
  cp -a "$ROOT/$rel"/. "$STAGE/$rel/"
}

copy_tree_if_present() {
  local rel="$1"
  if [[ -d "$ROOT/$rel" ]]; then
    copy_tree "$rel"
  fi
}

copy_file package.json
copy_file package-lock.json
copy_file backend/package.json
copy_file frontend/package.json
copy_file integration-sdk/package.json
copy_file integration-worker/package.json
copy_file keduoduo-runner/package.json
copy_tree backend/dist
copy_tree backend/resources
copy_tree frontend/dist
copy_tree integration-sdk/dist
copy_tree agent-skills
copy_tree agent-knowledge
copy_tree_if_present integration-worker/dist
copy_tree_if_present keduoduo-runner/dist

for manifest in backend/package.json integration-sdk/package.json; do
  if ! grep -Eq '"type"[[:space:]]*:[[:space:]]*"module"' "$STAGE/$manifest"; then
    printf '%s must set "type": "module" so node can load dist\n' "$manifest" >&2
    exit 1
  fi
done

for required in \
  backend/dist/server.js \
  backend/dist/migrate-mysql.js \
  backend/resources/document-templates/proforma-invoice-variable-base.xlsx \
  frontend/dist/index.html \
  integration-sdk/dist/index.js
do
  if [[ ! -f "$STAGE/$required" ]]; then
    printf 'packed tree missing %s\n' "$required" >&2
    exit 1
  fi
done

if find "$STAGE" \( -name '.env' -o -name 'deploy.env' -o -name '.env.*' \) -print | grep -q .; then
  printf 'refusing to pack .env or deploy.env\n' >&2
  exit 1
fi
if [[ -d "$STAGE/node_modules" || -d "$STAGE/backend/node_modules" ]]; then
  printf 'refusing to pack node_modules\n' >&2
  exit 1
fi

cat > "$STAGE/RELEASE.txt" <<EOF
git_sha=${GIT_SHA:-unknown}
packed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
layout=node-release
app_root=/opt/keduoduo-crm
EOF

mkdir -p "$(dirname -- "$OUT")"
tar -C "$STAGE" -czf "$OUT" .
printf 'packed %s\n' "$OUT"
