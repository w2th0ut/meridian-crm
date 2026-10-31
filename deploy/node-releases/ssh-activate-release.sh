#!/usr/bin/env bash
# Remote body for deploy-ecs "SSH activate release".
# appleboy/ssh-action reads this file on the runner (script_path) and sends
# it as one bash -c script. Do not enable script_stop: drone-ssh 1.8.0
# inserts an exit-check after every newline, which breaks this case
# statement. On run 41183804000 the inline script plus five export lines
# failed as "bash: -c: line 9: syntax error near unexpected token ';'".
# Fail-fast is set -euo pipefail.
# NODE_RELEASE_SSH_TEST is not passed by the workflow. It only lets local
# tests point at a temp directory instead of /tmp/keduoduo-node-release.
set -euo pipefail

case "$APP_ROOT" in
  /opt/keduoduo-crm) ;;
  *) printf 'refusing unexpected APP_ROOT\n' >&2
     exit 1
     ;;
esac
case "$MODE" in
  publish|rollback) ;;
  *) printf 'refusing unexpected MODE\n' >&2
     exit 1
     ;;
esac

stage="/tmp/keduoduo-node-release"
if [[ "${NODE_RELEASE_SSH_TEST:-}" == "1" ]]; then
  stage="${STAGING_DIR:?STAGING_DIR is required when NODE_RELEASE_SSH_TEST=1}"
fi
cd -- "$stage"
chmod 0755 ./activate-release.sh
if [[ "$MODE" == publish ]]; then
  test -f ./release.tar.gz
  ./activate-release.sh publish ./release.tar.gz "$RID"
else
  ./activate-release.sh rollback "$RID"
fi
rm -f ./release.tar.gz
