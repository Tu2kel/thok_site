// Run once: node get-token.js
// Gets refresh token for kelley.anthonyk@gmail.com
// Paste CLIENT_ID and CLIENT_SECRET from Google Cloud Console below

const CLIENT_ID     = "PASTE_CLIENT_ID_HERE";
const CLIENT_SECRET = "PASTE_CLIENT_SECRET_HERE";
const REDIRECT_URI  = "urn:ietf:wg:oauth:2.0:oob";
const SCOPE         = "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly";

const authUrl =
  "https://accounts.google.com/o/oauth2/auth" +
  "?client_id=" + CLIENT_ID +
  "&redirect_uri=" + encodeURIComponent(REDIRECT_URI) +
  "&response_type=code" +
  "&scope=" + encodeURIComponent(SCOPE) +
  "&access_type=offline" +
  "&prompt=consent";

console.log("\n1. Open this URL in your browser (sign in as kelley.anthonyk@gmail.com):\n");
console.log(authUrl);
console.log("\n2. Paste the code you receive below and press Enter:\n");

process.stdin.resume();
process.stdin.setEncoding("utf8");
process.stdin.once("data", async (code) => {
  code = code.trim();
  const params = new URLSearchParams({
    code,
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri:  REDIRECT_URI,
    grant_type:    "authorization_code",
  });

  const res  = await fetch("https://oauth2.googleapis.com/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    params.toString(),
  });
  const data = await res.json();

  if (data.refresh_token) {
    console.log("\n✅ SUCCESS — add these to Railway env vars:\n");
    console.log("GOOGLE_CLIENT_ID     =", CLIENT_ID);
    console.log("GOOGLE_CLIENT_SECRET =", CLIENT_SECRET);
    console.log("GOOGLE_REFRESH_TOKEN =", data.refresh_token);
  } else {
    console.log("\n❌ Failed:", JSON.stringify(data, null, 2));
  }
  process.exit(0);
});
