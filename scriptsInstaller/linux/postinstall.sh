#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/PulseSync"
MIME_XML_PATH="/usr/share/mime/packages/pulsesync.xml"
MIME_DB_DIR="/usr/share/mime"
DESKTOP_FILE="pulsesync.desktop"
ICON_SRC="${APP_DIR}/resources/assets/pext/pext.png"
ICON_DEST_DIR="/usr/share/icons/hicolor/256x256/mimetypes"
ICON_NAME="application-x-pext.png"

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

if [[ -f "${ICON_SRC}" ]]; then
  if command -v xdg-icon-resource >/dev/null 2>&1; then
    xdg-icon-resource install --context mimetypes --size 256 "${ICON_SRC}" application-x-pext || true
  else
    install -Dm644 "${ICON_SRC}" "${ICON_DEST_DIR}/${ICON_NAME}"
  fi
  if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -f /usr/share/icons/hicolor || true
  fi
fi