$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcher = Join-Path $root 'iniciar.vbs'
$icon = Join-Path $root 'assets\icons\iluminura.ico'
$programs = [Environment]::GetFolderPath('Programs')
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'

if (-not (Test-Path -LiteralPath $launcher)) {
  Write-Error "Arquivo nao encontrado: $launcher"
  exit 1
}

if (-not (Test-Path -LiteralPath $wscript)) {
  Write-Error "wscript.exe nao encontrado: $wscript"
  exit 1
}

if (-not (Test-Path -LiteralPath $programs)) {
  New-Item -ItemType Directory -Path $programs -Force | Out-Null
}

$shell = New-Object -ComObject WScript.Shell

$shortcutPath = Join-Path $programs 'Iluminura.lnk'
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $wscript
$shortcut.Arguments = '"' + $launcher + '"'
$shortcut.WorkingDirectory = $root
$shortcut.Description = 'Iluminura: abre o aplicativo e mantem o icone na bandeja do sistema'
$shortcut.WindowStyle = 1

if (Test-Path -LiteralPath $icon) {
  $shortcut.IconLocation = "$icon,0"
}

$shortcut.Save()

$legacyStop = Join-Path $programs 'Encerrar Iluminura.lnk'
if (Test-Path -LiteralPath $legacyStop) {
  Remove-Item -LiteralPath $legacyStop -Force
}

if (-not (Test-Path -LiteralPath $shortcutPath)) {
  Write-Error 'Nao foi possivel criar o atalho do Iluminura.'
  exit 1
}

Write-Host ''
Write-Host 'Atalho criado no Menu Iniciar:'
Write-Host "  $shortcutPath"
Write-Host ''
Write-Host 'Use "Iluminura" para iniciar. O icone permanece na bandeja do sistema; clique com o botao direito para abrir, parar o servidor ou sair.'
