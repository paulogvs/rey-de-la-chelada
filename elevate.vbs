' Rey de la Chelada - Elevate.vbs
' Self-elevates setup.bat to Administrator.
' Runs from the same folder as setup.bat (APP_DIR).
' Handles paths with spaces correctly.

' Determine the folder where this script lives
Dim fso
Set fso = CreateObject("Scripting.FileSystemObject")
Dim scriptFolder
scriptFolder = fso.GetParentFolderName(WScript.ScriptFullName)

Dim shell
Set shell = CreateObject("Shell.Application")
shell.ShellExecute scriptFolder & "\setup.bat", "", scriptFolder, "runas", 1
