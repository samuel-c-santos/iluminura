@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar.ps1"

if errorlevel 1 (
  echo.
  echo Nao foi possivel criar os atalhos no Menu Iniciar.
  pause
  goto :eof
)

echo.
echo Atalhos "Iluminura" e "Encerrar Iluminura" criados no Menu Iniciar.
pause
