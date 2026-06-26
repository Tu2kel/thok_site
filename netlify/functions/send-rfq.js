// netlify/functions/send-rfq.js
// Injects seller info into Texas Resale Cert, sends email via Gmail API (Google Workspace)
// Env vars required:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
//   (all scoped to anthony@ifedlog.com — Google Workspace)

const path = require("path");
const fs   = require("fs");

const FROM_ADDRESS  = "kelley.anthonyk@gmail.com";
const FROM_NAME     = "Anthony K Kelley | Imperio Federal Logistics";
const TOKEN_URL     = "https://oauth2.googleapis.com/token";
const GMAIL_SEND    = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

// ---------------------------------------------------------------------------
// PDF injection using pdf-lib
// ---------------------------------------------------------------------------
async function buildCert(sellerName, sellerStreet, sellerCity) {
  const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");

  const templatePath = path.join(__dirname, "../../scc/assets/Resale_Template.pdf");
  const templateBytes = fs.readFileSync(templatePath);

  const pdfDoc = await PDFDocument.load(templateBytes);
  const page   = pdfDoc.getPages()[0];
  const { height } = page.getSize(); // 792

  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontSize = 10;

  const fields = [
    { text: sellerName,   x: 75,  y: height - 302.9 + 6 },
    { text: sellerStreet, x: 112, y: height - 331.9 + 6 },
    { text: sellerCity,   x: 135, y: height - 358.9 + 6 },
  ];

  for (const f of fields) {
    if (!f.text) continue;
    page.drawText(f.text, { x: f.x, y: f.y, size: fontSize, font, color: rgb(0, 0, 0) });
  }

  return await pdfDoc.save();
}

// ---------------------------------------------------------------------------
// Gmail OAuth2: refresh access token
// ---------------------------------------------------------------------------
async function getAccessToken() {
  const params = new URLSearchParams({
    grant_type:    "refresh_token",
    client_id:     process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
  });

  const res  = await fetch(TOKEN_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    params.toString(),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Google token refresh failed: " + JSON.stringify(data));
  return data.access_token;
}

// ---------------------------------------------------------------------------
// Build RFC 2822 MIME message, encode as base64url
// ---------------------------------------------------------------------------
function buildMimeMessage({ to, subject, body, pdfBytes, pdfFilename }) {
  const boundary = "SCC_MIME_" + Date.now();
  const CRLF     = "\r\n";

  if (!pdfBytes) {
    // HTML message
    const msg = [
      "From: " + FROM_NAME + " <" + FROM_ADDRESS + ">",
      "To: " + to,
      "Subject: " + subject,
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=utf-8",
      "",
      body,
    ].join(CRLF);
    return Buffer.from(msg).toString("base64url");
  }

  // Multipart with PDF attachment
  const parts = [
    "--" + boundary,
    "Content-Type: text/html; charset=utf-8",
    "",
    body,
    "",
    "--" + boundary,
    "Content-Type: application/pdf",
    "Content-Disposition: attachment; filename=\"" + pdfFilename + "\"",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(pdfBytes).toString("base64"),
    "--" + boundary + "--",
  ].join(CRLF);

  const msg = [
    "From: " + FROM_NAME + " <" + FROM_ADDRESS + ">",
    "To: " + to,
    "Subject: " + subject,
    "MIME-Version: 1.0",
    "Content-Type: multipart/mixed; boundary=\"" + boundary + "\"",
    "",
    parts,
  ].join(CRLF);

  return Buffer.from(msg).toString("base64url");
}

// ---------------------------------------------------------------------------
// Send via Gmail API
// ---------------------------------------------------------------------------
async function sendGmailMessage({ to, subject, body, pdfBytes, pdfFilename }) {
  const token  = await getAccessToken();
  const raw    = buildMimeMessage({ to, subject, body, pdfBytes, pdfFilename });

  const res = await fetch(GMAIL_SEND, {
    method:  "POST",
    headers: {
      Authorization:  "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });

  const result = await res.json();
  if (!res.ok) throw new Error("Gmail send failed: " + JSON.stringify(result));
  return result;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: "Invalid JSON" }; }

  const { to, subject, emailBody, sellerName, sellerStreet, sellerCity, attachCert } = body;

  if (!to || !subject || !emailBody) {
    return { statusCode: 400, body: "Missing required fields: to, subject, emailBody" };
  }

  try {
    let pdfBytes   = null;
    let pdfFilename = null;

    if (attachCert) {
      pdfBytes    = await buildCert(sellerName || "", sellerStreet || "", sellerCity || "");
      pdfFilename = "THOK_Resale_Certificate.pdf";
    }

    await sendGmailMessage({ to, subject, body: emailBody, pdfBytes, pdfFilename });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    console.error("send-rfq error:", err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
