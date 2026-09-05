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
'
' IMPORTANTE (bug sufrido): Windows NO siempre entrega la URL tal cual — puede
' llegar "hermesagent://zcode/?path=..." con barra antes del "?", en minúsculas
' o sin "//". Por eso el modo se detecta por el HOST (segmento entre el esquema
' y el "?", sin barras y en minúsculas) y NUNCA con InStr de un string exacto:
' si no matcheaba, el modo quedaba "open" y abría el Explorador en vez de
' ZCode. Además cada invocación queda logueada en protocol.log para poder
' diagnosticar qué llegó realmente.
On Error Resume Next
Dim raw, mode, path, session, fso
raw = WScript.Arguments(0)

' ===== Log de diagnóstico: qué llegó exactamente por la URL =====
Set fso = CreateObject("Scripting.FileSystemObject")
Dim logOut
On Error Resume Next
Set logOut = fso.OpenTextFile("C:\Users\patag\git_provisorio\hermes_task_traker\agent-bridge\protocol.log", 8, True)
If Not logOut Is Nothing Then
  logOut.WriteLine Now & " | " & raw
  logOut.Close
End If
On Error Resume Next

' ===== Detectar el modo por el HOST del protocolo =====
' body = lo que sigue al esquema (con o sin "//"); host = hasta el "?".
Dim body, hostPart, qs
mode = "open"
body = raw
If InStr(body, "://") > 0 Then
  body = Mid(body, InStr(body, "://") + 3)
Else
  body = Mid(body, InStr(body, ":") + 1)
End If
If InStr(body, "?") > 0 Then
  hostPart = Left(body, InStr(body, "?") - 1)
  qs = Mid(body, InStr(body, "?") + 1)
Else
  hostPart = body
  qs = ""
End If
hostPart = LCase(Replace(hostPart, "/", ""))
If hostPart = "file" Then
  mode = "file"
ElseIf hostPart = "md" Then
  mode = "md"
ElseIf hostPart = "zcode" Then
  mode = "zcode"
End If

' ===== Parsear el query string (key=value separado por &) =====
Dim parts, i, pair, eq
path = ""
session = ""
If qs <> "" Then
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

' ===== Ejecutar el modo =====
' saneo: solo rutas absolutas de este PC
If Len(path) > 4 And (Mid(path, 2, 2) = ":\" Or Left(path, 2) = "\\") Then
  If mode = "file" Then
    CreateObject("WScript.Shell").Run "notepad.exe """ & path & """", 1, False
  ElseIf mode = "md" Then
    Dim newestPath, newestDate
    newestPath = ""
    If fso.FolderExists(path) Then ScanFolder fso.GetFolder(path)
    If newestPath <> "" Then
      CreateObject("WScript.Shell").Run "notepad.exe """ & newestPath & """", 1, False
    Else
      CreateObject("WScript.Shell").Run "explorer.exe """ & path & """", 1, False
    End If
  ElseIf mode = "zcode" Then
    ' Chat WEB local con la sesión EXACTA del agente (zchat-server): página de
    ' chat en el navegador con la estética de Hermes — burbujas, markdown,
    ' spinner — respondiendo con zcode -p --resume contra la sesión exacta.
    ' El servidor corre oculto, se abre solo en el navegador y se auto-apaga a
    ' los 30 min de inactividad (o con el botón "cerrar chat").
    ' Por qué no el desktop ni el TUI: ver comentarios en zchat-server.mjs.
    ' Sesión validada (solo [A-Za-z0-9_-]).
    If Len(session) > 10 And IsSafeToken(session) Then
      CreateObject("WScript.Shell").Run _
        "node --no-warnings ""C:\Users\patag\git_provisorio\hermes_task_traker\agent-bridge\zchat-server.mjs"" " & session & " """ & path & """", _
        0, False
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

' Codifica un valor para usarlo como parámetro de URL (percent-encoding de
' todo lo que no sea [A-Za-z0-9-_.~]).
Function URLEnc(s)
  Dim r, i, c, code
  r = ""
  For i = 1 To Len(s)
    c = Mid(s, i, 1)
    code = AscW(c)
    If (code >= 48 And code <= 57) Or (code >= 65 And code <= 90) _
       Or (code >= 97 And code <= 122) Or code = 45 Or code = 46 _
       Or code = 95 Or code = 126 Then
      r = r & c
    Else
      r = r & "%" & Right("0" & Hex(code), 2)
    End If
  Next
  URLEnc = r
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
