@echo off
setlocal
set "ROOT=%~dp0.."
set "APP=%ROOT%\app\apps\web"
set "LOGDIR=%ROOT%\logs"
if not defined NODE set "NODE=C:\Users\Administrator\.workbuddy\binaries\node\versions\node-v24.21.0-win-x64\node.exe"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
cd /d "%APP%"
set "NODE_ENV=production"
set "PORT=3001"
set "HOSTNAME=0.0.0.0"
:loop
echo [%date% %time%] starting production web >> "%LOGDIR%\web.log"
"%NODE%" "%ROOT%\app\scripts\start-db-tunnel.mjs" --background --if-needed >> "%LOGDIR%\web.log" 2>&1
if errorlevel 1 goto retry
"%NODE%" "%ROOT%\app\scripts\start-carbon-market-sync.mjs" --background >> "%LOGDIR%\web.log" 2>&1
"%NODE%" "node_modules\next\dist\bin\next" start -H 0.0.0.0 -p 3001 >> "%LOGDIR%\web.log" 2>&1
:retry
echo [%date% %time%] web stopped, retry in 10s >> "%LOGDIR%\web.log"
timeout /t 10 /nobreak > nul
goto loop
