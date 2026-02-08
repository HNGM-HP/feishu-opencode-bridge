@echo off
setlocal

set "ROOT=%~dp0.."

pushd "%ROOT%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\stop.ps1"
popd
endlocal
