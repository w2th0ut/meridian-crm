#!/usr/bin/env bash
# Remote body for probe-ecs. appleboy/ssh-action reads this file on the
# runner (script_path) and sends it as one bash -c script. Do not enable
# script_stop: drone-ssh 1.8.0 inserts an exit-check after every newline
# and that breaks case (run 41183804000).
set -euo pipefail

case "$APP_ROOT" in
  /opt/keduoduo-crm) ;;
  *) printf 'refusing unexpected APP_ROOT\n' >&2
     exit 1
     ;;
esac
case "$RID" in
  ""|*[!A-Za-z0-9_.-]*) printf 'invalid release id\n' >&2
     exit 1
     ;;
esac
[[ "$RID" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$ ]]
root="${APP_ROOT}/releases/${RID}"
if [[ -d "$root" && -f "$root/backend/dist/server.js" && -f "$root/frontend/dist/index.html" && ( -e "$root/node_modules/express" || -e "$root/backend/node_modules/express" ) ]]; then
  exit 0
fi
exit 2
