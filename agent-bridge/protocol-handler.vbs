' Handler del protocolo hermesagent:// — abre carpeta, archivo, el .md más
' reciente de una carpeta, o la sesión de ZCode de una tarea, en el PC de Cris.
'   hermesagent://open?path=<carpeta>              → Explorador
'   hermesagent://file?path=<archivo>              → Bloc de notas
'   hermesagent://md?path=<carpeta>                → el .md modificado más
'                                                    reciente (búsqueda
'                                                    recursiva, sin
'                                                    node_modules/backups; si
'                                                    no hay, abre la carpeta)
'   hermesagent://zcode?path=<carpeta>&session=<sess_..>
'                                                  → terminal interactiva con
'                                                    ZCode retomando la sesión
'                                                    (--resume): chatear con el
'                                                    agente que hizo la tarea,
'                                                    con todo su contexto.
' La web no puede abrir rutas locales por seguridad; este puente de Windows sí.
On Error Resume Next
Dim raw, mode, path, session, fso
raw = WScript.Arguments(0)
mode = "open"
If InStr(raw, "://file?") > 0 Then mode = "file"
If InStr(raw, "://md?") > 0 Then mode = "md"
If InStr(raw, "://zcode?") > 0 Then mode = "zcode"

' Parsear el query string (key=value separado por &)
Dim qs, parts, i, pair, eq
path = ""
session = ""
If InStr(raw, "?") > 0 Then
  qs = Mid(raw, InStr(raw, "?") + 1)
  parts = Split(qs, "&")
  For i = 0 To UBound(parts)
    pair = parts(i)
    eq = InStr(pair, "=")
    If eq > 0 Then
      If LCase(Left(pair, eq - 1)) = "path" Then path = URLDecode(Mid(pair, eq + 1))
      If LCase(Left(pair, eq - 1)) = "session" Then session = URLDecode(Mid(pair, eq + 1))
    End If
  Next
End If

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
  ElseIf mode = "zcode" Then
    ' La sesión va a parar a una línea de comandos: solo tokens seguros
    ' (sess_ + hex/guiones/guion_bajo) para que nadie pueda inyectar nada.
    If Len(session) > 10 And IsSafeToken(session) Then
      ' cmd /k deja la ventana abierta con el TUI interactivo de ZCode.
      CreateObject("WScript.Shell").Run _
        "cmd /k cd /d """ & path & """ && node ""C:\Users\patag\AppData\Local\Programs\ZCode\resources\glm\zcode.cjs"" --resume " & session, _
        1, False
    End If
  Else
    CreateObject("WScript.Shell").Run "explorer.exe """ & path & """", 1, False
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

' Decodificación mínima de URL (los caracteres que encodeURIComponent escapa
' en rutas de Windows).
Function URLDecode(s)
  Dim r
  r = s
  r = Replace(r, "%5C", "\")
  r = Replace(r, "%3A", ":")
  r = Replace(r, "%2F", "/")
  r = Replace(r, "%20", " ")
  r = Replace(r, "%C3%B1", "ñ")
  r = Replace(r, "%C3%A9", "é")
  r = Replace(r, "%C3%AD", "í")
  r = Replace(r, "%C3%B3", "ó")
  r = Replace(r, "%C3%BA", "ú")
  r = Replace(r, "%C3%81", "Á")
  r = Replace(r, "%26", "&")
  URLDecode = r
End Function

' true si todos los caracteres son [A-Za-z0-9_-] (ids de sesión: sess_<hex>).
Function IsSafeToken(s)
  Dim i, code
  IsSafeToken = True
  For i = 1 To Len(s)
    code = AscW(Mid(s, i, 1))
    If Not ((code >= 48 And code <= 57) Or (code >= 65 And code <= 90) _
         Or (code >= 97 And code <= 122) Or code = 45 Or code = 95) Then
      IsSafeToken = False
      Exit Function
    End If
  Next
End Function
