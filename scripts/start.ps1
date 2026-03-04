$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Get-NodeVersion {
  try {
    $versionText = (& node -v 2>$null)
    if ([string]::IsNullOrWhiteSpace($versionText)) {
      return $null
    }
    return $versionText.Trim()
  } catch {
    return $null
  }
}

$nodeVersion = Get-NodeVersion
if (-not $nodeVersion) {
  Write-Host '========================================'
  Write-Host '[start] 未检测到 Node.js'
  Write-Host '[start] 请先执行部署脚本:'
  Write-Host '  .\scripts\deploy.ps1 deploy'
  Write-Host '========================================'
  exit 1
}

Write-Host "[start] Node.js 已就绪: $nodeVersion"

$distPath = Join-Path (Split-Path -Parent $scriptDir) 'dist\index.js'
if (-not (Test-Path $distPath)) {
  Write-Host '[start] 未找到编译产物，请先执行:'
  Write-Host '  .\scripts\deploy.ps1 deploy'
  exit 1
}

& node (Join-Path $scriptDir 'start.mjs') @args
exit $LASTEXITCODE
