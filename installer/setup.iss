; Build: iscc /DMyVersion=1.2.3 /DSrc=..\dist\app installer\setup.iss
#ifndef MyVersion
  #define MyVersion "0.0.0"
#endif
#ifndef Src
  #define Src "..\dist\app"
#endif
[Setup]
AppId={{B6F1C7A2-4E1D-4D8B-9C61-3F2A8D7E5B40}
AppName=AI Music Video Tool
AppVersion={#MyVersion}
AppPublisher=Bentar
DefaultDirName={localappdata}\Programs\AI Music Video Tool
DefaultGroupName=AI Music Video Tool
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
OutputDir=..\dist
OutputBaseFilename=AI-Music-Video-Setup-{#MyVersion}
Compression=lzma2
SolidCompression=yes
UninstallDisplayIcon={app}\AI Music Video.exe

[Files]
Source: "{#Src}\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{group}\AI Music Video Tool"; Filename: "{app}\AI Music Video.exe"; WorkingDir: "{app}"
Name: "{group}\Dung AI Music Video Tool"; Filename: "{app}\stop.bat"; WorkingDir: "{app}"
Name: "{userdesktop}\AI Music Video Tool"; Filename: "{app}\AI Music Video.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Tao bieu tuong ngoai Desktop"

[Run]
Filename: "{app}\AI Music Video.exe"; Description: "Mo AI Music Video Tool"; Flags: postinstall nowait

[UninstallRun]
Filename: "powershell"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\stop.ps1"""; Flags: runhidden; RunOnceId: "StopTool"
