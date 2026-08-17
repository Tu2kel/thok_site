// ═══════════════════════════════════════════════════════════════════════
//  IMPERIO SCC — ISOLATION BLAST · DIRECT AUTO-RFQ INJECTOR
//  Paste this whole file into the SCC app tab's DevTools console.
//
//  WHEN TO USE: DIBBS fetch / Navigator is down (or you just have the rows
//  from a Navigator screenshot). This feeds pre-built records straight into
//  SCC_AUTO_RFQ.runBatch — skipping the per-sol re-fetch that dibbs-ingest
//  normally does. You already have the part numbers, so the fetch is dead weight.
//
//  REPOST / LHF NOTE: DIBBS reposts (and low-hanging-fruit) show PAST "Quote Due"
//  dates but are usually still quotable. Leave the `due` field "" (blank) so
//  solIsStillBiddable() doesn't drop them. Put a real date ONLY when it's
//  genuinely in the future (>= today + 2 days).
//
//  RESTRICTED items (AIDC / Supplier Restrictions = Restricted / AMSC "T")
//  are approved-source-locked — DO NOT put them here. Only Unrestricted
//  AN / MS / NAS / MIL / AS parts route through the isolation blast.
//
//  Row format:
//    R(sol, item, partNo, nsn13, qty, unitOfIssue, unitPrice, extPrice, deliveryDays, due)
//
//  All three controls sort records by extended price DESC first, so the
//  test cap of 10 always takes the highest-value 10 (highest → lowest).
//
//  Controls (after paste):
//    ISO.plan()   → dry run, prints vendor plan, SENDS NOTHING
//    ISO.test()   → top 10 by ext price → tu2kel.lg@gmail.com ([TEST])
//    ISO.live()   → real distributor emails via Resend  ← the actual blast
//    ISO.plan(myRecords) / ISO.live(myRecords) → run a different array
// ═══════════════════════════════════════════════════════════════════════

