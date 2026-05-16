@echo off
title IMPERIO — DIBBS Local Agent
color 0A

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║   IMPERIO SCC — DIBBS LOCAL AGENT               ║
echo  ║   Imperio Federal Logistics / CAGE 152U4         ║
echo  ╚══════════════════════════════════════════════════╝
echo.
echo  Project lives in WSL/Ubuntu. Launching node inside WSL...
echo  Keep this window open while using SCC.
echo  Close this window to stop the agent.
echo.

wsl bash -c "cd /home/tu2kel/thok_Apps/thokWebsite/THOK_Site/scc/dibbs-agent && node dibbs-agent.js"

echo.
echo  [ERROR] Agent stopped unexpectedly. Check the error above.
pause

@echo off
title IMPERIO — Install Agent Auto-Start
color 0A

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║   IMPERIO SCC — AGENT AUTO-START INSTALLER      ║
echo  ║   Runs once. Never touch again.                  ║
echo  ╚══════════════════════════════════════════════════╝
echo.
echo  This will register the DIBBS Agent as a Windows Task
echo  that starts automatically when you log in.
echo  The agent runs silently in the background on port 3100.
echo.
pause

:: ── CONFIG — update these if your paths ever change ──────────────────────
set WSL_CMD=wsl bash -c "cd /home/tu2kel/thok_Apps/thokWebsite/THOK_Site/scc/dibbs-agent ^&^& node dibbs-agent.js"
set TASK_NAME=ImperioSCCAgent
set TASK_DESC=Imperio Federal Logistics - DIBBS Local Agent (port 3100)

:: ── Delete existing task if present (clean reinstall) ────────────────────
echo  Removing any existing task registration...
schtasks /delete /tn "%TASK_NAME%" /f >nul 2>&1

:: ── Register new task ─────────────────────────────────────────────────────
:: Trigger: At logon of current user
:: Run:     wsl bash -c "cd ... && node dibbs-agent.js"
:: Hidden:  Yes (no terminal window pops up)
:: Restart: On failure, up to 3 times, 1 minute apart

echo  Registering Task Scheduler entry...

schtasks /create ^
  /tn "%TASK_NAME%" ^
  /tr "%WSL_CMD%" ^
  /sc ONLOGON ^
  /ru "%USERNAME%" ^
  /rl LIMITED ^
  /f ^
  /delay 0001:00 ^
  /it >nul 2>&1

if %ERRORLEVEL% NEQ 0 (
  echo.
  echo  [ERROR] Task registration failed. Try running this .bat as Administrator.
  echo  Right-click install-agent-autostart.bat ^> Run as administrator
  echo.
  pause
  exit /b 1
)

:: ── Add failure restart behavior via XML patch ────────────────────────────
:: schtasks /create doesn't expose restart-on-failure directly.
:: Export → patch XML → reimport.

set TMPXML=%TEMP%\imperio_agent_task.xml

schtasks /query /tn "%TASK_NAME%" /xml ONE > "%TMPXML%" 2>&1

:: Inject restart settings into the XML before </Settings>
powershell -NoProfile -Command ^
  "(Get-Content '%TMPXML%') -replace '</Settings>', '<RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure></Settings>' | Set-Content '%TMPXML%'"

schtasks /delete /tn "%TASK_NAME%" /f >nul 2>&1
schtasks /create /tn "%TASK_NAME%" /xml "%TMPXML%" /f >nul 2>&1

del "%TMPXML%" >nul 2>&1

:: ── Start it now without needing a reboot ─────────────────────────────────
echo  Starting agent now...
schtasks /run /tn "%TASK_NAME%" >nul 2>&1

:: ── Give it 5 seconds then health check ──────────────────────────────────
timeout /t 5 /nobreak >nul

echo  Checking agent health...
curl -s http://localhost:3100/health >nul 2>&1
if %ERRORLEVEL% EQU 0 (
  echo.
  echo  ╔══════════════════════════════════════════════════╗
  echo  ║   AGENT IS RUNNING  ●  http://localhost:3100     ║
  echo  ║   Auto-starts on every login from now on.        ║
  echo  ║   To stop:  schtasks /end /tn ImperioSCCAgent    ║
  echo  ║   To remove: schtasks /delete /tn ImperioSCCAgent /f ║
  echo  ╚══════════════════════════════════════════════════╝
) else (
  echo.
  echo  Task registered. Agent may still be starting up.
  echo  Wait 30 seconds then check SCC DIBBS tab agent status pill.
  echo  If still offline: run start-agent.bat once to verify manually.
)

echo.
pause