#!/usr/bin/env bash
set -euo pipefail

# Prerequisites: run `npm install` and configure `.env.local` before this script.
# This script starts both development databases, then runs Next.js in the
# foreground. The database containers remain running when the dev server stops.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Keep development containers and volumes isolated from the production stack.
docker compose -p v7-chat-dev up -d db intermediate-db
exec npm run dev
