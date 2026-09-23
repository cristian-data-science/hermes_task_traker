@echo off
rem Puente contra el deployment de DESARROLLO (app local de `npm run dev`).
rem Convive con el de produccion (start.cmd): candado y sesion propios.
rem Log persistente en agent-bridge\bridge-dev.log.
title Agent Bridge (dev)
cd /d C:\Users\patag\git_provisorio\hermes_task_traker
node agent-bridge\dev.mjs >> agent-bridge\bridge-dev.log 2>&1
