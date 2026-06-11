// agent-launcher.js — tiny always-on process on port 3101
// Starts/restarts dibbs-agent.js on demand from the SCC frontend.
// Set this (not dibbs-agent) as the Windows Startup shortcut.

const http  = require("http");
const { spawn } = require("child_process");
const path  = require("path");

const PORT        = 3101;
const AGENT_SCRIPT = path.join(__dirname, "dibbs-agent.js");

let agentProc = null;

function startAgent() {
  if (agentProc && !agentProc.killed) {
    try { agentProc.kill(); } catch (_) {}
  }
  agentProc = spawn("node", [AGENT_SCRIPT], {
    detached: false,
    stdio: "inherit",
    cwd: __dirname,
  });
  agentProc.on("exit", (code) => {
    console.log(`[launcher] agent exited (${code})`);
    agentProc = null;
  });
  console.log(`[launcher] agent started (pid ${agentProc.pid})`);
}

// Auto-start agent on launcher boot
startAgent();

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.method === "POST" && req.url === "/start") {
    startAgent();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, pid: agentProc?.pid }));
    return;
  }

  if (req.method === "GET" && req.url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, agentRunning: !!(agentProc && !agentProc.killed) }));
    return;
  }

  res.writeHead(404); res.end();
});

server.listen(PORT, "127.0.0.1", () =>
  console.log(`[launcher] listening on port ${PORT}`)
);
