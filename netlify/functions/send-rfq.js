// netlify/functions/send-rfq.js
// Sends RFQ emails via Resend API
// Env vars required:
//   RESEND_API_KEY

const path = require("path");
const fs   = require("fs");

const FROM_ADDRESS = "anthony@ifedlog.com";
const FROM_NAME    = "Anthony K Kelley | Imperio Federal Logistics";
const FROM         = FROM_NAME + " <" + FROM_ADDRESS + ">";

// ---------------------------------------------------------------------------
// PDF injection using pdf-lib
// ---------------------------------------------------------------------------
async function buildCert(sellerName, sellerStreet, sellerCity) {
  const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");

  const templatePath  = path.join(__dirname, "../../scc/assets/Resale_Template.pdf");
  const templateBytes = fs.readFileSync(templatePath);

  const pdfDoc = await PDFDocument.load(templateBytes);
  const page   = pdfDoc.getPages()[0];
  const { height } = page.getSize();

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
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error("RESEND_API_KEY not set");

    const payload = { from: FROM, to: [to], subject, text: emailBody };

    if (attachCert) {
      const pdfBytes = await buildCert(sellerName || "", sellerStreet || "", sellerCity || "");
      payload.attachments = [{
        filename:    "THOK_Resale_Certificate.pdf",
        content:     Buffer.from(pdfBytes).toString("base64"),
      }];
    }

    const res  = await fetch("https://api.resend.com/emails", {
      method:  "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error("Resend error: " + JSON.stringify(data));

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
