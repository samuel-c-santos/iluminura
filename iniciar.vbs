Option Explicit

Dim shell, fso, folder, nodeOk

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

folder = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = folder

nodeOk = shell.Run("cmd /c where node >nul 2>nul", 0, True)

If nodeOk <> 0 Then
  MsgBox "Node.js nao encontrado." & vbCrLf & vbCrLf & _
    "Instale o Node.js (https://nodejs.org) para abrir e salvar arquivos e pastas." & vbCrLf & _
    "O Iluminura sera aberto agora sem o servidor local.", 48, "Iluminura"
  shell.Run """" & folder & "\index.html""", 1, False
  WScript.Quit
End If

shell.Environment("PROCESS")("ILUMINURA_HIDDEN") = "1"
shell.Run "cmd /c node ""servidor.js""", 0, False
