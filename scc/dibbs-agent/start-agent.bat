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

wsl bash -c "cd /home/tu2kel/thok_Apps/thokWebsite/THOK_Site/scc/dibbs-agent && node agent-launcher.js"

echo.
echo  [ERROR] Agent stopped unexpectedly. Check the error above.
pause
