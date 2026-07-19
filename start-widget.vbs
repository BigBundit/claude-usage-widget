' Double-click to launch the widget silently (no console window)
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = dir
shell.Run """" & dir & "\node_modules\electron\dist\electron.exe"" """ & dir & """", 0, False
