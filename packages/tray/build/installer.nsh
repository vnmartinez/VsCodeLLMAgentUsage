; Autostart por usuário: o instalador é o dono da entrada (o app não mexe no registro em runtime).
!macro customInstall
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Agent Usage" '"$INSTDIR\Agent Usage.exe"'
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Agent Usage"
!macroend
