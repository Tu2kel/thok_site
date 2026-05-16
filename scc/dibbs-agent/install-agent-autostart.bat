@echo off
chcp 437 >nul
title IMPERIO - Install Agent Auto-Start
color 0A

echo.
echo  IMPERIO SCC - AGENT AUTO-START INSTALLER
echo  Runs once. Never touch again.
echo.
echo  This will register the DIBBS Agent as a Windows Task
echo  that starts automatically when you log in.
echo  The agent runs silently in the background on port 3100.
echo.
pause

set TASK_NAME=ImperioSCCAgent
set WSL_PATH=/home/tu2kel/thok_Apps/thokWebsite/THOK_Site/scc/dibbs-agent

echo  Removing any existing task registration...
schtasks /delete /tn "%TASK_NAME%" /f >nul 2>&1

echo  Registering Task Scheduler entry...
schtasks /create /tn "%TASK_NAME%" /tr "wsl bash -c \"cd %WSL_PATH% && node dibbs-agent.js\"" /sc ONLOGON /ru "%USERNAME%" /rl LIMITED /f /delay 0001:00 /it

if %ERRORLEVEL% NEQ 0 (
  echo.
  echo  [ERROR] Registration failed. See message above.
  echo.
  pause
  exit /b 1
)

echo  Starting agent now...
schtasks /run /tn "%TASK_NAME%"

timeout /t 8 /nobreak >nul

echo  Checking agent health...
curl -s http://localhost:3100/health

echo.
echo  Done. Agent will auto-start on every login.
echo  To stop:   schtasks /end /tn %TASK_NAME%
echo  To remove: schtasks /delete /tn %TASK_NAME% /f
echo.
pause
