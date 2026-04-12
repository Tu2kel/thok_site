// netlify/functions/fetch-phone.js
// Scrapes DLA CAGE lookup page for supplier phone number
// POST body: { url: "https://cage.dla.mil/Search/CageSearchResults?searchType=cage&cageCode=XXXXX" }
//            OR any direct supplier website URL

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let url;
  try {
    ({ url } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  if (!url || !url.startsWith("http")) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid URL" }) };
  }

  // US phone regex
  const PHONE_RE = /(?:\+1[\s.-]?)?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/g;

  // ── Try the URL directly (works for DLA CAGE page and supplier sites) ──────
  const origins = [url];
  try {
    const base = new URL(url).origin;
    // If it's a supplier website (not DLA), also try contact pages
    if (!url.includes("dla.mil")) {
      if (!url.includes("/contact")) origins.push(base + "/contact");
      if (!url.includes("/contact-us")) origins.push(base + "/contact-us");
      if (!url.includes("/about")) origins.push(base + "/about");
    }
  } catch {}

  for (const target of origins) {
    try {
      const res = await fetch(target, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
      const matches = text.match(PHONE_RE);
      if (matches && matches.length > 0) {
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: matches[0].trim() }),
        };
      }
    } catch {}
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: null }),
  };
};
