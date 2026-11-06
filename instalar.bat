@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar.ps1"

if errorlevel 1 (
  echo.
  echo Nao foi possivel criar o atalho no Menu Iniciar.
  pause
  goto :eof
)

echo.
echo Atalho "Iluminura" criado no Menu Iniciar.
echo Para encerrar o servidor, use Ajuda ^> Encerrar servidor no aplicativo.
pause
