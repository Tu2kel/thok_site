// netlify/functions/fetch-phone.js
// Scrapes a supplier website for a contact phone number
// POST body: { url: "https://supplierdomain.com" }

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

  // US phone regex — fallback for HTML scrape paths
  const PHONE_RE = /(?:\+1[\s.-]?)?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/g;

  // ── Path 1: SAM.gov CAGE JSON API ────────────────────────────────────────
  // URL pattern: https://sam.gov/api/prod/sgs/v1/search/?index=ei&q=<CAGE>&pageSize=1
  if (url.includes("sam.gov/api")) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; SCC-PhoneFetch/1.0)",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json();
        // SAM.gov entity search result structure
        const hits = data?._embedded?.results || data?.entityData || [];
        const entity = Array.isArray(hits) ? hits[0] : null;
        const phone =
          entity?.pointsOfContact?.[0]?.phone ||
          entity?.entityRegistration?.physicalAddress?.phone ||
          entity?.coreData?.entityInformation?.entityURL ||
          null;
        if (phone && PHONE_RE.test(phone)) {
          return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phone: phone.trim() }),
          };
        }
        // Also try regex scan over raw JSON text
        const raw = JSON.stringify(data);
        const matches = raw.match(PHONE_RE);
        if (matches && matches.length > 0) {
          return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phone: matches[0].trim() }),
          };
        }
      }
    } catch {}
    // SAM.gov returned nothing — fall through to HTML scrape
  }

  // ── Path 2: Generic HTML scrape (supplier website) ────────────────────────
  const origins = [url];
  try {
    const base = new URL(url).origin;
    if (!url.includes("/contact")) origins.push(base + "/contact");
    if (!url.includes("/contact-us")) origins.push(base + "/contact-us");
  } catch {}

  for (const target of origins) {
    try {
      const res = await fetch(target, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; SCC-PhoneFetch/1.0)",
          Accept: "text/html",
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      const text = html.replace(/<[^>]+>/g, " ");
      const matches = text.match(PHONE_RE);
      if (matches && matches.length > 0) {
        const phone = matches[0].trim().replace(/\s+/g, " ");
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone }),
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
