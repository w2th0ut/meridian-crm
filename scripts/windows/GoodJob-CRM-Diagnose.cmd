@echo off
chcp 65001 >nul
title Keduoduo CRM 诊断
set "KEDUODUO_PACKAGE_ROOT=%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0runtime\Diagnose-Keduoduo.ps1" -PackageRoot "%KEDUODUO_PACKAGE_ROOT%"
echo.
pause
