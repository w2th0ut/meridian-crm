#!/usr/bin/env bash
# Fail with secret names only. Never print secret values.
set -euo pipefail

missing=0
for name in ECS_HOST ECS_USER; do
  if [[ -z "${!name:-}" ]]; then
    printf 'Missing GitHub Actions secret: %s\n' "$name" >&2
    missing=1
  fi
done
if [[ -z "${ECS_SSH_KEY:-}" && -z "${ECS_SSH_PASSWORD:-}" ]]; then
  printf 'Missing GitHub Actions secret: set ECS_SSH_KEY and/or ECS_SSH_PASSWORD\n' >&2
  missing=1
fi
exit "$missing"
