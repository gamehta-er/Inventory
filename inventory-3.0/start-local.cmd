@echo off
setlocal
cd /d "%~dp0"
set HOST=127.0.0.1
set PORT=3003

where node >nul 2>&1
if %ERRORLEVEL% equ 0 (
  node server.js
) else (
  rem Fallback: Codex bundled Node when node is not on PATH
  "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" server.js
)
