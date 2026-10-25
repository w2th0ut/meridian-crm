@echo off
chcp 65001 >nul
title Meridian CRM 诊断
set "MERIDIAN_PACKAGE_ROOT=%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0runtime\Diagnose-Meridian.ps1" -PackageRoot "%MERIDIAN_PACKAGE_ROOT%"
echo.
pause
