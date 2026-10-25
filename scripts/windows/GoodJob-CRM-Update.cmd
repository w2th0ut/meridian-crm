@echo off
chcp 65001 >nul
title Meridian CRM 一键更新
set "MERIDIAN_PACKAGE_ROOT=%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0runtime\Update-Meridian.ps1" -PackageRoot "%MERIDIAN_PACKAGE_ROOT%"
if errorlevel 1 (
  echo.
  echo 更新失败，现有版本不会被覆盖。请查看上方原因和日志。
  pause
)
