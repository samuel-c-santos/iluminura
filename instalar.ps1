$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcher = Join-Path $root 'iniciar.vbs'
$stopper = Join-Path $root 'parar.bat'
$icon = Join-Path $root 'assets\icons\iluminura.ico'
$programs = [Environment]::GetFolderPath('Programs')
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'

if (-not (Test-Path -LiteralPath $launcher)) {
  Write-Error "Arquivo nao encontrado: $launcher"
  exit 1
}

if (-not (Test-Path -LiteralPath $stopper)) {
  Write-Error "Arquivo nao encontrado: $stopper"
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
$shortcut.Description = 'Iluminura: leitor e editor Markdown local'
$shortcut.WindowStyle = 1

if (Test-Path -LiteralPath $icon) {
  $shortcut.IconLocation = "$icon,0"
}

$shortcut.Save()

$stopPath = Join-Path $programs 'Encerrar Iluminura.lnk'
$stopShortcut = $shell.CreateShortcut($stopPath)
$stopShortcut.TargetPath = $stopper
$stopShortcut.WorkingDirectory = $root
$stopShortcut.Description = 'Encerra o servidor local do Iluminura'
$stopShortcut.WindowStyle = 7

if (Test-Path -LiteralPath $icon) {
  $stopShortcut.IconLocation = "$icon,0"
}

$stopShortcut.Save()

if (-not (Test-Path -LiteralPath $shortcutPath)) {
  Write-Error 'Nao foi possivel criar o atalho do Iluminura.'
  exit 1
}

if (-not (Test-Path -LiteralPath $stopPath)) {
  Write-Error 'Nao foi possivel criar o atalho de encerramento.'
  exit 1
}

Write-Host ''
Write-Host 'Atalhos criados no Menu Iniciar:'
Write-Host "  $shortcutPath"
Write-Host "  $stopPath"
Write-Host ''
Write-Host 'Use "Iluminura" para iniciar e "Encerrar Iluminura" para parar o servidor.'
