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

  // ── VendorDrawer ───────────────────────────────────────────────────────

  function VendorDrawer({ vendor: v, onClose, onApprove, onPipeline, onSkip, onReenrich, adding, enrichingSingle }) {
    if (!v) return null;
    const dibbsUrl = (sol) => "https://www.dibbs.bsm.dla.mil/Solicitations/RFQ/SolRFQDetail.aspx?sno=" + encodeURIComponent(sol);

    const Section = ({ label, children }) => h("div", { style: { marginBottom: "20px" } },
      h("div", { style: { fontFamily: "Cinzel,serif", fontSize: "7px", letterSpacing: ".15em", textTransform: "uppercase", color: "var(--gold-dim)", marginBottom: "8px", borderBottom: "1px solid var(--gold-border)", paddingBottom: "4px" } }, label),
      children,
    );

    const Field = ({ label, value, color }) => value ? h("div", { style: { display: "flex", gap: "8px", marginBottom: "5px" } },
      h("span", { style: { fontFamily: "Cinzel,serif", fontSize: "7px", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--body-faint)", minWidth: "56px", paddingTop: "2px" } }, label),
      h("span", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "10px", color: color || "var(--alabaster)", wordBreak: "break-all" } }, value),
    ) : null;

    const DBtn = ({ onClick, disabled, children, variant }) => {
      const s = variant === "blue"  ? { bg: "rgba(56,189,248,.08)",  bc: "rgba(56,189,248,.3)",  c: "rgba(56,189,248,.95)" }
              : variant === "green" ? { bg: "rgba(61,214,140,.07)",  bc: "rgba(61,214,140,.25)", c: "var(--accent-green)" }
              :                       { bg: "transparent",            bc: "rgba(255,255,255,.1)", c: "var(--body-dim)" };
      return h("button", { onClick, disabled, style: { fontFamily: "Cinzel,serif", fontSize: "8px", letterSpacing: ".1em", textTransform: "uppercase", padding: "10px 16px", background: s.bg, border: "1px solid " + s.bc, color: s.c, borderRadius: "4px", cursor: disabled ? "wait" : "pointer", opacity: disabled ? 0.5 : 1, width: "100%" } }, children);
    };

    return h(React.Fragment, null,
      h("div", { onClick: onClose, style: { position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 1000 } }),
      h("div", {
        style: { position: "fixed", right: 0, top: 0, bottom: 0, width: "440px", background: "var(--surface-inset)", zIndex: 1001, overflowY: "auto", padding: "28px", boxShadow: "-4px 0 40px rgba(0,0,0,.7)", borderLeft: "1px solid var(--gold-border)" },
      },
        // header
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "24px" } },
          h("div", null,
            h("div", { style: { fontFamily: "Cinzel,serif", fontSize: "14px", letterSpacing: ".06em", color: "var(--gold-solid)", lineHeight: 1.3 } }, v.name),
            h("div", { style: { fontFamily: "Cormorant Garamond,serif", fontStyle: "italic", fontSize: "12px", color: "var(--gold-dim)", marginTop: "4px", display: "flex", gap: "12px" } },
              v.cage && h("span", null, "CAGE " + v.cage),
              v.sam  && h("span", { style: { color: "var(--accent-green)" } }, "SAM ✓"),
              !v.sam && h("span", null, "no SAM"),
              v.isPrime && h("span", { style: { color: "#f59e0b" } }, "⚠ possible prime"),
            ),
          ),
          h("button", { onClick: onClose, style: { background: "transparent", border: "none", color: "var(--body-faint)", fontSize: "20px", cursor: "pointer", lineHeight: 1, paddingTop: "2px" } }, "×"),
        ),

        Section({ label: "Contact" },
          h("div", null,
            Field({ label: "Email",   value: v.email,   color: "rgba(56,189,248,.85)" }),
            Field({ label: "Phone",   value: v.phone,   color: "rgba(56,189,248,.85)" }),
            Field({ label: "Contact", value: v.contact }),
          ),
        ),

        (v.solRefs && v.solRefs.length > 0) && Section({ label: "Solicitations" },
          h("div", { style: { display: "flex", flexDirection: "column", gap: "8px" } },
            v.solRefs.map((ref, ri) => h("div", { key: ri, style: { background: "rgba(201,168,76,.04)", border: "1px solid var(--gold-border)", borderRadius: "4px", padding: "10px 12px" } },
              h("a", { href: dibbsUrl(ref.sol_number), target: "_blank", rel: "noopener", style: { fontFamily: "Cinzel,serif", fontSize: "8px", letterSpacing: ".08em", color: "var(--gold-solid)", textDecoration: "none", display: "block", marginBottom: "4px" } }, "↗ " + ref.sol_number),
              ref.item_name && h("div", { style: { fontFamily: "Cormorant Garamond,serif", fontSize: "13px", color: "var(--alabaster)", marginBottom: "4px" } }, ref.item_name),
              h("div", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "9px", color: "var(--body-dim)", display: "flex", gap: "12px" } },
                ref.qty       && h("span", null, ref.qty + " ea"),
                ref.ext_price && h("span", { style: { color: "var(--gold-dim)" } }, "$" + Number(ref.ext_price).toLocaleString() + " est"),
              ),
            )),
          ),
        ),

        Section({ label: "Coverage" },
          h("div", null,
            (v.fsc  || []).length > 0 && Field({ label: "FSC",  value: v.fsc.join(", "),  color: "var(--gold-dim)" }),
            (v.nsns || []).length > 0 && Field({ label: "NSNs", value: v.nsns.join(", "), color: "rgba(56,189,248,.6)" }),
          ),
        ),

        Section({ label: "Award History" },
          h("div", null,
            Field({ label: "Awards",   value: v.awards ? String(v.awards) : null }),
            Field({ label: "Smallest", value: v.smallestAward > 0 ? "$" + Math.round(v.smallestAward).toLocaleString() : null, color: "var(--gold-dim)" }),
            Field({ label: "Total",    value: v.totalAward   > 0 ? "$" + Math.round(v.totalAward).toLocaleString()   : null }),
            v.notes && h("div", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "8px", color: "var(--body-faint)", marginTop: "8px", lineHeight: 1.6 } }, v.notes),
          ),
        ),

        h("div", { style: { display: "flex", flexDirection: "column", gap: "8px" } },
          h(DBtn, { onClick: () => onPipeline(v), disabled: !!adding, variant: "blue" }, adding === v.id ? "Adding…" : "→ Send to Pipeline"),
          h(DBtn, { onClick: () => onApprove(v),  disabled: !!adding, variant: "green" }, adding === v.id ? "Adding…" : "+ Add to DB"),
          h(DBtn, { onClick: () => onReenrich(v), disabled: enrichingSingle === v.id }, enrichingSingle === v.id ? "Looking up…" : "⟳ Re-enrich Contact"),
          h(DBtn, { onClick: () => { onSkip(v.id); onClose(); } }, "Skip"),
        ),
      ),
    );
  }

  // ── PendingVendorQueue ─────────────────────────────────────────────────

  function PendingVendorQueue({ showToast }) {
    const [pending, setPending] = useState(() => {
      try { return JSON.parse(localStorage.getItem(PENDING_KEY) || "[]"); } catch { return []; }
    });
    const [adding, setAdding]           = useState(null);
    const [enriching, setEnriching]     = useState(false);
    const [enrichProg, setEnrichProg]   = useState("");
    const [drawer, setDrawer]           = useState(null);
    const [enrichSingle, setEnrichSingle] = useState(null);

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

    const pipeline = async (v) => {
      setAdding(v.id);
      try {
        await window.SCC_DIST.distSave({
          id: v.id, name: v.name, cage: v.cage || "", email: v.email || "",
          phone: v.phone || "", fsc: v.fsc || [], known_nsns: v.nsns || [],
          tags: [...(v.tags || ["usa-spending-verified"]), "pipeline"],
          notes: v.notes || "",
        });
        await window.SCC_DIST.distReloadCache();
        // Push associated solicitations into the active pipeline
        let solsAdded = 0;
        if (v.solRefs && v.solRefs.length > 0 && window.SCC_DB) {
          const existing = await window.SCC_DB.dbGetAll();
          const existingNums = new Set((existing || []).map(s => s.sol_number));
          for (const ref of v.solRefs) {
            if (ref.sol_number && !existingNums.has(ref.sol_number)) {
              const fsc = ref.nsn ? String(ref.nsn).replace(/\D/g, "").slice(0, 4) : "";
              await window.SCC_DB.dbSave({
                sol_number:       ref.sol_number,
                item_name:        ref.item_name || "",
                nsn:              ref.nsn || "",
                fsc,
                quantity:         ref.qty || 0,
                unit_price:       ref.ext_price || 0,
                unit_issue:       "EA",
                status:           "Sourcing",
                date_added:       new Date().toISOString().slice(0, 10),
                notes:            "Vendor Intel → " + v.name,
                screener_verdict: "GO",
              });
              solsAdded++;
            }
          }
        }
        save(pending.filter(p => p.id !== v.id));
        setDrawer(null);
        showToast(solsAdded
          ? "→ Pipeline: " + v.name + " · " + solsAdded + " sol" + (solsAdded !== 1 ? "s" : "") + " added"
          : "→ Pipeline: " + v.name + " (no new sols)");
      } catch (e) { alert("Pipeline failed: " + e.message); }
      finally { setAdding(null); }
    };

    const reenrichOne = async (v) => {
      setEnrichSingle(v.id);
      try {
        const res = await fetch("/.netlify/functions/scc-intel", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "samLookup", payload: { name: v.name } }),
        });
        const data = await res.json();
        if (data.ok && data.result) {
          const r = data.result;
          const updated = pending.map(u => u.id !== v.id ? u : { ...u, email: r.email || u.email || "", phone: r.phone || u.phone || "", cage: r.cage || u.cage || "", contact: r.contact || u.contact || "", sam: true });
          save(updated);
          setDrawer(updated.find(u => u.id === v.id) || null);
          showToast("Contact updated · " + v.name.slice(0, 24));
        } else { showToast("No new contact found", true); }
      } catch { showToast("Re-enrich failed", true); }
      finally { setEnrichSingle(null); }
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

    const primeCount   = pending.filter(v => v.isPrime).length;
    const safeCount    = pending.length - primeCount;
    const noEmailCount = pending.filter(v => !v.email).length;

    const qBtn = (label, onClick, opts = {}) => h("button", {
      onClick, disabled: opts.disabled,
      style: { fontFamily: "Cinzel,serif", fontSize: "7px", letterSpacing: ".1em", textTransform: "uppercase", padding: "4px 11px", borderRadius: "3px", cursor: opts.disabled ? "wait" : "pointer", opacity: opts.disabled ? 0.5 : 1, whiteSpace: "nowrap", background: opts.bg || "transparent", border: "1px solid " + (opts.bc || "rgba(255,255,255,.1)"), color: opts.color || "var(--body-dim)" },
    }, label);

    return h(React.Fragment, null,
      h(VendorDrawer, {
        vendor: drawer, onClose: () => setDrawer(null),
        onApprove: async (v) => { await approve(v); setDrawer(null); },
        onPipeline: pipeline, onSkip: skip, onReenrich: reenrichOne,
        adding, enrichingSingle: enrichSingle,
      }),
      h("div", { style: { background: "#201f2d", border: "1px solid rgba(201,168,76,.38)", borderTop: "2px solid rgba(201,168,76,.65)", borderRadius: "8px", overflow: "hidden", boxShadow: "0 16px 72px rgba(0,0,0,.85), 0 4px 24px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.04)" } },

        // ── Queue header ──
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", background: "#19182500", borderBottom: "1px solid rgba(201,168,76,.22)" } },
          h("div", { style: { display: "flex", alignItems: "center", gap: "14px" } },
            h("span", { style: { fontFamily: "Cinzel,serif", fontSize: "10px", letterSpacing: ".15em", textTransform: "uppercase", color: "var(--gold-solid)" } }, "Review Queue"),
            h("span", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "9px", color: "var(--body-dim)" } }, pending.length + " pending"),
            primeCount > 0  && h("span", { style: { fontFamily: "Cinzel,serif", fontSize: "7px", letterSpacing: ".1em", textTransform: "uppercase", color: "#f59e0b", background: "rgba(245,158,11,.08)", border: "1px solid rgba(245,158,11,.25)", borderRadius: "3px", padding: "2px 7px" } }, "⚠ " + primeCount + " prime?"),
            noEmailCount > 0 && h("span", { style: { fontFamily: "Cinzel,serif", fontSize: "7px", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--body-faint)", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", borderRadius: "3px", padding: "2px 7px" } }, noEmailCount + " no email"),
          ),
          h("div", { style: { display: "flex", gap: "6px" } },
            noEmailCount > 0 && qBtn(enriching ? "⟳ " + enrichProg : "⟳ Re-enrich (" + noEmailCount + ")", reenrich, { disabled: enriching || !!adding, bg: "rgba(56,189,248,.06)", bc: "rgba(56,189,248,.25)", color: "rgba(56,189,248,.85)" }),
            safeCount > 0   && qBtn("Add All Safe (" + safeCount + ")", approveAll, { disabled: !!adding || enriching, bg: "rgba(61,214,140,.07)", bc: "rgba(61,214,140,.25)", color: "var(--accent-green)" }),
            qBtn("Clear", clearAll),
          ),
        ),

        // ── Column headers ──
        h("div", { style: { display: "grid", gridTemplateColumns: "1fr 80px 185px 60px 100px 58px 50px", gap: "0 10px", padding: "6px 16px", fontFamily: "Cinzel,serif", fontSize: "7px", letterSpacing: ".12em", textTransform: "uppercase", color: "var(--body-faint)", borderBottom: "1px solid rgba(255,255,255,.05)", background: "rgba(255,255,255,.018)" } },
          h("span", null, "Company"), h("span", null, "CAGE"), h("span", null, "Email / Phone"),
          h("span", { style: { textAlign: "right" } }, "Awards"),
          h("span", { style: { textAlign: "right" } }, "Smallest"),
          h("span", null, ""), h("span", null, ""),
        ),

        // ── Rows ──
        h("div", { style: { maxHeight: "calc(100vh - 340px)", overflowY: "auto" } },
          pending.map(v => {
            const isAdding = adding === v.id;
            return h("div", {
              key: v.id,
              onClick: (e) => { if (!e.target.closest("button")) setDrawer(v); },
              style: { display: "grid", gridTemplateColumns: "1fr 80px 185px 60px 100px 58px 50px", gap: "0 10px", padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,.06)", alignItems: "start", background: v.isPrime ? "rgba(245,158,11,.08)" : "rgba(255,255,255,.028)", cursor: "pointer", transition: "background .12s" },
            },
              // company cell
              h("div", null,
                h("div", { style: { display: "flex", alignItems: "center", gap: "7px", marginBottom: "3px" } },
                  h("span", { style: { fontFamily: "Cinzel,serif", fontSize: "10px", color: "var(--gold-solid)", letterSpacing: ".04em" } }, v.name),
                  v.isPrime && h("span", { style: { fontSize: "7px", color: "#f59e0b", fontFamily: "Cinzel,serif", letterSpacing: ".08em" } }, "⚠ PRIME?"),
                  !v.sam && h("span", { style: { fontSize: "7px", color: "var(--body-faint)", fontFamily: "Cinzel,serif", letterSpacing: ".06em" } }, "NO SAM"),
                ),
                h("div", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "8px", color: "var(--gold-dim)", display: "flex", gap: "10px", marginBottom: "2px" } },
                  (v.fsc  || []).length > 0 && h("span", null, "FSC " + v.fsc.join(", ")),
                  (v.nsns || []).length > 0 && h("span", { style: { color: "rgba(56,189,248,.5)" } }, "NSN " + v.nsns.slice(0,2).join(", ") + (v.nsns.length > 2 ? " +" + (v.nsns.length-2) : "")),
                ),
                (v.solRefs && v.solRefs.length > 0) && h("div", { style: { display: "flex", flexDirection: "column", gap: "1px" } },
                  v.solRefs.map((ref, ri) => h("div", { key: ri, style: { fontFamily: "JetBrains Mono,monospace", fontSize: "8px", color: "var(--body-faint)" } },
                    (ref.sol_number || "") + (ref.item_name ? " · " + ref.item_name.slice(0,36) + (ref.item_name.length > 36 ? "…" : "") : "") +
                    (ref.qty ? " · " + ref.qty + " ea" : "") + (ref.ext_price ? " · $" + Number(ref.ext_price).toLocaleString() : ""),
                  )),
                ),
              ),
              h("span", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "9px", color: "var(--body-dim)", paddingTop: "2px" } }, v.cage || "—"),
              h("div", { style: { display: "flex", flexDirection: "column", gap: "3px", paddingTop: "2px" } },
                h("span", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "9px", color: v.email ? "rgba(56,189,248,.82)" : "var(--body-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: v.email || "" }, v.email || "—"),
                v.phone && h("span", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "8px", color: "rgba(56,189,248,.52)", letterSpacing: ".01em" } }, v.phone),
              ),
              h("span", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "9px", color: "var(--body-dim)", textAlign: "right", paddingTop: "2px" } }, v.awards || "—"),
              h("span", { style: { fontFamily: "JetBrains Mono,monospace", fontSize: "9px", color: "var(--gold-dim)", textAlign: "right", paddingTop: "2px" } }, v.smallestAward > 0 ? "$" + Math.round(v.smallestAward).toLocaleString() : "—"),
              h("button", { onClick: () => approve(v), disabled: isAdding, style: { fontFamily: "Cinzel,serif", fontSize: "7px", letterSpacing: ".08em", padding: "4px 8px", background: "rgba(61,214,140,.07)", border: "1px solid rgba(61,214,140,.25)", color: "var(--accent-green)", borderRadius: "3px", cursor: isAdding ? "wait" : "pointer", opacity: isAdding ? 0.5 : 1 } }, isAdding ? "…" : "+ Add"),
              h("button", { onClick: () => skip(v.id), style: { fontFamily: "Cinzel,serif", fontSize: "7px", letterSpacing: ".06em", padding: "4px 8px", background: "transparent", border: "1px solid rgba(255,255,255,.08)", color: "var(--body-faint)", borderRadius: "3px", cursor: "pointer" } }, "Skip"),
            );
          }),
        ),
      ),
    ); // close Fragment
  }

  // ── Main IntelTab component ────────────────────────────────────────────

  function IntelTab({ showToast }) {
    const [manualInput, setManualInput] = useState("");
    const [solList, setSolList]         = useState(() => {
      // Auto-load GO sols if screener results are waiting
      try {
        const raw = localStorage.getItem("scc_screener_results_v1");
        if (!raw) return [];
        const goSols = JSON.parse(raw).filter(r => r.verdict === "GO");
        return goSols.map(s => ({
          nsn:       (s.nsn || "").trim(),
          fsc:       (s.nsn ? s.nsn.replace(/\D/g,"").slice(0,4) : (s.fsc||"").replace(/\D/g,"").slice(0,4)),
          label:     s.item_name || s.sol_number || s.nsn || "unknown",
          sol_number: s.sol_number,
          item_name: s.item_name || "",
          qty:       s.quantity || s.qty || s.req_qty || null,
          ext_price: s.ext_price || s.extended_price || null,
          unit_price: s.unit_price || s.dibbs_price || null,
        })).filter(e => e.nsn || e.fsc);
      } catch { return []; }
    });
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
          nsn:        (s.nsn || "").trim(),
          fsc:        (s.nsn ? s.nsn.replace(/\D/g,"").slice(0,4) : (s.fsc||"").replace(/\D/g,"").slice(0,4)),
          label:      s.item_name || s.sol_number || s.nsn || "unknown",
          sol_number: s.sol_number,
          item_name:  s.item_name || "",
          qty:        s.quantity || s.qty || s.req_qty || null,
          ext_price:  s.ext_price || s.extended_price || null,
          unit_price: s.unit_price || s.dibbs_price || null,
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
          const solRef = { nsn: sol.nsn, sol_number: sol.sol_number, item_name: sol.item_name, qty: sol.qty, ext_price: sol.ext_price };
          if (!found.has(key)) {
            found.set(key, { ...v, fscs: sol.fsc ? [sol.fsc] : [], nsns: sol.nsn ? [sol.nsn] : [], solRefs: [solRef] });
          } else {
            const e = found.get(key);
            e.total += v.total; e.count += v.count;
            if (v.minAward > 0 && (e.minAward === 0 || v.minAward < e.minAward)) e.minAward = v.minAward;
            v.descs.forEach(d => { if (!e.descs.includes(d) && e.descs.length < 5) e.descs.push(d); });
            if (sol.fsc && !e.fscs.includes(sol.fsc)) e.fscs.push(sol.fsc);
            if (sol.nsn && !e.nsns.includes(sol.nsn)) e.nsns.push(sol.nsn);
            if (!e.solRefs.find(r => r.sol_number === sol.sol_number)) e.solRefs.push(solRef);
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
          solRefs:      v.solRefs || [],
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

    const nsnCount  = solList.filter(s => s.nsn).length;
    const emptyNSNs = solList.filter(s => s.nsn && nsnResults[s.nsn] === 0).length;
    const fscOnly   = solList.filter(s => !s.nsn && s.fsc).length;
    const [showManual, setShowManual] = useState(false);

    const Btn = ({ onClick, disabled, children, variant, title }) => {
      const styles = {
        gold:  { background: "rgba(201,168,76,.1)",  border: "1px solid var(--gold-border)",  color: "var(--gold-solid)" },
        blue:  { background: "rgba(56,189,248,.08)", border: "1px solid rgba(56,189,248,.3)", color: "rgba(56,189,248,.95)" },
        ghost: { background: "transparent",          border: "1px solid rgba(255,255,255,.1)", color: "var(--body-dim)" },
      };
      return h("button", {
        onClick, disabled, title,
        style: { ...styles[variant || "ghost"], fontFamily: "Cinzel,serif", fontSize: "8px", letterSpacing: ".1em", textTransform: "uppercase", padding: "7px 16px", borderRadius: "4px", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.4 : 1, whiteSpace: "nowrap", transition: "opacity .15s" },
      }, children);
    };

    return h("div", { style: { padding: "20px", animation: "fadeUp .3s ease both" } },

      // ── Header ──
      h("div", { style: { marginBottom: "20px" } },
        h("div", { style: { fontFamily: "Cinzel,serif", fontSize: "18px", letterSpacing: ".1em", color: "var(--gold-solid)" } }, "Vendor Intelligence"),
        h("div", { style: { fontFamily: "Cormorant Garamond,serif", fontStyle: "italic", fontSize: "13px", color: "var(--gold-dim)", marginTop: "3px" } },
          solList.length > 0
            ? solList.length + " solicitations loaded · " + nsnCount + " NSN" + (emptyNSNs > 0 ? " · " + emptyNSNs + " returned empty" : "")
            : "Load solicitations to begin intelligence sweep",
        ),
      ),

      // ── Command surface ──
      h("div", { style: { background: "var(--surface-inset)", border: "1px solid var(--gold-border)", borderRadius: "6px", padding: "14px 16px", marginBottom: "16px" } },
        h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },

          h(Btn, { onClick: loadFromScreener, variant: "gold" }, "↑ Load GO Sols"),
          h(Btn, { onClick: () => setShowManual(m => !m), variant: "ghost" }, showManual ? "▲ Manual" : "▼ Manual"),

          h("div", { style: { width: "1px", alignSelf: "stretch", background: "var(--gold-border)", margin: "0 4px" } }),

          h(Btn, {
            onClick: () => runIntel("nsn"),
            disabled: !!running || !nsnCount,
            variant: "blue",
            title: "Queries USASpending by exact NSN — vendors paid for this part number",
          }, running === "nsn" ? "⟳ " + progress : "⚡ NSN Intel" + (nsnCount ? " (" + nsnCount + ")" : "")),

          h(Btn, {
            onClick: () => runIntel("fsc"),
            disabled: !!running || !solList.length,
            variant: "gold",
            title: "FSC-level sweep on 0-result NSNs — broader, lower confidence",
          }, running === "fsc" ? "⟳ " + progress : "⚡ FSC Fallback" + (emptyNSNs + fscOnly > 0 ? " (" + (emptyNSNs + fscOnly) + ")" : "")),

          solList.length > 0 && h("button", {
            onClick: () => { setSolList([]); setNsnResults({}); },
            style: { marginLeft: "auto", background: "transparent", border: "none", color: "var(--body-faint)", fontFamily: "Cinzel,serif", fontSize: "8px", cursor: "pointer", letterSpacing: ".08em" },
          }, "✕ Clear"),
        ),

        // Manual input inline
        showManual && h("div", { style: { marginTop: "12px", borderTop: "1px solid var(--gold-border)", paddingTop: "12px" } },
          h("textarea", {
            value: manualInput,
            onChange: e => setManualInput(e.target.value),
            placeholder: "4320-01-047-1927\n2910012345678\n5305\none per line or comma-separated",
            rows: 4,
            style: { width: "100%", boxSizing: "border-box", background: "transparent", border: "none", color: "var(--alabaster)", fontFamily: "JetBrains Mono,monospace", fontSize: "10px", padding: "0", resize: "vertical", outline: "none" },
          }),
          h("div", { style: { marginTop: "8px", display: "flex", justifyContent: "flex-end" } },
            h(Btn, { onClick: () => { parseManualInput(); setShowManual(false); }, disabled: !manualInput.trim(), variant: "ghost" }, "Load"),
          ),
        ),
      ),

      // ── NSN result chips ──
      Object.keys(nsnResults).length > 0 && h("div", { style: { marginBottom: "16px" } },
        h("div", { style: { fontFamily: "Cinzel,serif", fontSize: "7px", letterSpacing: ".14em", textTransform: "uppercase", color: "var(--body-faint)", marginBottom: "6px" } }, "NSN Query Results"),
        h("div", { style: { display: "flex", flexWrap: "wrap", gap: "5px" } },
          solList.filter(s => s.nsn && nsnResults[s.nsn] !== undefined).map(s =>
            h("span", { key: s.nsn, style: { fontFamily: "JetBrains Mono,monospace", fontSize: "8px", padding: "2px 8px", borderRadius: "3px", background: nsnResults[s.nsn] > 0 ? "rgba(61,214,140,.07)" : "rgba(201,168,76,.06)", border: "1px solid " + (nsnResults[s.nsn] > 0 ? "rgba(61,214,140,.2)" : "var(--gold-border)"), color: nsnResults[s.nsn] > 0 ? "var(--accent-green)" : "var(--gold-dim)" } },
              fmtNSN(s.nsn) + (nsnResults[s.nsn] > 0 ? " · " + nsnResults[s.nsn] : " · 0"),
            )
          ),
        ),
      ),

      h(PendingVendorQueue, { showToast }),
    );
  }

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.IntelTab = IntelTab;
})();
