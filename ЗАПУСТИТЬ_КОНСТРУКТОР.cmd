@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Blockout Map Constructor

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-constructor.ps1"
set "LAUNCH_EXIT=%ERRORLEVEL%"

echo.
echo Launcher finished with exit code %LAUNCH_EXIT%.
echo Diagnostic log: "%~dp0constructor-launch.log"
echo Send this log file to the developer if the problem continues.
echo.
pause
exit /b %LAUNCH_EXIT%
