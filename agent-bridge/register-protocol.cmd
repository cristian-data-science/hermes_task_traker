@echo off
rem Registra el protocolo hermesagent:// en el usuario (sin admin).
rem Permite que la app web abra carpetas y archivos .md del agente.
reg add HKCU\Software\Classes\hermesagent /ve /d "URL:Hermes Agent Protocol" /f
reg add HKCU\Software\Classes\hermesagent /v "URL Protocol" /f
reg add HKCU\Software\Classes\hermesagent\DefaultIcon /ve /d "imageres.dll,-109" /f
reg add HKCU\Software\Classes\hermesagent\shell\open\command /ve /d "wscript.exe \"C:\Users\patag\git_provisorio\hermes_task_traker\agent-bridge\protocol-handler.vbs\" \"%%1\"" /f
echo Protocolo hermesagent:// registrado.
