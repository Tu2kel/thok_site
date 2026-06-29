// scc/core/dibbs-agent-client.js
// Imperio SCC — DIBBS Local Agent Client
// Called directly from the browser to http://localhost:3100
// No Netlify relay needed — browser makes the fetch() call itself.
// Works because the agent uses CORS headers (Access-Control-Allow-Origin: *)
//
// Usage:
//   const { ok, sol, pdf_base64, error } = await window.SCC_AGENT.fetchSol("SPE4A526T120D");
//   const alive = await window.SCC_AGENT.healthCheck();

(function () {
  const AGENT_URL_KEY = "scc_agent_url";
  const DEFAULT_URL = "https://scc-production-4464.up.railway.app";

  function getAgentUrl() {
    return localStorage.getItem(AGENT_URL_KEY) || DEFAULT_URL;
  }

  function setAgentUrl(url) {
    localStorage.setItem(AGENT_URL_KEY, url.replace(/\/$/, ""));
  }

  async function healthCheck() {
    try {
      const res = await fetch(getAgentUrl() + "/health", {
        method: "GET",
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return false;
      const data = await res.json();
      return data.ok === true;
    } catch {
      return false;
    }
  }

  async function fetchSol(sol_number) {
    const url = getAgentUrl() + "/fetch-sol";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sol_number }),
      signal: AbortSignal.timeout(40000),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Agent HTTP " + res.status);
    }
    return res.json();
  }

  async function clearCookies() {
    const res = await fetch(getAgentUrl() + "/clear-cookies", {
      method: "POST",
      signal: AbortSignal.timeout(5000),
    });
    return res.json();
  }

  async function setBrowserCookies(cookieString) {
    const res = await fetch(getAgentUrl() + "/set-cookies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cookies: cookieString }),
      signal: AbortSignal.timeout(5000),
    });
    return res.json();
  }

  window.SCC_AGENT = {
    healthCheck,
    fetchSol,
    clearCookies,
    setBrowserCookies,
    getAgentUrl,
    setAgentUrl,
  };
  console.log("[SCC_AGENT] Loaded. Agent URL:", getAgentUrl());
})();
