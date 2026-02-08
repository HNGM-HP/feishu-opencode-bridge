$root = Split-Path -Parent $PSScriptRoot

$logDir = Join-Path $root 'logs'

$pidFile = Join-Path $logDir 'bridge.pid'



if (-not (Test-Path $pidFile)) {

  Write-Host 'PID file not found.'

  exit 1

}



$processId = Get-Content $pidFile | Select-Object -First 1

if ($processId) {

  Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue

}



Remove-Item $pidFile -ErrorAction SilentlyContinue

Write-Host 'Stopped.'

