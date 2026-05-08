@echo off
title IMPERIO — DIBBS Local Agent
color 0A

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║   IMPERIO SCC — DIBBS LOCAL AGENT               ║
echo  ║   Imperio Federal Logistics / CAGE 152U4         ║
echo  ╚══════════════════════════════════════════════════╝
echo.

:: ── Check Node.js is installed ──
where node >nul 2>&1
if %errorlevel% neq 0 (
  echo  [ERROR] Node.js not found. Download from https://nodejs.org
  echo  Install Node.js LTS, then run this file again.
  pause
  exit /b 1
)

:: ── Get Node version ──
for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo  Node.js %NODE_VER% detected. Good.
echo.

:: ── Check if agent is already running ──
netstat -ano | findstr ":3100" >nul 2>&1
if %errorlevel% equ 0 (
  echo  [INFO] Port 3100 already in use — agent may already be running.
  echo  Open http://localhost:3100/health in your browser to check.
  echo.
  pause
  exit /b 0
)

:: ── Launch agent ──
echo  Starting DIBBS agent on http://localhost:3100 ...
echo  Keep this window open while using SCC.
echo  Close this window to stop the agent.
echo.

cd /d "%~dp0"
node dibbs-agent.js

:: If node exits with error
echo.
echo  [ERROR] Agent stopped unexpectedly. Check the error above.
pause
