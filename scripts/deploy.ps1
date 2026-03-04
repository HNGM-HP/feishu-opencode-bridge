$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$minNodeMajor = 18

function Read-Input {
  param([string]$Prompt)
  if ([Console]::IsInputRedirected -or [Console]::IsOutputRedirected) {
    return ''
  }
  return Read-Host $Prompt
}

function Ask-YesNo {
  param(
    [string]$Prompt,
    [bool]$DefaultYes = $true
  )
  $suffix = if ($DefaultYes) { '[Y/n]' } else { '[y/N]' }
  $answer = Read-Input "$Prompt $suffix"
  if ([string]::IsNullOrWhiteSpace($answer)) {
    return $DefaultYes
  }
  switch ($answer.Trim().ToLowerInvariant()) {
    'y' { return $true }
    'yes' { return $true }
    '1' { return $true }
    'true' { return $true }
    '是' { return $true }
    default { return $false }
  }
}

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

function Get-NodeMajor {
  $versionText = Get-NodeVersion
  if (-not $versionText) {
    return $null
  }
  if ($versionText.StartsWith('v')) {
    $versionText = $versionText.Substring(1)
  }
  $majorText = $versionText.Split('.')[0]
  $major = 0
  if ([int]::TryParse($majorText, [ref]$major)) {
    return $major
  }
  return $null
}

function Get-NpmVersion {
  try {
    $version = (& npm -v 2>$null)
    if ([string]::IsNullOrWhiteSpace($version)) {
      return $null
    }
    return $version.Trim()
  } catch {
    return $null
  }
}

function Get-OpenCodeVersionHint {
  $command = Get-Command opencode -ErrorAction SilentlyContinue
  if (-not $command) {
    return $null
  }

  $outputs = @()
  foreach ($commandArgs in @(@('-v'), @('--version'))) {
    try {
      $text = (& opencode @commandArgs 2>$null)
      if (-not [string]::IsNullOrWhiteSpace($text)) {
        $outputs += $text.Trim()
      }
    } catch {
      continue
    }
  }

  foreach ($output in $outputs) {
    if ($output -match '(?i)\bv?\d+\.\d+\.\d+(?:[-+][0-9a-z.-]+)?\b') {
      return $output
    }
  }

  if ($outputs.Count -gt 0) {
    return $outputs[0]
  }

  return 'installed'
}

function Install-NodeWithWinget {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    return $false
  }
  Write-Host '[deploy] 使用 winget 安装 Node.js LTS...'
  try {
    winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

function Install-NodeWithChoco {
  if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
    return $false
  }
  Write-Host '[deploy] 使用 Chocolatey 安装 Node.js LTS...'
  try {
    choco install nodejs-lts -y
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

function Install-Node {
  Write-Host '[deploy] 正在尝试自动安装 Node.js...'
  if (Install-NodeWithWinget) {
    Write-Host '[deploy] winget 安装完成'
    return $true
  }
  Write-Host '[deploy] winget 不可用或安装失败'
  if (Install-NodeWithChoco) {
    Write-Host '[deploy] Chocolatey 安装完成'
    return $true
  }
  Write-Host '[deploy] Chocolatey 不可用或安装失败'
  return $false
}

function Show-ManualInstallGuide {
  Write-Host ''
  Write-Host '========================================'
  Write-Host '[deploy] 自动安装失败，请手动安装 Node.js：'
  Write-Host '[deploy] https://nodejs.org/'
  Write-Host ''
  Write-Host '[deploy] 或使用以下命令安装：'
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Host '  winget install -e --id OpenJS.NodeJS.LTS'
  }
  if (Get-Command choco -ErrorAction SilentlyContinue) {
    Write-Host '  choco install nodejs-lts -y'
  }
  Write-Host '========================================'
}

function Ensure-NodeRuntime {
  $nodeMajor = Get-NodeMajor
  if ($nodeMajor -and $nodeMajor -ge $minNodeMajor) {
    Write-Host "[deploy] Node.js 已就绪: $(Get-NodeVersion)"
    return
  }

  if ($nodeMajor) {
    Write-Host "[deploy] Node.js 版本过低: $(Get-NodeVersion)，需要 >= $minNodeMajor"
  } else {
    Write-Host '[deploy] 未检测到 Node.js'
  }

  Write-Host ''
  Write-Host '========================================'
  Write-Host "[deploy] 本项目需要 Node.js >= $minNodeMajor"
  Write-Host '========================================'
  Write-Host ''

  if (-not (Ask-YesNo -Prompt '[deploy] 是否现在安装 Node.js?' -DefaultYes $true)) {
    throw '[deploy] 用户取消安装'
  }

  if (-not (Install-Node)) {
    Show-ManualInstallGuide
    throw '[deploy] 自动安装失败，请手动安装后重试'
  }

  # 安装后重试检测
  Write-Host ''
  if (Ask-YesNo -Prompt '[deploy] 安装完成，是否立即重试检测?' -DefaultYes $true) {
    $nodeMajor = Get-NodeMajor
    if ($nodeMajor -and $nodeMajor -ge $minNodeMajor) {
      Write-Host "[deploy] Node.js 已就绪: $(Get-NodeVersion)"
      return
    }
    Write-Host '[deploy] Node.js 检测仍失败，请重开终端后重试'
    throw '[deploy] 环境检测失败'
  }

  throw '[deploy] 请安装完成后重开终端再执行部署'
}

function Ensure-NpmRuntime {
  $npmVersion = Get-NpmVersion
  if ($npmVersion) {
    Write-Host "[deploy] npm 已就绪: $npmVersion"
    return
  }
  Write-Host '[deploy] npm 未就绪，请检查 Node.js 安装'
  throw '[deploy] npm 未就绪'
}

# 主逻辑
try {
  Ensure-NodeRuntime
  Ensure-NpmRuntime

  $previousPrechecked = $env:BRIDGE_RUNTIME_PRECHECKED
  $previousOpenCodeVersionHint = $env:BRIDGE_OPENCODE_VERSION_HINT
  $env:BRIDGE_RUNTIME_PRECHECKED = '1'

  $openCodeVersionHint = Get-OpenCodeVersionHint
  if ($openCodeVersionHint) {
    $env:BRIDGE_OPENCODE_VERSION_HINT = $openCodeVersionHint
  }

  & node (Join-Path $scriptDir 'deploy.mjs') @args

  if ($null -eq $previousPrechecked) {
    Remove-Item Env:BRIDGE_RUNTIME_PRECHECKED -ErrorAction SilentlyContinue
  } else {
    $env:BRIDGE_RUNTIME_PRECHECKED = $previousPrechecked
  }

  if ($null -eq $previousOpenCodeVersionHint) {
    Remove-Item Env:BRIDGE_OPENCODE_VERSION_HINT -ErrorAction SilentlyContinue
  } else {
    $env:BRIDGE_OPENCODE_VERSION_HINT = $previousOpenCodeVersionHint
  }

  exit $LASTEXITCODE
} catch {
  Write-Host "[deploy] 错误: $($_.Exception.Message)"
  exit 1
}
