$ErrorActionPreference = 'Stop'

$programs = [Environment]::GetFolderPath('Programs')
$shortcutPath = Join-Path $programs 'Iluminura.lnk'

if (Test-Path -LiteralPath $shortcutPath) {
  Remove-Item -LiteralPath $shortcutPath -Force
  Write-Host ''
  Write-Host 'Atalho removido do Menu Iniciar.'
  Write-Host "  $shortcutPath"
} else {
  Write-Host ''
  Write-Host 'O atalho nao existe no Menu Iniciar.'
}
