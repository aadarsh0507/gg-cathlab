#!/usr/bin/env bash
# Manual deployment script — run on the deployment server directly.
# Usage: ./deploy.sh [image-tag]   (defaults to latest)
set -euo pipefail

IMAGE="ghcr.io/aadarsh0507/gg-implants"
TAG="${1:-latest}"
CONTAINER="implant-billing"
ENV_FILE="/opt/implant-billing/.env"
NAS_MOUNT="/mnt/vendor-documents"

echo "=== Pulling ${IMAGE}:${TAG} ==="
docker pull "${IMAGE}:${TAG}"

echo "=== Removing existing container ==="
docker rm -f "${CONTAINER}" || true

echo "=== Starting new container ==="
docker run -d \
  --name "${CONTAINER}" \
  --restart unless-stopped \
  -p 3000:5000 \
  --env-file "${ENV_FILE}" \
  -v "${NAS_MOUNT}:/mnt/vendor-documents" \
  "${IMAGE}:${TAG}"

echo "=== Waiting for startup ==="
sleep 10

echo "=== Container status ==="
docker inspect --format="Running: {{.State.Running}}" "${CONTAINER}"

echo "=== Deployed image SHA ==="
docker inspect --format='{{index .Config.Labels "ci.sha"}}' "${CONTAINER}"

echo "=== Deployed version ==="
docker inspect --format='{{index .Config.Labels "ci.version"}}' "${CONTAINER}"

echo "=== /api/version ==="
curl -sf http://localhost:3000/api/version || echo "Not reachable yet — give it a few more seconds"

echo "=== Pruning dangling images ==="
docker image prune -f

echo "Done."
