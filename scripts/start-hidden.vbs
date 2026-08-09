' Rey de la Chelada - start-hidden.vbs
' Launches node server/index.js detached (no console window).
' Lives next to start.bat in the scripts folder.

Dim fso
Set fso = CreateObject("Scripting.FileSystemObject")
Dim scriptFolder
scriptFolder = fso.GetParentFolderName(WScript.ScriptFullName)
Dim root
root = fso.GetParentFolderName(scriptFolder)  ' scripts/ -> app root

Dim shell
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = root
shell.Run "cmd /c node --env-file-if-exists=.env server/index.js", 0, False
