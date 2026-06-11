@echo off
chcp 437 >nul
title IMPERIO - Install Agent Auto-Start
color 0A

echo.
echo  IMPERIO SCC - AGENT AUTO-START INSTALLER
echo  Runs once. Never touch again.
echo.
echo  Registers the DIBBS Agent to start automatically on login.
echo  Runs silently in the background on port 3100.
echo.
pause

set TASK_NAME=ImperioSCCAgent
set AGENT_DIR=%~dp0
set LAUNCHER=%AGENT_DIR%_launch-agent.bat

:: ── Step 1: Write a clean launcher .bat (no nested quotes in schtasks) ──────
echo @echo off > "%LAUNCHER%"
echo wsl bash -c "cd /home/tu2kel/thok_Apps/thokWebsite/THOK_Site/scc/dibbs-agent ^&^& node dibbs-agent.js" >> "%LAUNCHER%"

echo  Launcher written to: %LAUNCHER%

:: ── Step 2: Remove any existing task ────────────────────────────────────────
echo  Removing any existing task registration...
schtasks /delete /tn "%TASK_NAME%" /f >nul 2>&1

:: ── Step 3: Register the launcher with Task Scheduler ───────────────────────
echo  Registering Task Scheduler entry...
schtasks /create /tn "%TASK_NAME%" /tr "%LAUNCHER%" /sc ONLOGON /ru "%USERNAME%" /rl LIMITED /f

if %ERRORLEVEL% NEQ 0 (
  echo.
  echo  [ERROR] Registration failed. See message above.
  echo  Make sure you right-clicked and chose "Run as administrator".
  echo.
  pause
  exit /b 1
)

:: ── Step 4: Start it now without rebooting ──────────────────────────────────
echo  Starting agent now...
schtasks /run /tn "%TASK_NAME%"

timeout /t 10 /nobreak >nul

:: ── Step 5: Health check ─────────────────────────────────────────────────────
echo  Checking agent health...
curl -s http://localhost:3100/health >nul 2>&1
if %ERRORLEVEL% EQU 0 (
  echo.
  echo  SUCCESS - Agent is running on http://localhost:3100
  echo  Auto-starts on every login from now on.
  echo  To stop:   schtasks /end /tn %TASK_NAME%
  echo  To remove: schtasks /delete /tn %TASK_NAME% /f
) else (
  echo.
  echo  Task registered. Agent may still be warming up.
  echo  Wait 30 seconds then check the SCC DIBBS tab agent pill.
)

echo.
pause
