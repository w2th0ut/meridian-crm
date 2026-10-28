# CI: path A (Baota + Docker + ACR)

Workflow: `.github/workflows/deploy-acr.yml`.

Push to `master`, or to a tag matching `v*` / `*.*.*`, **builds and pushes ACR images only**. Those runs do not SSH to ECS and do not run `baota-update.sh`.

## Images

From `deploy/docker-compose/deploy.env.example`:

| | |
| --- | --- |
| Registry | `crpi-f1g4pi9vyexdaer5.cn-hongkong.personal.cr.aliyuncs.com` |
| Namespace | `kevin_keduoduocrm` |
| Images | `backend`, `gateway`, `communication` |

Dockerfiles (build context is the repo root):

- `deploy/docker-compose/Dockerfile.backend`
- `deploy/docker-compose/Dockerfile.gateway`
- `deploy/docker-compose/Dockerfile.communication`

Each image is tagged `<release_id>` and `latest`, platform `linux/amd64`. The runner uses Node.js 22, same major as the Dockerfiles and `deploy/docker-compose/build-in-docker.sh`. It installs the root workspaces and `whatsapp-plugin` (its own lockfile; not an npm workspace), runs `npm run build`, then the Dockerfiles copy the `dist` artifacts.

`release_id` (also the image tag and `KEDUODUO_RELEASE_ID`):

1. Manual `release_id` input, when set.
2. Otherwise the git tag name, with one leading `v` removed.
3. Otherwise `<version>-<short sha>` from `frontend/public/product-config.json`.

The id must match `[A-Za-z0-9][A-Za-z0-9_.-]{0,127}`.

ECS pulls public images and does not need `docker login`. The CI push does need ACR credentials.

## ECS is manual

ECS is not touched on push.

To update a server, run the workflow with **workflow_dispatch** and set `deploy_ecs` to **true** (default **false**). That job is the only one that SSHes in. It runs the existing entry:

```bash
/opt/keduoduocrm/ops/baota-update.sh <release_id>
```

That script must already be installed on the server (`deploy/docker-compose/install.sh` and `deploy/docker-compose/DOCKER-BAOTA-INSTALL.md`). After it returns, the job checks `http://127.0.0.1:4188/api/health`.

## GitHub Actions secret names

Store values only in GitHub Actions secrets (or a vault that feeds them). Do not commit values, `deploy.env`, or `/opt/keduoduocrm/shared/secrets`.

Required for every build and push:

- `ACR_USERNAME`
- `ACR_PASSWORD`

Used only by the manual ECS job (`deploy_ecs=true`). Provide a key, a password, or both:

- `ECS_HOST`
- `ECS_USER`
- `ECS_SSH_KEY`
- `ECS_SSH_PASSWORD`

## Rollback

Re-run **workflow_dispatch** with `release_id` set to the previous release id (the prior image tag). Select the git ref that produced that image so the rebuilt tag matches those bits. Set `deploy_ecs=true` only when ECS should pull that tag. Leave it false to republish images and leave the server alone. A push never connects to ECS.
