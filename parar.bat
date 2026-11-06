@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto semnode

node "encerrar.js"

if errorlevel 1 (
  echo.
  pause
  goto :eof
)

echo.
ping -n 2 127.0.0.1 >nul
goto :eof

:semnode
echo Node.js nao encontrado.
pause
