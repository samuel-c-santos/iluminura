$ErrorActionPreference = 'Stop'

$programs = [Environment]::GetFolderPath('Programs')
$paths = @(
  (Join-Path $programs 'Iluminura.lnk'),
  (Join-Path $programs 'Encerrar Iluminura.lnk')
)

$removed = 0

foreach ($path in $paths) {
  if (Test-Path -LiteralPath $path) {
    Remove-Item -LiteralPath $path -Force
    Write-Host ''
    Write-Host 'Atalho removido do Menu Iniciar.'
    Write-Host "  $path"
    $removed++
  }
}

if ($removed -eq 0) {
  Write-Host ''
  Write-Host 'Nenhum atalho do Iluminura foi encontrado no Menu Iniciar.'
}
