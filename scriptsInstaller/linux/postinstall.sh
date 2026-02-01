#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/PulseSync"

if [[ -d "${APP_DIR}" ]]; then
  chmod -R a+rX "${APP_DIR}"
  chmod a+rx "${APP_DIR}"

  if [[ -f "${APP_DIR}/pulsesync" ]]; then
    chmod a+rx "${APP_DIR}/pulsesync"
  fi
fi