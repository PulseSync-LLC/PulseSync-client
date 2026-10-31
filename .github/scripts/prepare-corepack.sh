#!/usr/bin/env bash
set -euo pipefail

export COREPACK_NPM_REGISTRY=https://registry.npmjs.org
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

corepack enable
for attempt in 1 2 3; do
    if corepack install; then
        yarn --version
        exit 0
    fi
    if [ "$attempt" -eq 3 ]; then exit 1; fi
    echo "Corepack download failed; retrying in 5 seconds ($attempt/3)" >&2
    sleep 5
done
