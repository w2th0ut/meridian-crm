# CI: Path B (Node releases on ECS)

Workflow: `.github/workflows/deploy-node-release.yml`.

The live ECS runs the Node app directly. It is not the Docker/Baota stack.

| | |
| --- | --- |
| App root | `/opt/keduoduo-crm` |
| Releases | `/opt/keduoduo-crm/releases/<id>/` |
| Active release | `/opt/keduoduo-crm/current` symlink |
| Secrets | `/opt/keduoduo-crm/shared/.env` (never overwritten by CI) |
| Process | `node backend/dist/server.js` as user `keduoduo-crm` |
| systemd unit | `keduoduo-crm` (same default as `deploy-ubuntu.sh`) |
| nginx | static files from `current/frontend/dist`; `/api/` proxies to `127.0.0.1:4188` |

Known on-disk ids use UTC timestamps, for example `20261026203307` and `20261029012526`. A push does not change which one is current.

Other containers on the same host are out of scope. This workflow does not mention them and the activate script does not call Docker.

## Merge gate

Order is fixed: CI passes, then the build artifact, then a person may merge or dispatch a deploy.

A pull request into `master` (`opened`, `synchronize`, `reopened`) runs only:

1. `verify-scripts` — `deploy/node-releases/run-tests.sh`
2. `build` — Node.js 22, `npm ci`, `npm run build`, then the same dist file checks

`build` has `needs: [verify-scripts, ...]`, and it starts only when `needs.verify-scripts.result == 'success'`. A red verify job does not install, build, or upload. The dist artifact is uploaded only after those build steps succeed, and only on a manual run that asked for ECS deploy or ACR. Pull requests do not upload it. They also do not run `guard-ecs`, `probe-ecs`, `deploy-ecs`, or `push-acr`.

Push to `master` or a `v*` / `*.*.*` tag uses the same verify-then-build order. It still has no SSH step and does not push images.

Deploy stays manual: `workflow_dispatch` with `deploy_ecs=true`. `probe-ecs` and `deploy-ecs` also wait for `verify-scripts`. Pack and `scp` stay inside `deploy-ecs`, which runs only after `build` succeeds. Rollback of an existing on-disk release still skips the build, and it still does not SSH until the script tests pass. If Actions cannot run, the on-server rollback below is unchanged. Push never SSHes.

This gate does not run `npm test` or Playwright. Those suites need a full install and, for MySQL and e2e, extra services. The required checks are the existing script contract, then the existing `npm run build`.

合并门槛：先 CI 通过，再构建产物，然后才合并或手动发布。PR 必须让 `verify-scripts` 成功，`build` 才会开始。PR 不 SSH、不推镜像、不跑 `guard-ecs` / `probe-ecs` / `deploy-ecs` / `push-acr`。推送到 master 同样只验证再构建。上线仍是手动 `workflow_dispatch` 且 `deploy_ecs=true`；探测和 SSH 也要等 `verify-scripts` 成功，打包和 scp 之前 `build` 必须成功。已有目录的回滚仍跳过构建。

### Branch protection

Set this in the GitHub UI on `master`. This workflow cannot change protection rules.

Require a pull request before merging, and require these status checks:

- `node-release / verify-scripts`
- `node-release / build`

Do not require these. On a pull request they are skipped. A required check that is skipped either blocks every merge, or shows green without running:

- `node-release / guard-ecs`
- `node-release / probe-ecs`
- `node-release / deploy-ecs`
- `node-release / push-acr`

The workflow `name` is `node-release`. The job ids are `verify-scripts` and `build`. GitHub shows each check as `workflow / job`. The names appear in the protection picker after this workflow has run once on a pull request.

在 master 的分支保护里要求上面两个检查名，并要求通过 pull request 才能合并。不要把 guard-ecs、probe-ecs、deploy-ecs、push-acr 设成必需检查。

## Push does not deploy

A push to `master`, or a tag matching `v*` / `*.*.*`, only:

1. Runs the pack/activate safety tests (`verify-scripts`).
2. After that job succeeds, runs Node.js 22, `npm ci`, and `npm run build`, then checks the same dist files the app needs.

That path has no SSH step and does not push images. It cannot run a remote update script.

## ECS deploy is manual

Run the workflow with **workflow_dispatch**:

| Input | Default | Effect |
| --- | --- | --- |
| `deploy_ecs` | `false` | `true` is the only way the workflow SSHes |
| `release_id` | empty | Empty publishes a new UTC `YYYYMMDDHHMMSS` directory. An id that is already a complete on-disk release rolls back to it and does not rebuild. |
| `push_acr` | `false` | Also push container images. Ignored when ACR secrets are missing. |

`deploy_ecs=true` needs `ECS_HOST`, `ECS_USER`, and `ECS_SSH_KEY` and/or `ECS_SSH_PASSWORD`. `ECS_USER` must be root, or have passwordless sudo for `systemctl`, `chown`, and `runuser`. The host needs Node.js 20 or newer at `/usr/bin/node`, npm, and a path to the npm registry: `npm ci` runs on the server so native modules match that Node. It runs before `current` moves, so a registry failure leaves the live release in place.

