@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Cleanup-InventoryProjectInstall.ps1"
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" echo Cleanup did not complete. Review the message above.
pause
exit /b %EXIT_CODE%
