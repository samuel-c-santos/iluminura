@echo off
setlocal
cd /d "%~dp0"

where wscript >nul 2>nul
if errorlevel 1 goto semwscript

wscript.exe //nologo "%~dp0iniciar.vbs"
goto :eof

:semwscript
echo Nao foi possivel iniciar o Iluminura: wscript.exe nao encontrado.
pause
