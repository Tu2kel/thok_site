/**
 * ONE-TIME USE — run locally to get a new Google OAuth refresh token
 * for kelley.anthonyk@gmail.com (Gmail send scope).
 *
 * Usage:
 *   node tools/get-refresh-token.js
 *
 * Then paste your GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET when prompted.
 * A browser window will open — sign in as kelley.anthonyk@gmail.com and approve.
 * The new refresh token will print in this terminal. Paste it into Netlify as GOOGLE_REFRESH_TOKEN.
 */

const http     = require("http");
const { exec } = require("child_process");
const readline = require("readline");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

async function main() {
  const clientId     = (await ask("GOOGLE_CLIENT_ID:     ")).trim();
  const clientSecret = (await ask("GOOGLE_CLIENT_SECRET: ")).trim();
  rl.close();

  const REDIRECT = "http://localhost:9876/oauth";
  const SCOPE    = "https://www.googleapis.com/auth/gmail.send";

  const authUrl =
    "https://accounts.google.com/o/oauth2/v2/auth" +
    "?client_id="     + encodeURIComponent(clientId) +
    "&redirect_uri="  + encodeURIComponent(REDIRECT) +
    "&response_type=code" +
    "&scope="         + encodeURIComponent(SCOPE) +
    "&access_type=offline" +
    "&prompt=consent";

  console.log("\nOpening browser — sign in as kelley.anthonyk@gmail.com and approve.\n");

  // Try to open the browser
  const opener = process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
  exec(opener + ' "' + authUrl + '"');
  console.log("If browser didn't open, go to:\n" + authUrl + "\n");

  // Local server to catch the redirect
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url  = new URL(req.url, "http://localhost:9876");
      const code = url.searchParams.get("code");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<h2>Got it! Return to the terminal.</h2>");
      server.close();
      if (code) resolve(code); else reject(new Error("No code in redirect"));
    });
    server.listen(9876);
    server.on("error", reject);
  });

  // Exchange code for tokens
  const params = new URLSearchParams({
    code,
    client_id:     clientId,
    client_secret: clientSecret,
    redirect_uri:  REDIRECT,
    grant_type:    "authorization_code",
  });

  const res  = await fetch("https://oauth2.googleapis.com/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    params.toString(),
  });
  const data = await res.json();

  if (!data.refresh_token) {
    console.error("\nFailed:", JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log("\n✓ NEW REFRESH TOKEN:");
  console.log("─".repeat(60));
  console.log(data.refresh_token);
  console.log("─".repeat(60));
  console.log("\nGo to Netlify → Site settings → Environment variables");
  console.log("Update GOOGLE_REFRESH_TOKEN with the token above.");
  console.log("Then redeploy.\n");
}

main().catch((e) => { console.error(e.message); process.exit(1); });
