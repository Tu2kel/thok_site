// netlify/functions/lookup-pn.js
// Looks up approved-source part numbers for a given NSN from DIBBS.
// Handles DIBBS DoD consent banner (chunked ASP.NET VIEWSTATE form POST).

const BASE = "https://www.dibbs.bsm.dla.mil";
const UA   = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

// Extract ALL hidden inputs from a page as { name: value } map
function extractAllHidden(html) {
  const fields = {};
  const re = /<input[^>]+type=["']hidden["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    const nameM  = tag.match(/name=["']([^"']+)["']/);
    const valueM = tag.match(/value=["']([^"']*)["']/);
    if (nameM) fields[nameM[1]] = valueM ? valueM[1] : "";
  }
  return fields;
}

function mergeCookies(existing, header) {
  if (!header) return existing;
  const jar = {};
  (existing || "").split(";").forEach(function (c) {
    const eq = c.indexOf("=");
    if (eq < 0) return;
    const k = c.slice(0, eq).trim();
    if (k) jar[k] = c.slice(eq + 1).trim();
  });
  // set-cookie header: multiple cookies separated by commas but values can contain commas
  // split on ", " followed by a word+= pattern
  header.split(/,(?=\s*[A-Za-z_][^=]+=)/).forEach(function (c) {
    const kv = c.trim().split(";")[0];
    const eq = kv.indexOf("=");
    if (eq < 0) return;
    const k = kv.slice(0, eq).trim();
    if (k) jar[k] = kv.slice(eq + 1).trim();
  });
  return Object.entries(jar).map(function ([k, v]) { return k + "=" + v; }).join("; ");
}

function parsePartNumbers(html) {
  const parts = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trM;
  while ((trM = trRe.exec(html)) !== null) {
    const cells = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let tdM;
    while ((tdM = tdRe.exec(trM[1])) !== null) {
      const txt = tdM[1]
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&#\d+;/g, "")
        .trim();
      cells.push(txt);
    }
    // CAGE = 5-char alphanumeric; Part Number in next cell
    if (
      cells.length >= 2 &&
      /^[A-Z0-9]{5}$/i.test(cells[0]) &&
      cells[1].length > 1 &&
      cells[1].length < 60 &&
      !/^[A-Z0-9]{5}$/i.test(cells[1])
    ) {
      if (!parts.includes(cells[1])) parts.push(cells[1]);
    }
  }
  return parts;
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: "Invalid JSON" }; }

  const { nsn } = body;
  if (!nsn) return { statusCode: 400, body: "Missing nsn" };

  const nsnClean = nsn.replace(/[^0-9]/g, "");
  if (nsnClean.length < 13) return { statusCode: 400, body: "NSN too short: " + nsnClean };

  const gotoPath   = "/rfq/rfqnsn.aspx?value=" + nsnClean + "&category=&scope=";
  const warningUrl = BASE + "/dodwarning.aspx?goto=" + encodeURIComponent(gotoPath);

  try {
    // 1. GET warning page — collect all hidden fields + cookies
    const r1    = await fetch(warningUrl, { headers: { "User-Agent": UA }, redirect: "manual" });
    const html1 = await r1.text();
    let cookies = mergeCookies("", r1.headers.get("set-cookie") || "");

    // Collect ALL hidden fields (handles chunked VIEWSTATE)
    const hidden = extractAllHidden(html1);

    // Add the OK button — actual name is "butAgree", value "OK"
    hidden["butAgree"] = "OK";

    // 2. POST consent
    const form = new URLSearchParams(hidden);

    const r2 = await fetch(warningUrl, {
      method:   "POST",
      headers:  {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":   UA,
        "Cookie":       cookies,
        "Referer":      warningUrl,
      },
      body:     form.toString(),
      redirect: "manual",
    });

    cookies = mergeCookies(cookies, r2.headers.get("set-cookie") || "");
    let loc = r2.headers.get("location") || gotoPath;
    if (!loc.startsWith("http")) {
      loc = BASE + (loc.startsWith("/") ? loc : "/" + loc);
    }

    // 3. GET the NSN page
    const r3      = await fetch(loc, { headers: { "User-Agent": UA, "Cookie": cookies } });
    const nsnHtml = await r3.text();

    const partNumbers = parsePartNumbers(nsnHtml);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, partNumbers, nsn: nsnClean }),
    };
  } catch (e) {
    console.error("lookup-pn error:", e.message, e.stack);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
