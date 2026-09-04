' Test del parsing del protocolo (espejo de protocol-handler.vbs SIN ejecutar
' nada): corre con  cscript //nologo scripts\test-protocol-parse.vbs
' Verifica que el modo se detecte bien en TODAS las variantes de URL que
' Windows puede entregar (con/sin barra antes del "?", mayúsculas, sin "//").
Dim raws(4)
raws(0) = "hermesagent://zcode?path=C%3A%5CUsers%5Cpatag%5Crepo&session=sess_abc123def456"
raws(1) = "hermesagent://zcode/?path=C%3A%5CUsers%5Cpatag%5Crepo&session=sess_abc123def456"
raws(2) = "hermesagent:zcode?path=C%3A%5CUsers%5Cpatag%5Crepo&session=sess_abc123def456"
raws(3) = "hermesagent://ZCODE?path=C%3A%5CUsers%5Cpatag%5Crepo&session=sess_abc123def456"
raws(4) = "hermesagent://open?path=C%3A%5CUsers%5Cpatag%5Crepo"

Dim failures
failures = 0
For r = 0 To 4
  raw = raws(r)

  Dim body, hostPart, qs, mode
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

  Dim parts, i, pair, eq, path, session
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

  Dim want
  If r = 4 Then want = "open" Else want = "zcode"
  Dim ok
  ok = (mode = want) And (path = "C:\Users\patag\repo") And (session = "sess_abc123def456" Or r = 4)
  If Not ok Then failures = failures + 1
  WScript.Echo "caso " & r & ": modo=" & mode & " path=" & path & " session=" & session & " → " & IIf(ok, "OK", "FAIL")
Next
WScript.Echo "FAILURES: " & failures
WScript.Quit(failures)

Function IIf(cond, a, b)
  If cond Then IIf = a Else IIf = b
End Function

Function URLDecode(s)
  Dim r
  r = s
  r = Replace(r, "%5C", "\")
  r = Replace(r, "%3A", ":")
  r = Replace(r, "%2F", "/")
  r = Replace(r, "%20", " ")
  URLDecode = r
End Function
