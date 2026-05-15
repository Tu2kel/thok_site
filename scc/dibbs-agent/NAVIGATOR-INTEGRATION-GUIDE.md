# IMPERIO SCC × NAVIGATOR INTEGRATION GUIDE
# Step-by-step setup for automated batch scraping + win-prob analysis

---

## OVERVIEW

The Navigator workflow runs in two places:

**1. LOCAL AGENT** (Node.js on your Windows machine)
- Files: `dibbs-agent.js` (existing) + `navigator-scraper.js` (new)
- Puppeteer login to Navigator → scrape daily batch by FSC lanes
- Exposes HTTP endpoint: `http://localhost:3100/navigator/batch`
- Returns raw JSON: `{ sols: [...], count, timestamp, ... }`

**2. SCC** (Browser app, Netlify)
- Files: `navigator-analyzer.js`, `rfq-seed-router.js`, `rfq-router-ui.js` (all client-side)
- Calls agent → receives raw sols
- Runs hard-reject gate → bid math → win-probability calc
- Displays ranked results: 🟢 GO / 🟡 VERIFY / ❌ REJECTED
- One-click RFQ batch blast for all GO candidates

---

## FILE MAP — WHERE EACH FILE LIVES

```
dibbs-agent/                          ← LOCAL MACHINE (Node.js)
├── dibbs-agent.js                    (existing — patch per Step 3)
├── navigator-scraper.js              (new)
└── .env                              (from _env_navigator.mock — fill in credentials)

THOK_Site/scc/                        ← SCC BROWSER APP (Netlify)
├── navigator-analyzer.js             (new)
├── rfq-seed-router.js                (new)
├── rfq-router-ui.js                  (new)
└── scc_index.html                    (patch per Step 4)
```

---

## STEP 1 — Install Dependencies

On your Windows machine (WSL/Ubuntu where dibbs-agent runs):

```bash
cd /home/tu2kel/thok_Apps/thokWebsite/THOK_Site/scc/dibbs-agent
npm install puppeteer dotenv

# Verify (may take 2-3 min on first install)
npm list puppeteer
```

---

## STEP 2 — Create .env File

Rename `_env_navigator.mock` → `.env` and save to:
```
/home/tu2kel/thok_Apps/thokWebsite/THOK_Site/scc/dibbs-agent/.env
```

Fill in your actual Navigator credentials:
```
NAVIGATOR_USERNAME=your_navigator_email@gmail.com
NAVIGATOR_PASSWORD=your_navigator_password
```

All other config (FSC lanes, FE fees, thresholds, blocked CAGEs/OEMs) is pre-filled.

---

## STEP 3 — Patch dibbs-agent.js (Add Navigator Route)

Near the top of `dibbs-agent.js`, after your existing requires:

```js
const NavigatorScraper = require('./navigator-scraper');
```

In the HTTP request handler, add this route (around line 200–250, alongside your other routes):

```js
if (req.url === '/navigator/batch' && req.method === 'GET') {
  console.log('[agent] /navigator/batch request received');
  try {
    const result = await NavigatorScraper.scrapeNavigatorBatch();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('[agent] Navigator error:', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
  return;
}
```

---

## STEP 4 — Add Scripts to scc_index.html

Before `</body>`, add in this order (router must load before UI):

```html
<script src="navigator-analyzer.js"></script>
<script src="rfq-seed-router.js"></script>
<script src="rfq-router-ui.js"></script>
```

Add the Navigator batch fetch button wherever fits in your layout:

```html
<button id="fetch-navigator-btn" style="background: #c9a84c; color: #111012; padding: 10px 20px; border: none; cursor: pointer; font-weight: bold;">
  ⬇️ Fetch Navigator Batch
</button>

<div id="rfq-router-container"></div>
```

---

## STEP 5 — Wire Into app.js

In your app.js init function, add:

```js
// Load rolodex from IndexedDB
const rolodex = await db.getRolodex();

// Initialize RFQ Router UI (wires analyzer + seed router together)
RFQRouterUI.init(rolodex, {
  blockedCAGEs: ['07482', '062W0', '81SA7', 'R9004', '75Q65'],
  blockedOEMs:  ['SUREFIRE', 'STREAMLIGHT', 'FURUNO'],
  blockedNSNs:  [],
});

// Bind fetch button to Navigator Tab
document.getElementById('fetch-navigator-btn')?.addEventListener('click', async () => {
  const res = await fetch('http://localhost:3100/navigator/batch');
  const data = await res.json();
  if (data.ok) {
    RFQRouterUI.analyzeBatch(data.sols);
  } else {
    alert('Navigator fetch failed: ' + data.error);
  }
});
```

---

## STEP 6 — Test

1. Start the agent: double-click `start-agent.bat`
   - Should log: `[agent] Listening on http://localhost:3100`

2. Test the endpoint directly in browser:
   `http://localhost:3100/navigator/batch`
   - Should return JSON with scraped sols

3. Open SCC, click **Fetch Navigator Batch**
   - Watch browser console for `[RFQRouter]` logs
   - Results should appear: GO / LOCKED / UNMATCHED sections

---

## TROUBLESHOOTING

| Error | Fix |
|---|---|
| `Failed to fetch: CORS` | Agent not running, or wrong port (check 3100) |
| `Login failed` | Check `.env` credentials — NAVIGATOR_USERNAME / NAVIGATOR_PASSWORD |
| `No table found` | Navigator HTML structure changed — update column indices in `navigator-scraper.js` |
| Puppeteer timeout | Increase `NAVIGATOR_PAGE_TIMEOUT` in `.env` (try 30000) |
| Puppeteer install fail | Run `npm install puppeteer --save` in the agent folder |

---

## AUTOMATION (OPTIONAL)

Auto-run the batch every morning via node-cron in `dibbs-agent.js`:

```bash
npm install node-cron
```

```js
const cron = require('node-cron');

// Run at 6:00 AM daily
cron.schedule('0 6 * * *', async () => {
  console.log('[agent] Scheduled Navigator batch starting...');
  const result = await NavigatorScraper.scrapeNavigatorBatch();
  console.log(`[agent] Batch complete: ${result.count} sols`);
});
```

---

## FULL WORKFLOW (END STATE)

1. Agent auto-runs at 6 AM → scrapes Navigator batch → saves to backup JSON
2. You open SCC → click **Fetch Navigator Batch**
3. Analyzer runs: hard rejects → bid math → win probability scoring
4. Results display: 🟢 GO ranked by win prob, 🔒 LOCKED, ⚠️ UNMATCHED
5. Click **Generate RFQ Email** per distributor → pre-filled drafts, no sol numbers/NSNs
6. Copy/paste into Gmail, send

No manual triage. No wasted sourcing calls. Batch in, routing plan out.
