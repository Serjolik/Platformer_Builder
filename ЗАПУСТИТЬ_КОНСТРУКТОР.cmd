@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Blockout Map Constructor
start "" cmd /c "timeout /t 3 /nobreak >nul & start "" http://localhost:3000"
npm.cmd run dev
