; Removes the "start with Windows" entry that the app adds (see AUTOSTART_NAME in src/lib.rs).
; Updates run the old uninstaller too, so skip it then and keep the person's choice.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Novaroom"
  ${EndIf}
!macroend
