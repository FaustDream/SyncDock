Option Explicit

' SyncDock 5.0 silent launcher.
' Keep this VBS file ASCII-only because Windows Script Host may parse UTF-8 comments as ANSI.

Dim fso
Dim shell
Dim scriptDir
Dim launcher
Dim command

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

' Resolve the project root from this VBS file, not from the process working directory.
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
launcher = fso.BuildPath(scriptDir, "gui_launcher.py")

If Not fso.FileExists(launcher) Then
    MsgBox "GUI launcher not found:" & vbCrLf & launcher, vbCritical, "SyncDock startup failed"
    WScript.Quit 1
End If

' Run Python from the project root so config, static files, and packages resolve correctly.
shell.CurrentDirectory = scriptDir
command = "py -3 " & Chr(34) & launcher & Chr(34)

shell.Run command, 0, False
