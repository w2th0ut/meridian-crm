@echo off
chcp 65001 >nul
title 停止 Meridian CRM
set "MERIDIAN_PACKAGE_ROOT=%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0runtime\Stop-Meridian.ps1" -PackageRoot "%MERIDIAN_PACKAGE_ROOT%"
if errorlevel 1 pause
