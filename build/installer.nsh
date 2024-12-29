!macro preInit
    SetRegView 64
    WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\PulseSync"
    WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\PulseSync"
    SetRegView 32
    WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\PulseSync"
    WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\PulseSync"
!macroend

!define CONFIG_FILE "$APPDATA\PulseSync\config.json"

Section "Install"
    IfFileExists "${CONFIG_FILE}" 0 +2
    Delete "${CONFIG_FILE}"
SectionEnd
