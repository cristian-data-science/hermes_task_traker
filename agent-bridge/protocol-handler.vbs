' Handler del protocolo hermesagent:// — abre carpeta, archivo, el .md más
' reciente de una carpeta, o la sesión del agente (ZCode/Claude) de una tarea.
'   hermesagent://open?path=<carpeta>              → Explorador
'   hermesagent://file?path=<archivo>              → Bloc de notas
'   hermesagent://md?path=<carpeta>[&since=<epoch-ms>]
'                                                  → el .md modificado más
'                                                    reciente de esa carpeta
'                                                    (búsqueda recursiva, sin
'                                                    node_modules/backups/
'                                                    carpetas ocultas), SOLO
'                                                    si es posterior a since
'                                                    (inicio de la corrida; si
'                                                    no viene, últimas 48 h).
'                                                    Sin candidato fresco →
'                                                    aviso, NADA se abre (no
'                                                    vale abrir cualquier .md
'                                                    viejo de la carpeta).
'   hermesagent://zcode?path=<carpeta>&session=<sess_..>[&task=<id>&p64=..&st=..&ag=..&th=..]
'   hermesagent://claude?path=<carpeta>&session=<uuid>[&task=<id>&...]
'                                                  → chat WEB local (zchat-server)
'                                                    contra la sesión EXACTA del
'                                                    agente que hizo la tarea:
'                                                    historial, respuesta en vivo
'                                                    y panel de misión en vivo
'                                                    (task → Convex). El host
'                                                    decide el motor (zcode |
'                                                    claude).
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
Dim raw, mode, path, session, fso, cutoffMd
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
Dim body, hostPart, qs, agentKind
mode = "open"
agentKind = "zcode"
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
ElseIf hostPart = "pick" Then
  mode = "pick"
ElseIf hostPart = "zcode" Then
  mode = "zcode"
  agentKind = "zcode"
ElseIf hostPart = "claude" Then
  mode = "zcode"
  agentKind = "claude"
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

' ===== Modo pick: selector NATIVO de carpetas/archivos para la web =====
' La web abre hermesagent://pick?kind=folder|files&key=<id>; acá se lanza el
' picker local (diálogo de Windows) que publica el resultado en Convex con
' las credenciales del puente. No requiere path.
If mode = "pick" Then
  Dim pkKind, pkKey
  pkKind = qsValue(qs, "kind")
  pkKey = qsValue(qs, "key")
  If (pkKind = "folder" Or pkKind = "files") And Len(pkKey) > 7 And IsSafeToken(pkKey) Then
    CreateObject("WScript.Shell").Run _
      "node --no-warnings ""C:\Users\patag\git_provisorio\hermes_task_traker\agent-bridge\picker.mjs"" " & pkKey & " " & pkKind, _
      0, False
  End If
  WScript.Quit
End If

