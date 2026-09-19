@echo off
setlocal
title SubTracker
cd /d "%~dp0"
set NO_COLOR=1
set FORCE_COLOR=0

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required but was not found. Install it from https://nodejs.org
  pause
  exit /b 1
)

echo.
echo  Preparing SubTracker (a few seconds)...
call npm.cmd run build >nul 2>nul

if not exist "dist\index.html" (
  echo.
  echo  Could not prepare the app. If this is a fresh copy, run:  npm install
  echo  ...and then double-click launch.bat again.
  pause
  exit /b 1
)

rem The server saves all data to the "data" folder automatically and opens
rem the browser itself once it is ready. If SubTracker is already running,
rem this just opens the browser again.
start "SubTracker - keep this window open (minimized is fine)" /min node server.mjs --open
exit /b 0