Publish then:

1. Packs dist, resources, `agent-skills`, `agent-knowledge`, and the workspace manifests. The tarball has no `node_modules` and no `.env`.
2. Extracts `/opt/keduoduo-crm/releases/<id>/`.
3. Runs `npm ci --omit=dev --ignore-scripts` on the server as `keduoduo-crm`.
4. Links `shared/.env` with `ln -sfn` (the same link `deploy-ubuntu.sh` uses). A regular `.env` file inside the release is refused, not overwritten.
5. Runs `backend/dist/migrate-mysql.js` with that env. The file itself is not modified.
6. Points `current` at the new release.
7. Restarts systemd unit `keduoduo-crm`.
8. Requires `curl -fsS http://127.0.0.1:4188/api/health` or `http://127.0.0.1/api/health` to contain `"ok": true`.

If the unit is missing, the script stops with the expected unit name and command. It does not guess another process manager. `SERVICE_NAME` or `RESTART_COMMAND` can override that on the server; CI sets `SERVICE_NAME=keduoduo-crm` and does not set `RESTART_COMMAND`.

If health fails after the symlink moves, `current` is pointed back at the previous release and the unit is restarted again. Schema changes made by the migration are not reversed. The new directory is left in place so it can be inspected. A failure before the symlink move deletes the incomplete directory.

`npm ci --ignore-scripts` does not download a Puppeteer browser. `/api/health` does not need one. If a later feature needs that browser, install it on the host or set a shared Puppeteer cache; do not commit it.

Uploads stay where the running env says. This job does not copy `uploads/` between releases. To keep files across releases, set `KEDUODUO_UPLOADS_DIR` in `shared/.env` to a directory outside the release.

Deploys use one concurrency group, `ecs-keduoduo-crm-node-release`. A second deploy waits. Push builds do not take that lock. The SSH steps pass `script_path` (`deploy/node-releases/ssh-probe-release.sh` and `ssh-activate-release.sh`) so the remote shell receives one script. They do not set `script_stop`. drone-ssh 1.8.0, which `appleboy/ssh-action@v1.2.0` downloads, inserts an exit-check after every line when that flag is on. That check split the activate `case` and failed run 41183804000 with `bash: -c: line 9: syntax error near unexpected token ';'`. Fail-fast is `set -euo pipefail` in the script files.

## Rollback

Preferred: run **workflow_dispatch** with `deploy_ecs=true` and `release_id` set to an existing directory name, for example `20261029012526`. The probe waits until `verify-scripts` succeeds, then only checks that the directory already has `backend/dist/server.js`, `frontend/dist/index.html`, and `express`. It does not build, pack, or migrate. It flips `current`, restarts, and health-checks. `push_acr` does not run on that path, because the build job is skipped.

If Actions cannot run, on the server:

```bash
sudo ln -sfn /opt/keduoduo-crm/releases/20261029012526 /opt/keduoduo-crm/current
sudo systemctl restart keduoduo-crm
curl -fsS http://127.0.0.1:4188/api/health
```

Use the real previous directory. Do not edit `shared/.env`. Do not delete `current` unless you intend to stop serving that tree.

Old release directories are kept. Remove one only after `readlink -f /opt/keduoduo-crm/current` shows a different directory and you no longer need that id for rollback.

## ACR is optional

Image push does not run on push or on pull_request. Set `push_acr=true` on a manual run to build and push `backend`, `gateway`, and `communication`. The job checks `ACR_USERNAME` and `ACR_PASSWORD` in a step. If either is missing, it skips the push and stays green, so a Node release deploy in the same run is not failed by ACR. `push-acr` needs a successful `build`.

Image tags are `<product version>-<short sha>`, the git tag, or the manual `release_id` when one was typed. The ECS directory id is the UTC timestamp unless `release_id` was set. Those two ids are allowed to differ.

The ECS host does not need those images for Path B.

## Secrets

Store values only in GitHub Actions secrets. Do not commit them, `deploy.env`, or `shared/.env`.

ECS, only when `deploy_ecs=true`:

- `ECS_HOST`
- `ECS_USER`
- `ECS_SSH_KEY`
- `ECS_SSH_PASSWORD`

ACR, optional:

- `ACR_USERNAME`
- `ACR_PASSWORD`

## What was retired for this host

The previous workflow SSHed to `/opt/keduoduocrm/ops/baota-update.sh`. That path is the Docker/Baota layout (`deploy/docker-compose/DOCKER-BAOTA-INSTALL.md`). It is the wrong root and the wrong process model for this ECS. The workflow file that did that has been removed. Nothing in `.github/workflows` calls it.

`deploy/docker-compose/` remains the install notes for a different Docker host. Do not point it at `/opt/keduoduo-crm`.
