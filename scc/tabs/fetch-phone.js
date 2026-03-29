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

  // US phone regex — matches (xxx) xxx-xxxx, xxx-xxx-xxxx, xxx.xxx.xxxx, +1xxxxxxxxxx
  const PHONE_RE =
    /(?:\+1[\s.-]?)?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/g;

  // Pages to try in order
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
          "User-Agent":
            "Mozilla/5.0 (compatible; SCC-PhoneFetch/1.0)",
          Accept: "text/html",
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const html = await res.text();

      // Strip tags to get visible text only
      const text = html.replace(/<[^>]+>/g, " ");
      const matches = text.match(PHONE_RE);
      if (matches && matches.length > 0) {
        // Clean up and return first match
        const phone = matches[0].trim().replace(/\s+/g, " ");
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone }),
        };
      }
    } catch {
      // try next URL
    }
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: null }),
  };
};
