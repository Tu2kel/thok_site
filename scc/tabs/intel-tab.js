// scc/tabs/intel-tab.js  — Vendor Intelligence Tab
// NSN-first USASpending lookup + FSC fallback + pending vendor queue
// Replaces the Intel GO/VERIFY buttons in the Screener tab

(function () {
  const { useState, useEffect, useRef } = React;
  const h = React.createElement;

  const PENDING_KEY = "scc_intel_pending_v1";

  // ── helpers ────────────────────────────────────────────────────────────

  const fmtNSN = (raw) => {
    const d = String(raw || "").replace(/\D/g, "");
    return d.length === 13
      ? d.slice(0,4)+"-"+d.slice(4,6)+"-"+d.slice(6,9)+"-"+d.slice(9,13)
      : String(raw || "").trim();
  };

  const detectPrime = (descs) => {
    const kw = ["overhaul","repair","installation","system","assembly","integration","maintenance","service support"];
    const txt = descs.join(" ").toLowerCase();
    return kw.some(k => txt.includes(k));
  };

  const queryUSASpending = async (type, val) => {
    try {
      const filters = type === "fsc"
        ? { award_type_codes: ["A","B","C","D"], psc_codes: { require: [["Product", val.slice(0,2), val]] } }
        : { award_type_codes: ["A","B","C","D"], keywords: [fmtNSN(val), val.replace(/\D/g,"")] };
      const res = await fetch("https://api.usaspending.gov/api/v2/search/spending_by_award/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filters,
          fields: ["Recipient Name", "Award Amount", "Description"],
          sort: "Award Amount", order: "asc",
          limit: 25, page: 1, subawards: false,
        }),
      });
      if (!res.ok) return [];
      const data = await res.json();
      const map = new Map();
      for (const a of data.results || []) {
        const name = (a["Recipient Name"] || "").trim();
        if (!name || name === "MULTIPLE RECIPIENTS") continue;
        const key = name.toUpperCase();
        const amt = Number(a["Award Amount"] || 0);
        if (!map.has(key)) map.set(key, { name, total: 0, count: 0, minAward: 0, descs: [] });
        const e = map.get(key);
        e.total += amt;
        e.count++;
        if (amt > 0 && (e.minAward === 0 || amt < e.minAward)) e.minAward = amt;
        const desc = (a["Description"] || "").trim().slice(0, 100);
        if (desc && !e.descs.includes(desc) && e.descs.length < 3) e.descs.push(desc);
      }
      return [...map.values()];
    } catch { return []; }
  };

  const fetchSAM = async (name) => {
    try {
      const res = await fetch("/.netlify/functions/scc-intel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "samLookup", payload: { name } }),
      });
      const data = await res.json();
      return data.ok ? data.result : null;
    } catch { return null; }
  };

  // ── PendingVendorQueue ─────────────────────────────────────────────────

  function PendingVendorQueue({ showToast }) {
    const [pending, setPending] = useState(() => {
      try { return JSON.parse(localStorage.getItem(PENDING_KEY) || "[]"); } catch { return []; }
    });
    const [adding, setAdding]       = useState(null);
    const [enriching, setEnriching] = useState(false);
    const [enrichProg, setEnrichProg] = useState("");

    if (!pending.length) return null;

    const save = (updated) => {
      localStorage.setItem(PENDING_KEY, JSON.stringify(updated));
      setPending(updated);
    };

    const skip = (id) => save(pending.filter(v => v.id !== id));

    const clearAll = () => {
      if (!confirm("Clear all " + pending.length + " pending vendors?")) return;
      save([]);
    };

    const approve = async (v) => {
      setAdding(v.id);
      try {
        await window.SCC_DIST.distSave({
          id: v.id,
          name: v.name,
          cage: v.cage || "",
          email: v.email || "",
          phone: v.phone || "",
          fsc: v.fsc || [],
          known_nsns: v.nsns || [],
          tags: v.tags || ["usa-spending-verified"],
          notes: v.notes || "",
        });
        await window.SCC_DIST.distReloadCache();
        save(pending.filter(p => p.id !== v.id));
        showToast("Added " + v.name);
      } catch (e) {
        alert("Add failed: " + e.message);
      } finally {
        setAdding(null);
      }
    };

    const approveAll = async () => {
      const safe = pending.filter(v => !v.isPrime);
      for (const v of safe) await approve(v);
    };

    const reenrich = async () => {
      const missing = pending.filter(v => !v.email);
      if (!missing.length) { showToast("All vendors have emails"); return; }
      setEnriching(true);
      let updated = [...pending];
      for (let i = 0; i < missing.length; i++) {
        const v = missing[i];
        setEnrichProg((i+1) + "/" + missing.length + " " + v.name.slice(0,20));
        try {
          const res = await fetch("/.netlify/functions/scc-intel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "samLookup", payload: { name: v.name } }),
          });
          const data = await res.json();
          if (data.ok && data.result) {
            const r = data.result;
            updated = updated.map(u => u.id !== v.id ? u : {
              ...u,
              email: r.email || u.email || "",
              phone: r.phone || u.phone || "",
              cage: r.cage || u.cage || "",
              contact: r.contact || u.contact || "",
              sam: true,
            });
          }
        } catch {}
        await new Promise(r => setTimeout(r, 150));
      }
      localStorage.setItem(PENDING_KEY, JSON.stringify(updated));
      setPending(updated);
      setEnriching(false);
      setEnrichProg("");
      const filled = updated.filter(v => v.email).length;
      showToast("Re-enriched · " + filled + "/" + updated.length + " have email");
    };

    const primeCount    = pending.filter(v => v.isPrime).length;
    const safeCount     = pending.length - primeCount;
    const noEmailCount  = pending.filter(v => !v.email).length;
    const qBlue = "rgba(56,189,248,";

    return h("div", {
      style: { border: "1px solid " + qBlue + ".2)", borderRadius: "6px", overflow: "hidden", marginTop: "24px" },
    },
      // header
      h("div", {
        style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", background: qBlue + ".05)" },
      },
        h("div", { style: { fontFamily: "Cinzel,serif", fontSize: "9px", letterSpacing: ".15em", textTransform: "uppercase", color: qBlue + ".9)", display: "flex", alignItems: "center", gap: "12px" } },
          "⚡ Review Queue — " + pending.length + " pending",
          primeCount > 0 && h("span", { style: { color: "rgba(245,158,11,.8)", fontSize: "8px" } }, "⚠ " + primeCount + " prime?"),
          noEmailCount > 0 && h("span", { style: { color: "var(--body-faint)", fontSize: "8px" } }, noEmailCount + " no email"),
        ),
        h("div", { style: { display: "flex", gap: "8px" } },
          noEmailCount > 0 && h("button", {
            onClick: reenrich, disabled: enriching || !!adding,
            style: { fontFamily: "Cinzel,serif", fontSize: "8px", padding: "4px 10px", background: qBlue + ".08)", border: "1px solid " + qBlue + ".3)", color: qBlue + ".9)", borderRadius: "3px", cursor: enriching ? "wait" : "pointer" },
          }, enriching ? ("⟳ " + enrichProg) : ("⟳ Re-enrich (" + noEmailCount + ")")),
          safeCount > 0 && h("button", {
            onClick: approveAll, disabled: !!adding || enriching,
            style: { fontFamily: "Cinzel,serif", fontSize: "8px", padding: "4px 10px", background: "rgba(61,214,140,.08)", border: "1px solid rgba(61,214,140,.3)", color: "#3dd68c", borderRadius: "3px", cursor: "pointer" },
          }, "Add All Safe (" + safeCount + ")"),
          h("button", {
            onClick: clearAll,
            style: { fontFamily: "Cinzel,serif", fontSize: "8px", padding: "4px 10px", background: "transparent", border: "1px solid rgba(255,255,255,.1)", color: "var(--body-faint)", borderRadius: "3px", cursor: "pointer" },
          }, "Clear"),
        ),
      ),
      // column headers
      h("div", {
        style: { display: "grid", gridTemplateColumns: "1fr 80px 110px 55px 90px 60px 60px", gap: "0 10px", padding: "4px 16px", fontFamily: "Cinzel,serif", fontSize: "7px", letterSpacing: ".12em", textTransform: "uppercase", color: "var(--body-faint)", borderBottom: "1px solid rgba(255,255,255,.06)" },
      },
        h("span", null, "Company"),
        h("span", null, "CAGE"),
        h("span", null, "Email"),
        h("span", { style: { textAlign: "right" } }, "Awards"),
        h("span", { style: { textAlign: "right" } }, "Smallest"),
        h("span", null, ""),
        h("span", null, ""),
      ),
      // rows
      h("div", { style: { maxHeight: "380px", overflowY: "auto" } },
        pending.map(v => {
          const isAdding = adding === v.id;
          return h("div", {
            key: v.id,
            style: { display: "grid", gridTemplateColumns: "1fr 80px 110px 55px 90px 60px 60px", gap: "0 10px", padding: "7px 16px", borderBottom: "1px solid rgba(255,255,255,.03)", alignItems: "center", background: v.isPrime ? "rgba(245,158,11,.03)" : "transparent" },
          },
            h("div", null,
              h("div", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "10px", color: "var(--alabaster)", display: "flex", alignItems: "center", gap: "6px" } },
                v.name,
                v.isPrime && h("span", { title: "Possible prime contractor", style: { fontSize: "8px", color: "rgba(245,158,11,.7)" } }, "⚠"),
                !v.sam && h("span", { title: "Not found in SBA/SAM", style: { fontSize: "8px", color: "var(--body-faint)" } }, "no SAM"),
              ),
              h("div", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "8px", color: "rgba(201,168,76,.5)", marginTop: "2px", display: "flex", gap: "8px" } },
                (v.fsc || []).length > 0 && h("span", null, "FSC " + v.fsc.join(", ")),
                (v.nsns || []).length > 0 && h("span", { style: { color: "rgba(56,189,248,.5)" } }, "NSN " + v.nsns.slice(0,2).join(", ") + (v.nsns.length > 2 ? " +" + (v.nsns.length-2) : "")),
              ),
            ),
            h("span", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "9px", color: "var(--body-dim)" } }, v.cage || "—"),
            h("span", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "9px", color: v.email ? "rgba(56,189,248,.7)" : "var(--body-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: v.email || "" }, v.email || "no email"),
            h("span", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "9px", color: "var(--body-dim)", textAlign: "right" } }, v.awards || "—"),
            h("span", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "9px", color: "rgba(201,168,76,.8)", textAlign: "right" }, title: "Smallest contract · unit price proxy" },
              v.smallestAward > 0 ? "$" + Math.round(v.smallestAward).toLocaleString() : "—",
            ),
            h("button", {
              onClick: () => approve(v), disabled: isAdding,
              style: { fontFamily: "Cinzel,serif", fontSize: "7px", padding: "3px 8px", background: "rgba(61,214,140,.08)", border: "1px solid rgba(61,214,140,.3)", color: "#3dd68c", borderRadius: "3px", cursor: isAdding ? "wait" : "pointer", opacity: isAdding ? 0.6 : 1 },
            }, isAdding ? "…" : "+ Add"),
            h("button", {
              onClick: () => skip(v.id),
              style: { fontFamily: "JetBrains Mono,monospace", fontSize: "9px", padding: "3px 8px", background: "transparent", border: "1px solid rgba(255,255,255,.1)", color: "var(--body-faint)", borderRadius: "3px", cursor: "pointer" },
            }, "Skip"),
          );
        }),
      ),
    );
  }

  // ── Main IntelTab component ────────────────────────────────────────────

  function IntelTab({ showToast }) {
    const [manualInput, setManualInput] = useState("");
    const [solList, setSolList]         = useState([]); // [{nsn, fsc, label}]
    const [running, setRunning]         = useState(null); // "nsn" | "fsc" | null
    const [progress, setProgress]       = useState("");
    const [nsnResults, setNsnResults]   = useState({}); // nsn → count found
    const [queueCount, setQueueCount]   = useState(() => {
      try { return JSON.parse(localStorage.getItem(PENDING_KEY) || "[]").length; } catch { return 0; }
    });

    // Pull GO sols from screener results if available
    const loadFromScreener = () => {
      const raw = localStorage.getItem("scc_screener_results_v1");
      if (!raw) { showToast("No screener results found — run a triage first", true); return; }
      try {
        const results = JSON.parse(raw);
        const goSols = results.filter(r => r.verdict === "GO");
        if (!goSols.length) { showToast("No GO sols in screener results", true); return; }
        const entries = goSols.map(s => ({
          nsn:   (s.nsn || "").trim(),
          fsc:   (s.nsn ? s.nsn.replace(/\D/g,"").slice(0,4) : (s.fsc||"").replace(/\D/g,"").slice(0,4)),
          label: s.item_name || s.sol_number || s.nsn || "unknown",
          sol_number: s.sol_number,
        })).filter(e => e.nsn || e.fsc);
        setSolList(entries);
        setNsnResults({});
        showToast("Loaded " + entries.length + " GO sols");
      } catch (e) {
        showToast("Error loading screener results: " + e.message, true);
      }
    };

    const parseManualInput = () => {
      const lines = manualInput.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
      const entries = lines.map(raw => {
        const clean = raw.replace(/\D/g, "");
        const isNSN = clean.length >= 10;
        return {
          nsn:   isNSN ? clean : "",
          fsc:   isNSN ? clean.slice(0,4) : clean.slice(0,4),
          label: raw,
          sol_number: raw,
        };
      }).filter(e => e.nsn || e.fsc);
      setSolList(entries);
      setNsnResults({});
      showToast("Loaded " + entries.length + " items");
    };

    const runIntel = async (mode) => {
      // mode: "nsn" = NSN-only tight queries, "fsc" = FSC fallback on empties
      if (!solList.length) { showToast("No sols loaded", true); return; }
      setRunning(mode);
      setProgress("");

      const existing = (window.SCC_DIST && window.SCC_DIST.getAll ? window.SCC_DIST.getAll() : []);
      const existNames = new Set(existing.map(d => (d.name||"").toUpperCase().trim()));
      const pendingNow = (() => { try { return JSON.parse(localStorage.getItem(PENDING_KEY) || "[]"); } catch { return []; } })();
      const pendingNames = new Set(pendingNow.map(v => (v.name||"").toUpperCase().trim()));

      const found = new Map();
      const newNsnResults = {};

      const toQuery = mode === "nsn"
        ? solList.filter(s => s.nsn)
        : solList.filter(s => !nsnResults[s.nsn] || nsnResults[s.nsn] === 0); // only empties for FSC fallback

      if (!toQuery.length) {
        showToast(mode === "fsc" ? "No empties to fall back on — run NSN first" : "No NSNs in sol list", true);
        setRunning(null);
        return;
      }

      for (let i = 0; i < toQuery.length; i++) {
        const sol = toQuery[i];
        const label = sol.nsn || sol.fsc;
        setProgress((i+1) + "/" + toQuery.length + " · " + label);

        let rows = [];
        if (mode === "nsn" && sol.nsn) {
          rows = await queryUSASpending("nsn", sol.nsn);
          newNsnResults[sol.nsn] = rows.length;
        } else if (mode === "fsc" && sol.fsc) {
          rows = await queryUSASpending("fsc", sol.fsc);
        }

        for (const v of rows) {
          const key = v.name.toUpperCase().trim();
          if (existNames.has(key) || pendingNames.has(key)) continue;
          if (!found.has(key)) {
            found.set(key, { ...v, fscs: sol.fsc ? [sol.fsc] : [], nsns: sol.nsn ? [sol.nsn] : [] });
          } else {
            const e = found.get(key);
            e.total += v.total; e.count += v.count;
            if (v.minAward > 0 && (e.minAward === 0 || v.minAward < e.minAward)) e.minAward = v.minAward;
            v.descs.forEach(d => { if (!e.descs.includes(d) && e.descs.length < 5) e.descs.push(d); });
            if (sol.fsc && !e.fscs.includes(sol.fsc)) e.fscs.push(sol.fsc);
            if (sol.nsn && !e.nsns.includes(sol.nsn)) e.nsns.push(sol.nsn);
          }
        }
        await new Promise(r => setTimeout(r, 280));
      }

      if (mode === "nsn") setNsnResults(prev => ({ ...prev, ...newNsnResults }));

      const foundArr = [...found.values()];
      const newVendors = [];

      for (let i = 0; i < foundArr.length; i++) {
        const v = foundArr[i];
        setProgress("Contact lookup " + (i+1) + "/" + foundArr.length + " · " + v.name.slice(0,28));
        const sam = await fetchSAM(v.name);
        const isPrime = detectPrime(v.descs);
        newVendors.push({
          id:           "intel-" + Date.now() + "-" + i,
          name:         (sam && sam.name) || v.name,
          cage:         (sam && sam.cage) || "",
          email:        (sam && sam.email) || "",
          phone:        (sam && sam.phone) || "",
          contact:      (sam && sam.contact) || "",
          fsc:          v.fscs,
          nsns:         v.nsns,
          awards:       v.count,
          smallestAward: v.minAward,
          totalAward:   v.total,
          isPrime,
          sam:          !!sam,
          tags:         ["usa-spending-verified", ...(isPrime ? ["possible-prime"] : []), ...(sam ? [] : ["needs-contact"])],
          notes:        v.descs.join(" | ").slice(0,200),
          pendingAt:    new Date().toISOString(),
          source:       mode,
        });
        await new Promise(r => setTimeout(r, 180));
      }

      const updated = [...pendingNow, ...newVendors];
      localStorage.setItem(PENDING_KEY, JSON.stringify(updated));
      setQueueCount(updated.length);
      setProgress("");
      setRunning(null);
      showToast("⚡ Done · " + newVendors.length + " new vendors in queue");
    };

    const gold = "rgba(201,168,76,";
    const blue = "rgba(56,189,248,";
    const green = "rgba(61,214,140,";

    const nsnCount  = solList.filter(s => s.nsn).length;
    const emptyNSNs = solList.filter(s => s.nsn && (nsnResults[s.nsn] === 0)).length;
    const fscOnly   = solList.filter(s => !s.nsn && s.fsc).length;

    return h("div", { style: { padding: "24px", maxWidth: "960px" } },

      // ── Header ──
      h("div", { style: { fontFamily: "Cinzel,serif", fontSize: "11px", letterSpacing: ".2em", textTransform: "uppercase", color: gold + ".9)", marginBottom: "20px" } },
        "⚡ Vendor Intelligence",
      ),

      // ── Input section ──
      h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "20px" } },

        // Manual input
        h("div", { style: { border: "1px solid rgba(255,255,255,.08)", borderRadius: "5px", padding: "14px" } },
          h("div", { style: { fontFamily: "Cinzel,serif", fontSize: "8px", letterSpacing: ".15em", textTransform: "uppercase", color: "var(--body-dim)", marginBottom: "8px" } }, "Manual Input — paste NSNs or FSC codes"),
          h("textarea", {
            value: manualInput,
            onChange: e => setManualInput(e.target.value),
            placeholder: "4320-01-047-1927\n2910012345678\n5305\none per line or comma-separated",
            rows: 5,
            style: { width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)", borderRadius: "3px", color: "var(--alabaster)", fontFamily: "JetBrains Mono,monospace", fontSize: "10px", padding: "8px", resize: "vertical" },
          }),
          h("button", {
            onClick: parseManualInput,
            disabled: !manualInput.trim(),
            style: { marginTop: "8px", fontFamily: "Cinzel,serif", fontSize: "8px", padding: "5px 14px", background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.15)", color: "var(--alabaster)", borderRadius: "3px", cursor: "pointer" },
          }, "Load"),
        ),

        // Screener import
        h("div", { style: { border: "1px solid rgba(255,255,255,.08)", borderRadius: "5px", padding: "14px" } },
          h("div", { style: { fontFamily: "Cinzel,serif", fontSize: "8px", letterSpacing: ".15em", textTransform: "uppercase", color: "var(--body-dim)", marginBottom: "8px" } }, "Import from Screener"),
          h("p", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "9px", color: "var(--body-faint)", lineHeight: "1.6", marginBottom: "12px" } },
            "Pulls all GO sols from the last screener triage. Run triage first, then load here to query USASpending by their specific NSNs.",
          ),
          h("button", {
            onClick: loadFromScreener,
            style: { fontFamily: "Cinzel,serif", fontSize: "8px", padding: "5px 14px", background: gold + ".08)", border: "1px solid " + gold + ".3)", color: gold + ".9)", borderRadius: "3px", cursor: "pointer" },
          }, "Load GO Sols from Screener"),
        ),
      ),

      // ── Sol list summary ──
      solList.length > 0 && h("div", { style: { border: "1px solid rgba(255,255,255,.07)", borderRadius: "5px", padding: "12px 16px", marginBottom: "16px", display: "flex", alignItems: "center", justifyContent: "space-between" } },
        h("div", { style: { display: "flex", gap: "20px", alignItems: "center" } },
          h("span", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "10px", color: "var(--alabaster)" } }, solList.length + " sols loaded"),
          h("span", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "9px", color: blue + ".7)" } }, nsnCount + " with NSN"),
          fscOnly > 0 && h("span", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "9px", color: gold + ".6)" } }, fscOnly + " FSC-only"),
          emptyNSNs > 0 && h("span", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "9px", color: "rgba(245,158,11,.7)" } }, emptyNSNs + " NSN returned 0 → ready for FSC fallback"),
        ),
        h("button", {
          onClick: () => { setSolList([]); setNsnResults({}); },
          style: { fontFamily: "JetBrains Mono,monospace", fontSize: "9px", padding: "3px 10px", background: "transparent", border: "1px solid rgba(255,255,255,.1)", color: "var(--body-faint)", borderRadius: "3px", cursor: "pointer" },
        }, "Clear"),
      ),

      // ── Action buttons ──
      h("div", { style: { display: "flex", gap: "12px", marginBottom: "28px" } },
        h("div", { style: { flex: 1, border: "1px solid " + blue + ".2)", borderRadius: "5px", padding: "14px 18px" } },
          h("div", { style: { fontFamily: "Cinzel,serif", fontSize: "9px", letterSpacing: ".15em", textTransform: "uppercase", color: blue + ".8)", marginBottom: "6px" } }, "NSN Intel"),
          h("p", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "9px", color: "var(--body-faint)", lineHeight: "1.5", marginBottom: "12px" } },
            "Queries USASpending by exact NSN. Tight match — vendors who have literally been paid for this part number before.",
          ),
          h("button", {
            onClick: () => runIntel("nsn"),
            disabled: !!running || !solList.length || nsnCount === 0,
            style: { fontFamily: "Cinzel,serif", fontSize: "9px", letterSpacing: ".1em", padding: "6px 18px", background: blue + ".1)", border: "1px solid " + blue + ".35)", color: blue + ".95)", borderRadius: "3px", cursor: (running || !nsnCount) ? "not-allowed" : "pointer", opacity: (running || !nsnCount) ? 0.5 : 1 },
          }, running === "nsn" ? ("⟳ " + progress) : ("⚡ Run NSN Intel (" + nsnCount + ")")),
        ),

        h("div", { style: { flex: 1, border: "1px solid " + gold + ".2)", borderRadius: "5px", padding: "14px 18px" } },
          h("div", { style: { fontFamily: "Cinzel,serif", fontSize: "9px", letterSpacing: ".15em", textTransform: "uppercase", color: gold + ".8)", marginBottom: "6px" } }, "FSC Fallback"),
          h("p", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "9px", color: "var(--body-faint)", lineHeight: "1.5", marginBottom: "12px" } },
            "Runs FSC-level queries on any NSNs that returned 0 results above, plus any FSC-only entries. Broader sweep, lower confidence.",
          ),
          h("button", {
            onClick: () => runIntel("fsc"),
            disabled: !!running || !solList.length,
            style: { fontFamily: "Cinzel,serif", fontSize: "9px", letterSpacing: ".1em", padding: "6px 18px", background: gold + ".08)", border: "1px solid " + gold + ".3)", color: gold + ".9)", borderRadius: "3px", cursor: (running || !solList.length) ? "not-allowed" : "pointer", opacity: (running || !solList.length) ? 0.5 : 1 },
          }, running === "fsc" ? ("⟳ " + progress) : "⚡ FSC Fallback" + (emptyNSNs + fscOnly > 0 ? " (" + (emptyNSNs + fscOnly) + ")" : "")),
        ),
      ),

      // ── NSN result summary (after NSN run) ──
      Object.keys(nsnResults).length > 0 && h("div", { style: { marginBottom: "20px" } },
        h("div", { style: { fontFamily: "Cinzel,serif", fontSize: "8px", letterSpacing: ".12em", textTransform: "uppercase", color: "var(--body-dim)", marginBottom: "8px" } }, "NSN Query Results"),
        h("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px" } },
          solList.filter(s => s.nsn && nsnResults[s.nsn] !== undefined).map(s =>
            h("div", { key: s.nsn, style: { fontFamily: "JetBrains Mono,monospace", fontSize: "8px", padding: "3px 8px", borderRadius: "3px", background: nsnResults[s.nsn] > 0 ? "rgba(61,214,140,.08)" : "rgba(245,158,11,.06)", border: "1px solid " + (nsnResults[s.nsn] > 0 ? "rgba(61,214,140,.25)" : "rgba(245,158,11,.2)"), color: nsnResults[s.nsn] > 0 ? "#3dd68c" : "rgba(245,158,11,.8)" } },
              fmtNSN(s.nsn) + " · " + (nsnResults[s.nsn] > 0 ? nsnResults[s.nsn] + " vendors" : "0 — try FSC fallback"),
            )
          ),
        ),
      ),

      // ── Pending Queue ──
      h(PendingVendorQueue, { showToast }),
    );
  }

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.IntelTab = IntelTab;
})();
