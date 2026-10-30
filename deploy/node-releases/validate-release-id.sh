#!/usr/bin/env bash
# Shared release-id check for CI. Directory names only: no slash, no "..".
# Live ids look like 20261029012526. Product-version-sha is also accepted.

validate_release_id() {
  local rid="${1:-}"
  [[ "$rid" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$ ]]
}
