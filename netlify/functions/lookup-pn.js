// netlify/functions/lookup-pn.js
// Looks up approved-source part numbers for a given NSN from DIBBS.
// Handles the DoD consent banner (ASP.NET form POST) before scraping.

const BASE = "https://www.dibbs.bsm.dla.mil";
const UA   = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

function extractHidden(html, name) {
  const re = new RegExp(
    'name=["\']' + name + '["\'][^>]+value=["\']([^"\']*)["\']' +
    '|value=["\']([^"\']*)["\'][^>]+name=["\']' + name + '["\']'
  );
  const m = html.match(re);
  return m ? (m[1] !== undefined ? m[1] : m[2] || "") : "";
}

function mergeCookies(existing, header) {
  if (!header) return existing;
  const jar = {};
  existing.split(";").forEach(function (c) {
    const [k, v] = c.trim().split("=");
    if (k && k.trim()) jar[k.trim()] = v || "";
  });
  header.split(/,(?=\s*[A-Za-z_][^=]+=)/).forEach(function (c) {
    const kv = c.trim().split(";")[0];
    const [k, v] = kv.split("=");
    if (k && k.trim()) jar[k.trim()] = v || "";
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
      cells[1].length < 50 &&
      !/^[A-Z0-9]{5}$/i.test(cells[1]) // avoid grabbing another CAGE
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
    // 1. GET warning page
    const r1   = await fetch(warningUrl, { headers: { "User-Agent": UA }, redirect: "manual" });
    const html1 = await r1.text();
    let cookies = mergeCookies("", r1.headers.get("set-cookie") || "");

    // Extract ASP.NET hidden fields
    const vs  = extractHidden(html1, "__VIEWSTATE");
    const vsg = extractHidden(html1, "__VIEWSTATEGENERATOR");
    const ev  = extractHidden(html1, "__EVENTVALIDATION");

    // Find the OK button name
    let btnName = "btn_ok";
    const btnPatterns = [
      /name="([^"]+)"[^>]*value="[Oo][Kk]"/,
      /value="[Oo][Kk]"[^>]*name="([^"]+)"/,
      /<(?:input|button)[^>]+type="submit"[^>]*name="([^"]+)"/i,
    ];
    for (const pat of btnPatterns) {
      const m = html1.match(pat);
      if (m) { btnName = m[1]; break; }
    }

    // 2. POST consent (click OK)
    const form = new URLSearchParams({
      __VIEWSTATE:          vs,
      __VIEWSTATEGENERATOR: vsg,
      __EVENTVALIDATION:    ev,
      [btnName]:            "Ok",
    });

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
    if (!loc.startsWith("http")) loc = BASE + (loc.startsWith("/") ? "" : "/") + loc.replace(/^\//, "");

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
    console.error("lookup-pn error:", e.message);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
