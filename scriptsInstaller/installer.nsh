!macro preInit
    SetRegView 64
    WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\PulseSync"
    WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\PulseSync"
    SetRegView 32
    WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\PulseSync"
    WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\PulseSync"
!macroend

!macro customCreateShortcuts
    ReadRegStr $0 HKLM "${INSTALL_REGISTRY_KEY}" "InstallLocation"
    StrCmp $0 "" create_shortcuts skip_shortcuts

create_shortcuts:
    CreateDirectory "$SMPROGRAMS\PulseSync"
    CreateShortcut "$SMPROGRAMS\PulseSync\PulseSync.lnk" "$INSTDIR\PulseSync.exe" "" "$INSTDIR\icons\icon.ico"
    CreateShortcut "$DESKTOP\PulseSync.lnk"       "$INSTDIR\PulseSync.exe" "" "$INSTDIR\icons\icon.ico"
    Goto end

skip_shortcuts:
end:
!macroend

!macro customUnInstall
!macroend
