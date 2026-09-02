@echo off
title Agent Bridge (produccion)
cd /d C:\Users\patag\git_provisorio\hermes_task_traker
rem Puente contra el deployment de PRODUCCION (la app de Vercel).
rem Si el dispatcher muere, el daemon lo relanza solo. Cerrar esta ventana
rem detiene el puente (la tarea programada lo levanta de nuevo al loguearte).
set CONVEX_URL=https://effervescent-crab-895.convex.cloud
node agent-bridge\daemon.mjs
pause
