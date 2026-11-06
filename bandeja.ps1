param(
  [int]$Port = 8731,
  [string]$StateDir = '',
  [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
if (-not $root) { $root = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $StateDir) { $StateDir = $root }

$url = 'http://127.0.0.1:' + $Port + '/'
$iconPath = Join-Path $root 'assets\icons\iluminura.ico'
$serverScript = Join-Path $root 'servidor.js'
$stopScript = Join-Path $root 'encerrar.js'
$logPath = Join-Path $StateDir '.iluminura-bandeja.log'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Write-TrayLog($message) {
  try {
    Add-Content -Path $logPath -Value ((Get-Date -Format 'HH:mm:ss') + ' ' + $message)
  } catch { }
}

trap {
  Write-TrayLog ('ERRO ' + $_.Exception.Message + ' | ' + $_.ScriptStackTrace)
  try {
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Iluminura', 'OK', 'Error') | Out-Null
  } catch { }
  exit 1
}

function Get-NodePath {
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $command) { $command = Get-Command node -ErrorAction SilentlyContinue }
  if ($command) { return $command.Source }
  return $null
}

function Test-IluminuraServer {
  try {
    $request = [System.Net.WebRequest]::Create($url + '__iluminura/status')
    $request.Timeout = 1500
    $request.ReadWriteTimeout = 1500
    $response = $request.GetResponse()
    $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
    $body = $reader.ReadToEnd()
    $reader.Close()
    $response.Close()
    return $body -match '"app"\s*:\s*"iluminura"'
  } catch {
    return $false
  }
}

function New-ServerProcess($node, $arguments) {
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $node
  $info.Arguments = $arguments
  $info.WorkingDirectory = $root
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  $info.EnvironmentVariables['ILUMINURA_HIDDEN'] = '1'
  $info.EnvironmentVariables['ILUMINURA_NO_OPEN'] = '1'
  $info.EnvironmentVariables['ILUMINURA_STATE_DIR'] = $StateDir
  return [System.Diagnostics.Process]::Start($info)
}

function Start-IluminuraServer {
  if (Test-IluminuraServer) { return $true }

  $node = Get-NodePath
  if (-not $node) { return $false }

  try {
    $process = New-ServerProcess $node ('"' + $serverScript + '" ' + $Port)
  } catch {
    return $false
  }

  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    if (Test-IluminuraServer) { return $true }
    if ($process.HasExited) { break }
  }

  return (Test-IluminuraServer)
}

function Stop-IluminuraServer {
  if (-not (Test-IluminuraServer)) { return $true }

  $node = Get-NodePath
  if (-not $node) { return $false }

  try {
    $process = New-ServerProcess $node ('"' + $stopScript + '" ' + $Port)
    $process.WaitForExit(8000) | Out-Null
  } catch {
    return $false
  }

  for ($i = 0; $i -lt 20; $i++) {
    if (-not (Test-IluminuraServer)) { return $true }
    Start-Sleep -Milliseconds 250
  }

  return -not (Test-IluminuraServer)
}

function Open-Iluminura {
  if (-not (Start-IluminuraServer)) {
    [System.Windows.Forms.MessageBox]::Show(
      'Nao foi possivel iniciar o servidor local. Verifique o Node.js e a porta ' + $Port + '.',
      'Iluminura', 'OK', 'Warning') | Out-Null
    return
  }

  try {
    Start-Process -FilePath $url
  } catch {
    [System.Windows.Forms.MessageBox]::Show(
      'Nao foi possivel abrir o navegador. Acesse ' + $url,
      'Iluminura', 'OK', 'Warning') | Out-Null
  }
}

function Update-TrayState {
  $running = Test-IluminuraServer

  if ($script:lastState -ne $running) {
    if ($running) { Write-TrayLog 'servidor ativo' } else { Write-TrayLog 'servidor parado' }
    $script:lastState = $running
  }

  if ($script:notifyIcon) {
    if ($running) {
      $script:notifyIcon.Text = 'Iluminura - servidor ativo'
    } else {
      $script:notifyIcon.Text = 'Iluminura - servidor parado'
    }
  }

  if ($script:itemToggle) {
    if ($running) {
      $script:itemToggle.Text = 'Parar servidor'
    } else {
      $script:itemToggle.Text = 'Iniciar servidor'
    }
  }
}

