#!/usr/bin/env bash
set -euo pipefail

# Prerequisites: run `npm install` and configure `deploy/aws.env` before this
# script. The production stack reads its settings from that env file.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Pin the production project name so it cannot overlap with development.
docker compose \
  -p v7-chat \
  --env-file deploy/aws.env \
  -f docker-compose.prod.yml \
  up -d --build

docker compose \
  -p v7-chat \
  --env-file deploy/aws.env \
  -f docker-compose.prod.yml \
  ps