' ===== Ejecutar el modo =====
' saneo: solo rutas absolutas de este PC
If Len(path) > 4 And (Mid(path, 2, 2) = ":\" Or Left(path, 2) = "\\") Then
  If mode = "file" Then
    CreateObject("WScript.Shell").Run "notepad.exe """ & path & """", 1, False
  ElseIf mode = "md" Then
    Dim newestPath, newestDate, sinceRaw, sinceMs, nowMs
    newestPath = ""
    ' Corte de frescura: &since=<epoch-ms> (inicio de la corrida, lo manda la
    ' app) o, si no viene, las últimas 48 h. Un .md más viejo NO se abre: era
    ' el bug (abría cualquier plan viejo de la carpeta cuando la corrida no
    ' generó reporte).
    nowMs = (Now - DateSerial(1970, 1, 1)) * 86400000
    sinceRaw = qsValue(qs, "since")
    If IsNumeric(sinceRaw) And Len(sinceRaw) >= 8 Then
      sinceMs = CDbl(sinceRaw)
    Else
      sinceMs = nowMs - 48 * 3600000
    End If
    If sinceMs > nowMs Then sinceMs = nowMs - 3600000
    cutoffMd = Now - (nowMs - sinceMs) / 86400000
    If fso.FolderExists(path) Then ScanFolder fso.GetFolder(path)
    If newestPath <> "" Then
      CreateObject("WScript.Shell").Run "notepad.exe """ & newestPath & """", 1, False
    Else
      ' Sin candidato fresco: avisar y no abrir NADA (menos todavía un .md
      ' cualquiera de la carpeta).
      MsgBox "No se encontró ningún reporte .md modificado desde el " & _
             FormatDateTime(cutoffMd, vbGeneralDate) & " en:" & vbCrLf & _
             path & vbCrLf & vbCrLf & _
             "Probablemente la corrida no generó un reporte .md. " & _
             "Revisa la carpeta o el resultado en la app.", _
             64, "Hermes — Reporte no encontrado"
    End If
  ElseIf mode = "zcode" Then
    ' Chat WEB local con la sesión EXACTA del agente (zchat-server): página de
    ' chat en el navegador con estética Hermes — historial completo, respuesta
    ' EN VIVO (streaming desde la DB de sesiones, la misma que lee el desktop),
    ' sidebar con el plan de la tarea (p64) y el estado fresco del tracker
    ' (st/ag), que se inyecta en cada pregunta para que el agente no responda
    ' con recuerdos viejos. El servidor corre oculto, abre el navegador solo y
    ' se auto-apaga a los 30 min de inactividad.
    ' Además viaja el id de la tarea (task): con él el servidor se suscribe a
    ' Convex y muestra el plan/estado EN VIVO (no el snapshot del enlace), y el
    ' tema inicial (th: aurora|console|paper) como sugerencia.
    ' Validaciones: sesión, p64 y task son [A-Za-z0-9_-]; st/ag/th palabras
    ' sueltas. Los valores vacíos viajan como "-" para que la POSICIÓN de cada
    ' argumento sea siempre la misma (antes, un p64 vacío corría st al lugar
    ' del plan).
    ' SIN sesión pero CON task válido también se lanza: el botón del tracker
    ' puede abrirse ANTES de que el agente registre su sesión; el server la
    ' adopta apenas Convex la reporte (session pendiente).
    Dim p64, st, ag, tk, th
    p64 = qsValue(qs, "p64")
    st = qsValue(qs, "st")
    ag = qsValue(qs, "ag")
    tk = qsValue(qs, "task")
    th = qsValue(qs, "th")
    If p64 = "" Or Not IsSafeToken(p64) Then p64 = "-"
    If st = "" Or Not IsSafeToken(st) Then st = "-"
    If ag = "" Or Not IsSafeToken(ag) Then ag = "-"
    If th = "" Or Not IsSafeToken(th) Then th = "-"
    Dim sessArg
    If Len(session) > 10 And IsSafeToken(session) Then
      sessArg = session
    ElseIf tk <> "" And IsSafeToken(tk) Then
      ' Sin sesión aún: el server espera la de la tarea (sesión pendiente).
      sessArg = "-"
    Else
      sessArg = ""
    End If
    ' 8º argumento = agente (zcode | claude): el servidor elige adaptador.
    If sessArg <> "" And tk <> "" And IsSafeToken(tk) Then
      CreateObject("WScript.Shell").Run _
        "node --no-warnings ""C:\Users\patag\git_provisorio\hermes_task_traker\agent-bridge\zchat-server.mjs"" " & sessArg & " """ & path & """ " & p64 & " " & st & " " & ag & " " & tk & " " & th & " " & agentKind, _
        0, False
    End If
  Else
    CreateObject("WScript.Shell").Run "explorer.exe """ & path & """", 1, False
  End If
End If
WScript.Quit

Sub ScanFolder(folder)
  Dim f, sf, nm
  For Each f In folder.Files
    If LCase(fso.GetExtensionName(f.Name)) = "md" Then
      ' Solo candidatos FRESCOS (posteriores al corte) y más recientes que
      ' el mejor hasta ahora.
      If f.DateLastModified >= cutoffMd And (newestPath = "" Or f.DateLastModified > newestDate) Then
        newestPath = f.Path
        newestDate = f.DateLastModified
      End If
    End If
  Next
  For Each sf In folder.SubFolders
    nm = LCase(sf.Name)
    ' Excluir ocultas (.git, .zcode, .obsidian…), node_modules y backups.
    If Left(nm, 1) <> "." _
       And InStr(nm, "node_modules") = 0 _
       And InStr(nm, "backups") = 0 Then
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

' Valor decodificado de una key del query string (o "" si no está).
Function qsValue(q, key)
  Dim pp, j, pr, eqp
  qsValue = ""
  If q = "" Then Exit Function
  pp = Split(q, "&")
  For j = 0 To UBound(pp)
    pr = pp(j)
    eqp = InStr(pr, "=")
    If eqp > 0 Then
      If LCase(Left(pr, eqp - 1)) = LCase(key) Then
        qsValue = URLDecode(Mid(pr, eqp + 1))
        Exit Function
      End If
    End If
  Next
End Function
