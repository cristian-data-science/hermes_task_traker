@echo off
rem Puente contra el deployment de PRODUCCION (la app de Vercel).
rem Lanzado por la tarea programada via run-hidden.vbs (sin ventana);
rem si lo corrés a mano se ve la consola. El daemon relanza al dispatcher
rem si muere. Log persistente en agent-bridge\bridge.log.
title Agent Bridge (produccion)
cd /d C:\Users\patag\git_provisorio\hermes_task_traker
set CONVEX_URL=https://effervescent-crab-895.convex.cloud
node agent-bridge\daemon.mjs >> agent-bridge\bridge.log 2>&1
