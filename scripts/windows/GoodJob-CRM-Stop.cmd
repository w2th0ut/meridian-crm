@echo off
chcp 65001 >nul
title 停止 Keduoduo CRM
set "KEDUODUO_PACKAGE_ROOT=%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0runtime\Stop-Keduoduo.ps1" -PackageRoot "%KEDUODUO_PACKAGE_ROOT%"
if errorlevel 1 pause
