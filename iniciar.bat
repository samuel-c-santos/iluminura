@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto semnode

node "servidor.js"
goto :eof

:semnode
echo Node.js nao encontrado. Abrindo o leitor_md direto no navegador...
echo Para abrir e salvar pastas, instale o Node.js (https://nodejs.org) e rode este atalho novamente.
start "" "%~dp0index.html"
