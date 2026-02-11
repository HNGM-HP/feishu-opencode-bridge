$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
node (Join-Path $scriptDir 'stop.mjs') @args
