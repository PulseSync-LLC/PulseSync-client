#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/PulseSync"
MIME_XML_PATH="/usr/share/mime/packages/pulsesync.xml"
MIME_DB_DIR="/usr/share/mime"
DESKTOP_FILE="pulsesync.desktop"

if [[ -d "${APP_DIR}" ]]; then
  chmod -R a+rX "${APP_DIR}"
  chmod a+rx "${APP_DIR}"

  if [[ -f "${APP_DIR}/pulsesync" ]]; then
    chmod a+rx "${APP_DIR}/pulsesync"
  fi
fi

cat > "${MIME_XML_PATH}" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
  <mime-type type="application/x-pext">
    <comment>PulseSync extension</comment>
    <glob pattern="*.pext"/>
  </mime-type>
</mime-info>
EOF

if command -v update-mime-database >/dev/null 2>&1; then
  update-mime-database "${MIME_DB_DIR}" || true
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database || true
fi

if command -v xdg-mime >/dev/null 2>&1; then
  xdg-mime default "${DESKTOP_FILE}" application/x-pext || true
fi