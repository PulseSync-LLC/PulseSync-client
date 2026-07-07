!macro preInit
    SetRegView 64
    WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\PulseSync"
    WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\PulseSync"
    SetRegView 32
    WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\PulseSync"
    WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\PulseSync"
!macroend

!macro customHeader
    !undef APP_EXECUTABLE_FILENAME
    !define APP_EXECUTABLE_FILENAME "bootstrapper\pulsesync-bootstrapper.exe"
!macroend

!macro customUnInstall
!macroend
