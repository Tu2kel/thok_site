// src/nsn-watch.js — cross-check scraped sols against MongoDB NSN watch list
// Watched NSNs skip screening — they're already known, just re-solicited.

function info(...a) { console.log("[nsn-watch]", ...a); }

// Returns { watchHits, unwatched }
// watchHits = sols that match a watched NSN (pre-approved GO)
// unwatched = sols that need Claude screening
function checkWatchList(sols, watchList) {
  const watchMap = new Map(watchList.map(w => [w.nsn, w]));

  const watchHits = [];
  const unwatched = [];

  for (const sol of sols) {
    const nsn = (sol.nsn || "").replace(/\D/g, "");
    if (nsn && watchMap.has(nsn)) {
      const watch = watchMap.get(nsn);
      const priceNow  = parseFloat(sol.hist_price || sol.unit_price || 0);
      const pricePrev = parseFloat(watch.last_unit_price || 0);
      const delta     = pricePrev > 0 ? ((priceNow - pricePrev) / pricePrev * 100).toFixed(1) : null;

      watchHits.push({
        ...sol,
        verdict:           "GO",
        winProbabilityPct: 80,
        claudeReason:      "Watched NSN re-solicited — previously sourced",
        sourcing_path:     watch.preferred_cage ? "Preferred vendor CAGE " + watch.preferred_cage : "See watch list",
        watch_record:      watch,
        price_delta_pct:   delta,
        is_watched:        true,
      });
      info("🔔 WATCHED NSN: " + nsn + " | " + sol.item_name + " | Sol: " + sol.sol_number + (delta ? " | Price Δ " + delta + "%" : ""));
    } else {
      unwatched.push(sol);
    }
  }

  info("NSN watch check: " + watchHits.length + " watched hits, " + unwatched.length + " need screening");
  return { watchHits, unwatched };
}

// After a blast run, update last_seen_date and last_unit_price for any hit NSNs
async function updateWatchHits(db, watchHits) {
  if (!watchHits.length) return;
  const col = db.collection("nsn_watch");
  for (const sol of watchHits) {
    const nsn = (sol.nsn || "").replace(/\D/g, "");
    if (!nsn) continue;
    await col.updateOne(
      { nsn },
      {
        $set: {
          last_sol_number:  sol.sol_number,
          last_unit_price:  parseFloat(sol.hist_price || sol.unit_price || 0) || undefined,
          last_seen:        new Date().toISOString().slice(0, 10),
          updated_at:       new Date().toISOString(),
        },
      },
    );
  }
  info("Updated " + watchHits.length + " NSN watch records with latest pricing");
}

module.exports = { checkWatchList, updateWatchHits };
