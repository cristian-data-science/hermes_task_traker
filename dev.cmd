@echo off
REM ============================================================
REM  Cris Agent Task - Entorno de desarrollo local
REM  Abre dos ventanas: backend (Convex) y frontend (Vite).
REM ============================================================
title Cris Agent Task - dev
cd /d "%~dp0"

echo.
echo  [1/2] Iniciando backend Convex...
start "Cris Agent Task - Convex" cmd /k "npx convex dev"

timeout /t 3 /nobreak >nul

echo  [2/2] Iniciando frontend Vite...
start "Cris Agent Task - Vite" cmd /k "npm run dev"

timeout /t 5 /nobreak >nul

echo.
echo  Abriendo el navegador en http://localhost:5173
start "" http://localhost:5173
echo.
echo  Listo. Para detener: cierra las dos ventanas que se abrieron.
timeout /t 4 /nobreak >nul
