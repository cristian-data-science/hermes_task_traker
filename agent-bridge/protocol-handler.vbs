' Handler del protocolo hermesagent:// — abre carpeta, archivo o el .md más
' reciente de una carpeta, en el PC de Cris.
'   hermesagent://open?path=<carpeta>   → Explorador
'   hermesagent://file?path=<archivo>   → Bloc de notas
'   hermesagent://md?path=<carpeta>     → el .md modificado más reciente
'                                         (búsqueda recursiva, sin
'                                          node_modules/backups; si no hay,
'                                          abre la carpeta)
' La web no puede abrir rutas locales por seguridad; este puente de Windows sí.
On Error Resume Next
Dim raw, mode, path
raw = WScript.Arguments(0)
If InStr(raw, "?path=") > 0 Then
  mode = "open"
  If InStr(raw, "://file?") > 0 Then mode = "file"
  If InStr(raw, "://md?") > 0 Then mode = "md"
  path = Mid(raw, InStr(raw, "?path=") + 6)
  ' decodificación mínima de URL
  path = Replace(path, "%5C", "\")
  path = Replace(path, "%3A", ":")
  path = Replace(path, "%2F", "/")
  path = Replace(path, "%20", " ")
  path = Replace(path, "%C3%B1", "ñ")
  path = Replace(path, "%C3%A9", "é")
  path = Replace(path, "%C3%AD", "í")
  path = Replace(path, "%C3%B3", "ó")
  path = Replace(path, "%C3%BA", "ú")
  path = Replace(path, "%C3%81", "Á")
  path = Replace(path, "%26", "&")
  path = Replace(path, "+", " ")
  ' saneo: solo rutas absolutas de este PC
  If Len(path) > 4 And (Mid(path, 2, 2) = ":\" Or Left(path, 2) = "\\") Then
    If mode = "file" Then
      CreateObject("WScript.Shell").Run "notepad.exe """ & path & """", 1, False
    ElseIf mode = "md" Then
      Dim newestPath, newestDate
      newestPath = ""
      Set fso = CreateObject("Scripting.FileSystemObject")
      If fso.FolderExists(path) Then ScanFolder fso.GetFolder(path)
      If newestPath <> "" Then
        CreateObject("WScript.Shell").Run "notepad.exe """ & newestPath & """", 1, False
      Else
        CreateObject("WScript.Shell").Run "explorer.exe """ & path & """", 1, False
      End If
    Else
      CreateObject("WScript.Shell").Run "explorer.exe """ & path & """", 1, False
    End If
  End If
End If
WScript.Quit

Sub ScanFolder(folder)
  Dim f, sf
  For Each f In folder.Files
    If LCase(fso.GetExtensionName(f.Name)) = "md" Then
      If newestPath = "" Or f.DateLastModified > newestDate Then
        newestPath = f.Path
        newestDate = f.DateLastModified
      End If
    End If
  Next
  For Each sf In folder.SubFolders
    If InStr(LCase(sf.Name), "node_modules") = 0 _
       And InStr(LCase(sf.Name), "backups") = 0 _
       And InStr(LCase(sf.Name), ".git") = 0 Then
      ScanFolder sf
    End If
  Next
End Sub
