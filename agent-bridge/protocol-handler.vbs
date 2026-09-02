' Handler del protocolo hermesagent:// — abre carpeta o archivo en el PC de Cris.
' Uso desde la app: hermesagent://open?path=<folder>  → Explorador
'                    hermesagent://file?path=<archivo.md> → Bloc de notas
' La web no puede abrir rutas locales por seguridad; este puente de Windows sí.
On Error Resume Next
Dim raw, mode, path
raw = WScript.Arguments(0)
If InStr(raw, "?path=") > 0 Then
  mode = "open"
  If InStr(raw, "://file?") > 0 Then mode = "file"
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
  ' saneo: solo rutas absolutas de este PC
  If Len(path) > 4 And (Mid(path, 2, 2) = ":\" Or Left(path, 2) = "\\") Then
    If mode = "file" Then
      CreateObject("WScript.Shell").Run "notepad.exe """ & path & """", 1, False
    Else
      CreateObject("WScript.Shell").Run "explorer.exe """ & path & """", 1, False
    End If
  End If
End If
