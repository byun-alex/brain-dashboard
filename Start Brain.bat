@echo off
title Brain Dashboard
cd /d "%~dp0"
echo.
echo   Starting your Brain Dashboard...
echo   (keep this window open while you use it)
echo.
start "" http://127.0.0.1:4317
node server.js
pause
