$root = Split-Path -Parent $PSScriptRoot

$logDir = Join-Path $root 'logs'

$pidFile = Join-Path $logDir 'bridge.pid'



if (Test-Path $pidFile) {

  Write-Host 'PID file exists. Use stop.ps1 first.'

  exit 1

}



if (-not (Test-Path $logDir)) {

  New-Item -ItemType Directory -Path $logDir | Out-Null

}



Push-Location $root

npm run build

if ($LASTEXITCODE -ne 0) {

  Pop-Location

  exit $LASTEXITCODE

}



$process = Start-Process -FilePath node -ArgumentList 'dist/index.js' -WorkingDirectory $root -RedirectStandardOutput (Join-Path $logDir 'service.log') -RedirectStandardError (Join-Path $logDir 'service.err') -WindowStyle Hidden -PassThru

$process.Id | Out-File -Encoding ascii $pidFile

Pop-Location



Write-Host ('Started. Log: ' + (Join-Path $logDir 'service.log'))