function Invoke-SelfTest {
  $exitCode = 0

  try {
    if (Test-IluminuraServer) { throw 'a porta de teste ja esta em uso' }
    if (-not (Start-IluminuraServer)) { throw 'o servidor nao iniciou' }
    if (-not (Test-IluminuraServer)) { throw 'o status do servidor nao respondeu' }

    $iconLoaded = Test-Path -LiteralPath $iconPath
    if ($iconLoaded) {
      $icon = New-Object System.Drawing.Icon($iconPath)
    } else {
      $icon = [System.Drawing.SystemIcons]::Application
    }

    $probe = New-Object System.Windows.Forms.NotifyIcon
    $probe.Icon = $icon
    $probe.Text = 'Iluminura'
    $probe.Visible = $false
    $probe.Dispose()

    if ($iconLoaded) { $icon.Dispose() }

    if (-not (Stop-IluminuraServer)) { throw 'o servidor nao encerrou' }
    if (Test-IluminuraServer) { throw 'o servidor continua ativo' }

    Write-Host 'BANDEJA OK'
  } catch {
    Write-Host ('BANDEJA FALHOU: ' + $_.Exception.Message)
    $exitCode = 1
  } finally {
    Stop-IluminuraServer | Out-Null
  }

  exit $exitCode
}

if ($SelfTest) { Invoke-SelfTest }

$mutex = New-Object System.Threading.Mutex($false, 'Local\IluminuraTray')

if (-not $mutex.WaitOne(0)) {
  for ($i = 0; $i -lt 20; $i++) {
    if (Test-IluminuraServer) { break }
    Start-Sleep -Milliseconds 250
  }

  if (Test-IluminuraServer) { Start-Process -FilePath $url }
  exit 0
}

$script:mutex = $mutex
$script:notifyIcon = $null
$script:timer = $null
$script:itemToggle = $null
$script:url = $url
$script:root = $root
$script:lastState = $null

[System.Windows.Forms.Application]::EnableVisualStyles()

$iconLoaded = Test-Path -LiteralPath $iconPath
if ($iconLoaded) {
  $icon = New-Object System.Drawing.Icon($iconPath)
} else {
  $icon = [System.Drawing.SystemIcons]::Application
}

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = $icon
$notify.Text = 'Iluminura'
$notify.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$menu.ShowImageMargin = $false

$itemOpen = New-Object System.Windows.Forms.ToolStripMenuItem('Abrir Iluminura')
$itemOpen.Font = New-Object System.Drawing.Font($itemOpen.Font, [System.Drawing.FontStyle]::Bold)
$itemOpen.Add_Click({
  try { Open-Iluminura } catch { Write-TrayLog ('abrir: ' + $_.Exception.Message) }
})

$itemToggle = New-Object System.Windows.Forms.ToolStripMenuItem('Parar servidor')
$itemToggle.Add_Click({
  try {
    if (Test-IluminuraServer) {
      Stop-IluminuraServer | Out-Null
    } else {
      Start-IluminuraServer | Out-Null
    }
    Update-TrayState
  } catch {
    Write-TrayLog ('alternar: ' + $_.Exception.Message)
  }
})

$itemFolder = New-Object System.Windows.Forms.ToolStripMenuItem('Abrir pasta do aplicativo')
$itemFolder.Add_Click({
  try {
    Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $script:root + '"')
  } catch {
    Write-TrayLog ('pasta: ' + $_.Exception.Message)
  }
})

$itemExit = New-Object System.Windows.Forms.ToolStripMenuItem('Sair')
$itemExit.Add_Click({
  try {
    if (Test-IluminuraServer) {
      $answer = [System.Windows.Forms.MessageBox]::Show(
        'Encerrar o servidor e sair do Iluminura?', 'Iluminura', 'YesNo', 'Question')
      if ($answer -ne 'Yes') { return }
    }

    Stop-IluminuraServer | Out-Null
    [System.Windows.Forms.Application]::Exit()
  } catch {
    Write-TrayLog ('sair: ' + $_.Exception.Message)
  }
})

$menu.Items.Add($itemOpen) | Out-Null
$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null
$menu.Items.Add($itemToggle) | Out-Null
$menu.Items.Add($itemFolder) | Out-Null
$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null
$menu.Items.Add($itemExit) | Out-Null

$notify.ContextMenuStrip = $menu
$notify.Add_DoubleClick({ Open-Iluminura })

$script:notifyIcon = $notify
$script:itemToggle = $itemToggle

$script:timer = New-Object System.Windows.Forms.Timer
$script:timer.Interval = 3000
$script:timer.Add_Tick({
  try { Update-TrayState } catch { Write-TrayLog ('timer: ' + $_.Exception.Message) }
})
$script:timer.Start()

Update-TrayState
Write-TrayLog ('bandeja iniciada na porta ' + $Port)

if (Start-IluminuraServer) {
  Update-TrayState
  Start-Process -FilePath $url
} else {
  $notify.ShowBalloonTip(5000, 'Iluminura',
    'Nao foi possivel iniciar o servidor local. Verifique o Node.js e a porta ' + $Port + '.',
    'Warning')
}

Write-TrayLog 'entrando no loop'
[System.Windows.Forms.Application]::Run()
Write-TrayLog 'loop encerrado'

if ($script:timer) { $script:timer.Stop() }
$notify.Visible = $false
$notify.Dispose()
if ($iconLoaded) { $icon.Dispose() }

try { $mutex.ReleaseMutex() } catch { }
$mutex.Dispose()