(function () {
  const R = (sol, item, pn, nsn, qty, ui, up, ext, del, due) => ({
    sol_number: sol,
    verdict: "GO", // REQUIRED — runBatch shunts anything not "GO" to verify-first
    item_name: item,
    ref_part_number: pn,
    nsn: nsn,
    fsc: (nsn || "").slice(0, 4),
    quantity: qty,
    unit_of_issue: ui,
    unit_price: up,
    ext: ext, // vendor-queue sorts ext desc, caps 10/vendor
    delivery_days: del,
    quote_due: due || "", // blank = repost, still quotable, don't drop
  });

  // ── BATCH ROWS — replace/extend each run ──────────────────────────────
  const RECORDS = [
    // NAS — screws / rivets / bolts / packing / retainers (Unrestricted)
    R("SPE4A626T04XW", "SCREW,CAP,SOCKET HEAD", "NAS1351-3LE20P", "5305010296363", 290, "EA", "9.97", 2891.30, 170, "07/21/26"),
    R("SPE4A626T04XE", "SCREW,CLOSE TOLERAN", "NAS1581F5T19", "5305010587062", 932, "EA", "4.25", 3961.00, 170, "07/21/26"),
    R("SPE4A626T04RA", "RIVET,BLIND", "NAS9307M-4-05", "5320013883815", 3491, "EA", "0.99", 3456.09, 99, "07/21/26"),
    R("SPE7M226T5384", "RIVET,BLIND", "NAS9307M-4-02", "5320014392968", 17850, "EA", "11.22", 200277.00, 27, ""),
    R("SPE4A626T02MH", "RIVET,BLIND", "NAS9307M-6-03", "5320013350058", 15809, "EA", "8.75", 138328.80, 168, ""),
    R("SPE7L326T094N", "PACKING WITH RETAIN", "NAS1523AA3Y", "5330011241277", 60292, "EA", "0.70", 42355.13, 172, ""),
    R("SPE4A626T00UF", "RIVET,BLIND", "NAS9305BNS-6-04", "5320010339126", 885, "HD", "42.56", 37665.60, 140, ""),
    R("SPE4A726T549J", "BOLT,SHEAR", "NAS6704U1", "5306003233541", 403, "EA", "69.40", 27968.20, 170, ""),
    R("SPE4A626T94D9", "RIVET,BLIND", "NAS1919B06S11", "5320013429523", 244, "EA", "79.96", 19510.24, 70, ""),
    R("SPE4A626T79G1", "SCREW,MACHINE", "NAS1100E3-7", "5305010104372", 51759, "EA", "0.36", 18633.24, 39, ""),
    R("SPE4A626T89W0", "NUT,SELF-LOCKING,EX", "NASM14144L12", "5310011605719", 515, "EA", "35.71", 18390.65, 169, ""),
    R("SPE4A626T01CL", "SCREW,CLOSE TOLERAN", "NAS1580A4T6", "5305010666750", 1700, "PG", "9.88", 16796.00, 252, ""),
    R("SPE4A626T00RJ", "RIVET,BLIND", "NAS1919M05-02W", "5320009717920", 2581, "EA", "5.23", 13498.63, 140, ""),
    R("SPE4A626T02KZ", "SCREW,CLOSE TOLERAN", "NAS1581F4T4", "5305014174446", 42303, "EA", "0.21", 8883.63, 294, ""),
    R("SPE4A626T95L7", "SCREW,MACHINE", "NAS517-4-6", "5305002060622", 507, "HD", "16.75", 8492.25, 167, ""),
    R("SPE4A626T94P2", "RIVET,BLIND", "NAS1919C04S06U", "5320015643111", 541, "EA", "14.25", 7709.25, 171, ""),
    R("SPE7M426T202A", "RETAINER,NUT AND BO", "NAS578-8A", "5340008094388", 10673, "EA", "0.67", 7150.91, 210, ""),
    // MS — bolts / nuts / washers (Unrestricted)
    R("SPE4A626T01PH", "BOLT,MACHINE", "MS14157-06026", "5306014144934", 9000, "EA", "29.00", 261000.00, 117, ""),
    R("SPE4A626U3251", "NUT,SELF-LOCKING,EX", "MS21084L14", "5310010576204", 1117, "EA", "57.35", 64059.95, 105, ""),
    R("SPE4A626U3156", "NUT,SELF-LOCKING,EX", "MS21084L14", "5310010576204", 1117, "EA", "57.35", 64059.95, 105, ""),
    R("SPE4A626T89U1", "NUT,SELF-LOCKING,EX", "MS14156-06", "5310010647311", 4547, "EA", "9.58", 43560.26, 169, ""),
    R("SPE7M226U0306", "WASHER,LOCK", "MS35338-138", "5310009338120", 18970, "HD", "1.80", 34146.00, 141, ""),
    R("SPE4A626T03HJ", "NUT,SELF-LOCKING,EX", "MS14156-07", "5310010783665", 4217, "EA", "6.28", 26482.76, 169, ""),
    R("SPE4A626T84F7", "NUT,SELF-LOCKING,HE", "MS21044D3", "5310008775798", 411, "HD", "40.00", 16440.00, 267, ""),
    R("SPE4A126T2258", "BOLT,INTERNAL WRENC", "MS20004H26", "5306006391784", 1375, "EA", "9.14", 12567.50, 171, ""),
    // AN — clevis / nut / setscrew (Unrestricted, future due dates kept as-is)
    R("SPE7M426T255C", "CLEVIS,ROD END", "AN665-21R", "5340005305353", 1900, "EA", "10.05", 19095.00, 51, "07/23/26"), // QA=Y + First Article
    R("SPE4A626T05NY", "NUT,PLAIN,CASTELLAT", "AN310C3", "5310001671279", 39, "HD", "108.72", 4240.08, 59, "07/21/26"),
    R("SPE4A626T06ZA", "SETSCREW", "AN565FC1032H20", "5305010232970", 137, "EA", "0.64", 87.68, 162, "07/24/26"),
  ];

  function showPlan(r) {
    console.log(
      "%c PLAN → " + r.plan.length + " vendors · " + r.goCount + " GO sols (nothing sent)",
      "font-weight:bold;color:#c9a227",
    );
    console.table(
      r.plan.map((p) => ({
        vendor: p.dist.name,
        to: p.to,
        items: p.records.length,
        why: (p.reasons || []).join(", ").slice(0, 45),
      })),
    );
    return r;
  }

  // Sort by extended price DESC so the test cap-10 takes the highest-value 10.
  // (runBatch's testMode does biddable.slice(0,10) with no sort of its own.)
  const byExtDesc = (recs) =>
    (recs || RECORDS).slice().sort((a, b) => Number(b.ext || 0) - Number(a.ext || 0));

  window.ISO = {
    records: RECORDS,
    plan: (recs) =>
      SCC_AUTO_RFQ.runBatch(byExtDesc(recs), {
        dryRun: true,
        onLog: (m) => console.log("[dry]", m),
      }).then(showPlan),
    test: (recs) =>
      SCC_AUTO_RFQ.runBatch(byExtDesc(recs), { testMode: true, onLog: console.log }),
    live: (recs) =>
      SCC_AUTO_RFQ.runBatch(byExtDesc(recs), { onLog: console.log }),
  };

  if (!window.SCC_AUTO_RFQ) {
    console.error("❌ Open the SCC app tab first — SCC_AUTO_RFQ not loaded");
    return;
  }
  console.log(
    "%cISO injector ready — ISO.plan() (dry) · ISO.test() (inbox) · ISO.live() (blast)",
    "font-weight:bold",
  );
  console.log(
    "Distributors loaded:",
    (window.SCC_DIST && SCC_DIST.DISTRIBUTORS || []).length,
    "· records:",
    RECORDS.length,
  );
  window.ISO.plan(); // auto dry-run on paste
})();
