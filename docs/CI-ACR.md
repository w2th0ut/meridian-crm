# CI: ACR images are optional

The live ECS is a Node release tree, not Docker/Baota. Operators should use [CI-NODE-RELEASES.md](./CI-NODE-RELEASES.md).

Workflow: `.github/workflows/deploy-node-release.yml`.

- A pull request into `master` runs `verify-scripts`, then `build`. It does not SSH and it does not push images.
- A push to `master` or a version tag **verifies, then builds only**. It does not SSH and it does not push images.
- Container images are pushed only when a manual run sets `push_acr=true` and both `ACR_USERNAME` and `ACR_PASSWORD` are set. Missing ACR secrets skip the image push and do not fail the Node build or an ECS deploy in the same run.
- Updating this host is `workflow_dispatch` with `deploy_ecs=true`. That publishes `/opt/keduoduo-crm/releases/<id>` and moves `current`. It does not call `baota-update.sh`.

The old SSH entry (`/opt/keduoduocrm/ops/baota-update.sh`) is retired for this host. `deploy/docker-compose/DOCKER-BAOTA-INSTALL.md` describes a different Docker install and must not be run against `/opt/keduoduo-crm`.
