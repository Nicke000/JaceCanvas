Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
AppDir = FSO.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = AppDir
ElectronExe = AppDir & "\node_modules\electron\dist\electron.exe"
If Not FSO.FileExists(ElectronExe) Then
    MsgBox "Electron not installed", 48, "AI Canvas"
    WScript.Quit 1
End If
If Not FSO.FileExists(AppDir & "\dist\index.html") Then
    MsgBox "Frontend not found", 48, "AI Canvas"
    WScript.Quit 1
End If
WshShell.Run """" & ElectronExe & """ . --dev", 0, False


