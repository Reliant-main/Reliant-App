@echo off
rem Installs the Reliant Chit Printer for this Windows user and starts it.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ReliantChitPrinter.ps1" -Install
