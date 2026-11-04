@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0desinstalar.ps1"

if errorlevel 1 (
  echo.
  echo Nao foi possivel remover o atalho do Menu Iniciar.
  pause
  goto :eof
)

pause
