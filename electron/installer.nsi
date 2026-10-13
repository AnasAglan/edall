Unicode true
Name "EdAll"
OutFile "/tmp/edall-v2/EdAll-Setup-v2.exe"
InstallDir "$LOCALAPPDATA\Programs\EdAll"
RequestExecutionLevel user
SetCompressor /SOLID lzma
Icon "/tmp/edall-v2/icon.ico"
UninstallIcon "/tmp/edall-v2/icon.ico"
!include "MUI2.nsh"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\EdAll.exe"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Section "EdAll"
  SetOutPath "$INSTDIR"
  File /r "/tmp/edall-v2/runtime/*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\EdAll.lnk" "$INSTDIR\EdAll.exe"
  CreateDirectory "$SMPROGRAMS\EdAll"
  CreateShortcut "$SMPROGRAMS\EdAll\EdAll.lnk" "$INSTDIR\EdAll.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\EdAll" "DisplayName" "EdAll"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\EdAll" "UninstallString" '"$INSTDIR\Uninstall.exe"'
SectionEnd
Section "Uninstall"
  Delete "$DESKTOP\EdAll.lnk"
  RMDir /r "$SMPROGRAMS\EdAll"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\EdAll"
  RMDir /r "$INSTDIR"
SectionEnd