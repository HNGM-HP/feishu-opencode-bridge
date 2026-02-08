@echo off
setlocal

set "ROOT=%~dp0.."
set "LOG_DIR=%ROOT%\logs"
set "PID_FILE=%ROOT%\logs\bridge.pid"

if not exist "%LOG_DIR%" (
  mkdir "%LOG_DIR%"
)

if exist "%PID_FILE%" (
  echo 已有PID文件，可能已在运行。若需重启请先执行 stop.cmd
  exit /b 1
)

pushd "%ROOT%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\start.ps1"
popd
echo 已启动。日志: %LOG_DIR%\service.log
endlocal
