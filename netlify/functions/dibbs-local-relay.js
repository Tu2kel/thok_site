// netlify/functions/dibbs-local-relay.js
// Imperio SCC — Local Agent Relay
//
// SCC calls this Netlify function.
// This function calls the local agent at http://localhost:3100/fetch-sol
// BUT: Netlify runs in the cloud, not on your laptop.
//
// SOLUTION: This function checks if DIBBS_AGENT_URL env var is set.
// In production (Netlify cloud): use the fallback parser (ScraperAPI/direct).
// In local dev (localhost:8888): proxy directly to localhost:3100.
//
// For production use, the SCC frontend calls the local agent DIRECTLY
// via a configurable agent URL stored in localStorage.
// This function is kept as a fallback only.

const HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: HEADERS, body: "" };
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ ok: false, error: "Invalid JSON" }) }; }

  const agentUrl = process.env.DIBBS_AGENT_URL || "http://localhost:3100";

  try {
    const res = await fetch(agentUrl + "/fetch-sol", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(40000),
    });
    const data = await res.json();
    return { statusCode: res.ok ? 200 : 502, headers: HEADERS, body: JSON.stringify(data) };
  } catch (err) {
    return {
      statusCode: 503,
      headers: HEADERS,
      body: JSON.stringify({
        ok: false,
        error: "Local agent unreachable: " + err.message,
        hint: "Make sure start-agent.bat is running on your machine.",
      }),
    };
  }
};
