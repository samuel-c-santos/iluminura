$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcher = Join-Path $root 'iniciar.bat'
$icon = Join-Path $root 'assets\icons\iluminura.ico'
$programs = [Environment]::GetFolderPath('Programs')

if (-not (Test-Path -LiteralPath $launcher)) {
  Write-Error "Arquivo nao encontrado: $launcher"
  exit 1
}

if (-not (Test-Path -LiteralPath $programs)) {
  New-Item -ItemType Directory -Path $programs -Force | Out-Null
}

$shortcutPath = Join-Path $programs 'Iluminura.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)

$shortcut.TargetPath = $launcher
$shortcut.WorkingDirectory = $root
$shortcut.Description = 'Iluminura: leitor e editor Markdown local'
$shortcut.WindowStyle = 1

if (Test-Path -LiteralPath $icon) {
  $shortcut.IconLocation = "$icon,0"
}

$shortcut.Save()

if (-not (Test-Path -LiteralPath $shortcutPath)) {
  Write-Error 'Nao foi possivel criar o atalho.'
  exit 1
}

Write-Host ''
Write-Host 'Atalho criado no Menu Iniciar:'
Write-Host "  $shortcutPath"
Write-Host ''
Write-Host 'Procure por "Iluminura" no Menu Iniciar.'
