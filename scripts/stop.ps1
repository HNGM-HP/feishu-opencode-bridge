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
  Write-Host '[stop] 未检测到 Node.js'
  Write-Host '[stop] 无法执行停止脚本'
  Write-Host '[stop] 如需安装，请执行:'
  Write-Host '  .\scripts\deploy.ps1 deploy'
  Write-Host '========================================'
  exit 1
}

Write-Host "[stop] Node.js 已就绪: $nodeVersion"
& node (Join-Path $scriptDir 'stop.mjs') @args
exit $LASTEXITCODE
