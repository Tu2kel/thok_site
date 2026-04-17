// netlify/functions/send-rfq.js
// Injects seller info into Texas Resale Cert, sends RFQ email via Zoho Mail API
// Env vars required:
//   ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_ACCOUNT_ID
//   (ZOHO_ACCOUNT_ID = numeric account ID from Zoho Mail API)

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

// ---------------------------------------------------------------------------
// PDF injection using pdf-lib (pure JS, no Python needed in Netlify runtime)
// ---------------------------------------------------------------------------
async function buildCert(sellerName, sellerStreet, sellerCity) {
  const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");

  const templatePath = path.join(
    __dirname,
    "../../scc/assets/Resale_Template.pdf",
  );
  const templateBytes = fs.readFileSync(templatePath);

  const pdfDoc = await PDFDocument.load(templateBytes);
  const page = pdfDoc.getPages()[0];
  const { height } = page.getSize(); // 792

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontSize = 10;

  // Coordinates derived from pdfplumber inspection (points from bottom)
  // Seller:        label bottom=302.9  -> y = 792 - 302.9 + 6 = 495.1
  // Street address: label bottom=331.9 -> y = 792 - 331.9 + 6 = 466.1
  // City/State/ZIP: label bottom=358.9 -> y = 792 - 358.9 + 6 = 439.1

  const fields = [
    { text: sellerName, x: 75, y: height - 302.9 + 6 },
    { text: sellerStreet, x: 112, y: height - 331.9 + 6 },
    { text: sellerCity, x: 135, y: height - 358.9 + 6 },
  ];

  for (const f of fields) {
    if (!f.text) continue;
    page.drawText(f.text, {
      x: f.x,
      y: f.y,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });
  }

  return await pdfDoc.save();
}

// ---------------------------------------------------------------------------
// Zoho Mail: refresh access token, then send with attachment
// ---------------------------------------------------------------------------
async function getZohoAccessToken() {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    refresh_token: process.env.ZOHO_REFRESH_TOKEN,
  });

  const res = await fetch("https://accounts.zoho.com/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error("Zoho token refresh failed: " + JSON.stringify(data));
  }
  return data.access_token;
}

async function sendZohoEmail({ to, subject, body, pdfBytes, pdfFilename }) {
  const token = await getZohoAccessToken();
  const accountId = process.env.ZOHO_ACCOUNT_ID;

  // Zoho Mail API requires multipart/form-data for attachments
  const boundary = "----SCC_BOUNDARY_" + Date.now();
  const CRLF = "\r\n";

  const pdfBase64 = Buffer.from(pdfBytes).toString("base64");

  // Build message JSON part
  const messageJson = JSON.stringify({
    fromAddress: "anthony@imperiovita.co",
    toAddress: to,
    subject: subject,
    content: body,
    mailFormat: "plaintext",
  });

  let multipart = "";
  multipart += `--${boundary}${CRLF}`;
  multipart += `Content-Disposition: form-data; name="message"${CRLF}${CRLF}`;
  multipart += messageJson + CRLF;

  // Attachment part
  multipart += `--${boundary}${CRLF}`;
  multipart += `Content-Disposition: form-data; name="attachment"; filename="${pdfFilename}"${CRLF}`;
  multipart += `Content-Type: application/pdf${CRLF}`;
  multipart += `Content-Transfer-Encoding: base64${CRLF}${CRLF}`;
  multipart += pdfBase64 + CRLF;
  multipart += `--${boundary}--${CRLF}`;

  const res = await fetch(
    `https://mail.zoho.com/api/accounts/${accountId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: multipart,
    },
  );

  const result = await res.json();
  if (result.status?.code !== 200) {
    throw new Error("Zoho send failed: " + JSON.stringify(result));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const {
    to,
    subject,
    emailBody,
    sellerName,
    sellerStreet,
    sellerCity,
    attachCert,
  } = body;

  if (!to || !subject || !emailBody) {
    return {
      statusCode: 400,
      body: "Missing required fields: to, subject, emailBody",
    };
  }

  try {
    let pdfBytes = null;
    let pdfFilename = null;

    if (attachCert) {
      pdfBytes = await buildCert(
        sellerName || "",
        sellerStreet || "",
        sellerCity || "",
      );
      pdfFilename = "THOK_Resale_Certificate.pdf";
    }

    await sendZohoEmail({
      to,
      subject,
      body: emailBody,
      pdfBytes,
      pdfFilename,
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    console.error("send-rfq error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
