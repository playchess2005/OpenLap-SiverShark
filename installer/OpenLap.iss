; OpenLap.iss — Inno Setup script
;
; Builds a friendly Windows installer for OpenLap, replacing the manual
; "download zip, extract, unblock the DLL" flow. Files written by an
; installer do not inherit the Mark-of-the-Web zone tag that Windows
; Explorer propagates onto files extracted from a downloaded zip, which
; is what causes the "Failed to resolve Python.Runtime.Loader.Initialize"
; pythonnet/pywebview crash on first run.
;
; Build (after `pyinstaller OpenLap.spec --clean -y` has populated dist\OpenLap):
;   iscc installer\OpenLap.iss
;
; Output: installer\Output\OpenLap-Setup-<version>.exe

#define MyAppName "OpenLap"
#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif
#define MyAppPublisher "OpenLap"
#define MyAppURL "https://github.com/LaurensVR3/OpenLap"
#define MyAppExeName "OpenLap.exe"

[Setup]
; Fixed AppId so upgrades replace the previous install instead of side-by-side installing.
AppId={{9F2B6C2E-9C7E-4B7B-9C7B-3E7B9C1F2A11}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}/issues
AppUpdatesURL={#MyAppURL}/releases
; Per-user install by default: no UAC prompt, no admin rights required.
DefaultDirName={autopf}\OpenLap
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
DefaultGroupName=OpenLap
DisableProgramGroupPage=yes
OutputDir=Output
OutputBaseFilename=OpenLap-Setup-{#MyAppVersion}
SetupIconFile=..\frontend\icon.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
LicenseFile=..\LICENSE
UninstallDisplayIcon={app}\{#MyAppExeName}
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
; Everything PyInstaller produced (OpenLap.exe + _internal\...), written fresh
; to disk by the installer — no MOTW zone tag, no manual "unblock" step needed.
Source: "..\dist\OpenLap\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\OpenLap"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall OpenLap"; Filename: "{uninstallexe}"
Name: "{autodesktop}\OpenLap"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,OpenLap}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Remove files OpenLap writes into its own install dir at runtime (e.g. the
; Linux icon PNG cache); user data under %USERPROFILE%\.openlap is untouched.
Type: filesandordirs; Name: "{app}\frontend\.icon_linux_runtime.png"
