@echo off
title G5Link Bridge
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)
node "%~dp0g5link-bridge.js" %*
pause
