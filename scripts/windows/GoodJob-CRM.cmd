@echo off
chcp 65001 >nul
title Keduoduo CRM 一键启动
set "KEDUODUO_PACKAGE_ROOT=%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0runtime\Start-Keduoduo.ps1" -PackageRoot "%KEDUODUO_PACKAGE_ROOT%"
if errorlevel 1 (
  echo.
  echo 启动失败。请查看上方原因，或双击 DIAGNOSE-KEDUODUO.cmd。
  pause
)
