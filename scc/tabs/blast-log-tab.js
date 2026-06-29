(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — BLAST BRIEFS TAB
  //  Daily pipeline run history + re-blast open solicitations
  //  Pre-compiled React · No Babel · No JSX
  //  Exports: window.SCC_TABS.BlastLogTab
  // ═══════════════════════════════════════════════════════════════════════

  const { createElement: h, useState, useEffect, useCallback } = React;

  const FN = "/.netlify/functions/scc-blast-log";

  async function api(action, payload = {}) {
    const res = await fetch(FN, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "API error");
    return data.result;
  }

  const mono  = "JetBrains Mono,monospace";
  const serif = "Cinzel,serif";
  const gold  = "rgba(201,168,76,";
  const green = "rgba(61,214,140,";
  const red   = "rgba(239,68,68,";
  const blue  = "rgba(56,189,248,";
  const amber = "rgba(251,191,36,";

  function verdictColor(v) {
    if (v === "GO")           return "#3dd68c";
    if (v === "VERIFY FIRST") return "#fbbf24";
    return "rgba(239,68,68,.7)";
  }

  function isOpen(quote_due) {
    if (!quote_due) return false;
    return new Date(quote_due) > new Date();
  }

  function daysLeft(quote_due) {
    if (!quote_due) return null;
    const diff = new Date(quote_due) - new Date();
    return Math.ceil(diff / 86400000);
  }

  // ── Chip ─────────────────────────────────────────────────────────────────
  function Chip({ label, color, bg, border }) {
    return h("span", {
      style: {
        fontFamily: mono, fontSize: "9px", letterSpacing: ".04em",
        color, background: bg, border: "1px solid " + border,
        borderRadius: "3px", padding: "1px 6px", flexShrink: 0,
      },
    }, label);
  }

  // ── Re-blast Drawer ───────────────────────────────────────────────────────
  function ReBlastDrawer({ sol, onClose, onSent }) {
    const [dists,    setDists]    = useState([]);
    const [selected, setSelected] = useState(new Set());
    const [sending,  setSending]  = useState(false);
    const [results,  setResults]  = useState(null);

    useEffect(() => {
      const all = window.SCC_DIST?.DISTRIBUTORS || [];
      const fsc = String(sol.fsc || (sol.nsn || "").slice(0, 4));
      const already = new Set((sol.contacts || []).filter(c => c.status === "sent").map(c => c.vendor_email));
      const eligible = all.filter(d =>
        d.email &&
        !d.is_dns &&
        !already.has((d.email || "").toLowerCase()) &&
        (d.fsc || []).map(String).includes(fsc)
      );
      setDists(eligible);
    }, [sol]);

    const alreadySent = (sol.contacts || []).filter(c => c.status === "sent");

    const toggle = (id) => setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

    const send = async () => {
      if (!selected.size) return;
      setSending(true);
      try {
        const vendors = dists.filter(d => selected.has(d.id || d._id?.toString()));
        const res = await api("reBlast", { sol, vendors });
        setResults(res);
        onSent && onSent(sol.sol_number, res);
      } catch (e) {
        alert("Send failed: " + e.message);
      } finally {
        setSending(false);
      }
    };

    const days = daysLeft(sol.quote_due);

    return h("div", {
      style: {
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,.65)", display: "flex", justifyContent: "flex-end",
      },
      onClick: (e) => { if (e.target === e.currentTarget) onClose(); },
    },
      h("div", {
        style: {
          width: "480px", height: "100%", background: "var(--surface-base)",
          borderLeft: "1px solid " + gold + ".2)", display: "flex", flexDirection: "column",
          overflow: "hidden",
        },
      },
        // Header
        h("div", {
          style: {
            padding: "16px 20px", borderBottom: "1px solid " + gold + ".12)",
            background: "rgba(0,0,0,.3)",
          },
        },
          h("div", { style: { fontFamily: serif, fontSize: "11px", letterSpacing: ".12em", color: gold + ".5)", marginBottom: "4px" } }, "RE-BLAST"),
          h("div", { style: { fontFamily: serif, fontSize: "15px", color: gold + ".9)" } }, sol.item_name || sol.sol_number),
          h("div", {
            style: { fontFamily: mono, fontSize: "10px", color: "var(--body-dim)", marginTop: "4px", display: "flex", gap: "10px" },
          },
            h("span", null, "FSC " + (sol.fsc || "—")),
            sol.quote_due && h("span", null, "Due " + sol.quote_due),
            days != null && h("span", { style: { color: days <= 2 ? "#ef4444" : days <= 5 ? "#fbbf24" : "#3dd68c" } }, days + " days left"),
          ),
        ),

        h("div", { style: { flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: "16px" } },

          // Already contacted
          alreadySent.length > 0 && h("div", null,
            h("div", { style: { fontFamily: mono, fontSize: "9px", letterSpacing: ".1em", color: "var(--body-faint)", marginBottom: "8px" } }, "ALREADY CONTACTED"),
            ...alreadySent.map(c => h("div", {
              key: c.vendor_email,
              style: { fontFamily: mono, fontSize: "11px", color: "var(--body-dim)", padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,.04)" },
            },
              h("span", { style: { color: "#3dd68c", marginRight: "6px" } }, "✓"),
              c.vendor_name,
              h("span", { style: { color: "var(--body-faint)", marginLeft: "8px" } }, c.sent_at?.slice(0, 10)),
            )),
          ),

          // Available vendors
          h("div", null,
            h("div", { style: { fontFamily: mono, fontSize: "9px", letterSpacing: ".1em", color: "var(--body-faint)", marginBottom: "8px" } },
              "AVAILABLE IN FSC " + (sol.fsc || "—") + (dists.length ? " · " + dists.length + " vendors" : " · none"),
            ),
            dists.length === 0
              ? h("div", { style: { fontFamily: mono, fontSize: "11px", color: "var(--body-faint)", fontStyle: "italic" } }, "No available vendors — all contacted or none in FSC")
              : dists.map(d => {
                  const id = d.id || d._id?.toString();
                  const on = selected.has(id);
                  return h("div", {
                    key: id,
                    onClick: () => toggle(id),
                    style: {
                      display: "flex", alignItems: "center", gap: "10px",
                      padding: "7px 10px", borderRadius: "4px", cursor: "pointer",
                      background: on ? "rgba(61,214,140,.08)" : "transparent",
                      border: "1px solid " + (on ? "rgba(61,214,140,.25)" : "transparent"),
                      marginBottom: "3px", transition: "all .15s",
                    },
                  },
                    h("div", {
                      style: {
                        width: "14px", height: "14px", borderRadius: "3px", flexShrink: 0,
                        border: "1px solid " + (on ? "#3dd68c" : "rgba(255,255,255,.2)"),
                        background: on ? "#3dd68c" : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      },
                    }, on && h("span", { style: { fontSize: "9px", color: "#000", fontWeight: "bold" } }, "✓")),
                    h("div", { style: { flex: 1, minWidth: 0 } },
                      h("div", { style: { fontFamily: mono, fontSize: "11px", color: "var(--body)" } }, d.name),
                      h("div", { style: { fontFamily: mono, fontSize: "9px", color: "var(--body-faint)" } }, d.email),
                    ),
                    d.drop_ship && h(Chip, { label: "DROP", color: "#86efac", bg: "rgba(34,197,94,.1)", border: "rgba(34,197,94,.25)" }),
                    d.has_mil_std_pack && h(Chip, { label: "MIL≡", color: "#bae6fd", bg: "rgba(96,165,250,.1)", border: "rgba(96,165,250,.25)" }),
                  );
                }),
          ),

          // Results after send
          results && h("div", { style: { borderTop: "1px solid " + gold + ".1)", paddingTop: "12px" } },
            h("div", { style: { fontFamily: mono, fontSize: "9px", letterSpacing: ".1em", color: "var(--body-faint)", marginBottom: "8px" } }, "RESULTS"),
            ...results.map((r, i) => h("div", {
              key: i,
              style: { fontFamily: mono, fontSize: "11px", padding: "4px 0", color: r.status === "sent" ? "#3dd68c" : r.status === "skipped" ? "#fbbf24" : "#ef4444" },
            }, (r.status === "sent" ? "✓ " : r.status === "skipped" ? "⏭ " : "✗ ") + r.vendor + (r.reason ? " — " + r.reason : ""))),
          ),
        ),

        // Footer
        !results && h("div", {
          style: { padding: "14px 20px", borderTop: "1px solid " + gold + ".1)", display: "flex", gap: "8px" },
        },
          h("button", {
            onClick: send,
            disabled: !selected.size || sending,
            style: {
              flex: 1, padding: "9px", fontFamily: serif, fontSize: "10px", letterSpacing: ".1em",
              background: selected.size ? "rgba(61,214,140,.15)" : "rgba(255,255,255,.04)",
              border: "1px solid " + (selected.size ? "rgba(61,214,140,.4)" : "rgba(255,255,255,.1)"),
              color: selected.size ? "#3dd68c" : "var(--body-faint)", borderRadius: "4px", cursor: selected.size ? "pointer" : "default",
            },
          }, sending ? "Sending…" : "Send to " + (selected.size || "0") + " Selected"),
          h("button", {
            onClick: onClose,
            style: { padding: "9px 14px", fontFamily: serif, fontSize: "10px", letterSpacing: ".1em", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)", color: "var(--body-dim)", borderRadius: "4px", cursor: "pointer" },
          }, "Cancel"),
        ),
        results && h("div", { style: { padding: "14px 20px", borderTop: "1px solid " + gold + ".1)" } },
          h("button", {
            onClick: onClose,
            style: { width: "100%", padding: "9px", fontFamily: serif, fontSize: "10px", letterSpacing: ".1em", background: "rgba(201,168,76,.1)", border: "1px solid " + gold + ".3)", color: gold + ".9)", borderRadius: "4px", cursor: "pointer" },
          }, "Close"),
        ),
      ),
    );
  }

  // ── Sol Row ───────────────────────────────────────────────────────────────
  function SolRow({ sol, onReBlast }) {
    const open   = isOpen(sol.quote_due);
    const days   = daysLeft(sol.quote_due);
    const contacted = (sol.contacts || []).filter(c => c.status === "sent").length;

    return h("div", {
      style: {
        display: "flex", alignItems: "center", gap: "8px", padding: "7px 12px",
        borderBottom: "1px solid rgba(255,255,255,.04)", flexWrap: "wrap",
      },
    },
      // Verdict dot
      h("div", {
        style: { width: "6px", height: "6px", borderRadius: "50%", background: verdictColor(sol.verdict), flexShrink: 0 },
      }),

      // Item name + FSC
      h("div", { style: { flex: 1, minWidth: "160px" } },
        h("div", { style: { fontFamily: mono, fontSize: "12px", color: "var(--body)", fontWeight: "600" } }, sol.item_name || sol.sol_number),
        h("div", { style: { fontFamily: mono, fontSize: "9px", color: "var(--body-faint)", marginTop: "2px", display: "flex", gap: "8px" } },
          h("span", null, "FSC " + (sol.fsc || "—")),
          sol.quantity && h("span", null, "Qty " + sol.quantity),
          sol.ref_part_number && h("span", null, "P/N " + sol.ref_part_number),
        ),
      ),

      // Contacted count
      h("div", { style: { fontFamily: mono, fontSize: "10px", color: contacted ? "#3dd68c" : "var(--body-faint)", flexShrink: 0 } },
        contacted ? contacted + " vendor" + (contacted !== 1 ? "s" : "") + " contacted" : "Not blasted",
      ),

      // Due date / days left
      open
        ? h("div", { style: { fontFamily: mono, fontSize: "10px", color: days <= 2 ? "#ef4444" : days <= 5 ? "#fbbf24" : gold + ".8)", flexShrink: 0 } }, days + "d left")
        : h("div", { style: { fontFamily: mono, fontSize: "10px", color: "var(--body-faint)", flexShrink: 0 } }, "Closed"),

      // Re-blast button
      open && h("button", {
        onClick: () => onReBlast(sol),
        style: {
          padding: "4px 10px", fontFamily: serif, fontSize: "8px", letterSpacing: ".1em",
          background: "rgba(61,214,140,.1)", border: "1px solid rgba(61,214,140,.3)",
          color: "#3dd68c", borderRadius: "3px", cursor: "pointer", flexShrink: 0,
        },
      }, "Re-blast →"),
    );
  }

  // ── Brief Card ────────────────────────────────────────────────────────────
  function BriefCard({ brief, onReBlast }) {
    const [expanded,  setExpanded]  = useState(false);
    const [detail,    setDetail]    = useState(null);
    const [loading,   setLoading]   = useState(false);

    const toggle = async () => {
      if (!expanded && !detail) {
        setLoading(true);
        try {
          const d = await api("getBriefDetail", { id: brief._id?.toString() });
          setDetail(d);
        } catch (e) {
          alert("Load failed: " + e.message);
        } finally {
          setLoading(false);
        }
      }
      setExpanded(v => !v);
    };

    const sols = detail?.sols || [];
    const openSols = sols.filter(s => isOpen(s.quote_due));

    return h("div", {
      style: {
        border: "1px solid " + gold + ".14)", borderRadius: "6px", overflow: "hidden", marginBottom: "8px",
      },
    },
      // Summary header
      h("div", {
        onClick: toggle,
        style: {
          display: "flex", alignItems: "center", gap: "12px", padding: "12px 16px",
          background: "rgba(0,0,0,.25)", cursor: "pointer", userSelect: "none",
          borderBottom: expanded ? "1px solid " + gold + ".1)" : "none",
        },
      },
        h("div", {
          style: { fontFamily: mono, fontSize: "11px", color: gold + ".7)", letterSpacing: ".04em", flexShrink: 0 },
        }, brief.run_date || brief.created_at?.slice(0, 10)),

        h("div", { style: { flex: 1, display: "flex", gap: "12px", flexWrap: "wrap" } },
          brief.total_sols != null && h("span", { style: { fontFamily: mono, fontSize: "10px", color: "var(--body-dim)" } }, brief.total_sols + " scraped"),
          brief.go_count != null && h("span", { style: { fontFamily: mono, fontSize: "10px", color: "#3dd68c" } }, brief.go_count + " GO"),
          brief.verify_count > 0 && h("span", { style: { fontFamily: mono, fontSize: "10px", color: "#fbbf24" } }, brief.verify_count + " VERIFY"),
          brief.reject_count > 0 && h("span", { style: { fontFamily: mono, fontSize: "10px", color: "rgba(239,68,68,.7)" } }, brief.reject_count + " REJECT"),
          h("span", { style: { fontFamily: mono, fontSize: "10px", color: blue + ".8)" } }, brief.blast_sent + " emails sent"),
          brief.blast_failed > 0 && h("span", { style: { fontFamily: mono, fontSize: "10px", color: "rgba(239,68,68,.8)" } }, brief.blast_failed + " failed"),
          brief.notes && h("span", { style: { fontFamily: mono, fontSize: "10px", color: "var(--body-faint)", fontStyle: "italic" } }, brief.notes),
        ),

        openSols.length > 0 && h(Chip, { label: openSols.length + " open", color: "#fbbf24", bg: "rgba(251,191,36,.1)", border: "rgba(251,191,36,.3)" }),

        loading
          ? h("span", { style: { fontFamily: mono, fontSize: "10px", color: "var(--body-faint)" } }, "Loading…")
          : h("span", { style: { fontFamily: mono, fontSize: "10px", color: "var(--body-faint)" } }, expanded ? "▲" : "▼"),
      ),

      // Expanded sol list
      expanded && detail && h("div", null,
        sols.length === 0
          ? h("div", { style: { padding: "12px 16px", fontFamily: mono, fontSize: "11px", color: "var(--body-faint)", fontStyle: "italic" } }, "No sol data in this brief")
          : sols.map(sol => h(SolRow, { key: sol.sol_number, sol, onReBlast })),
      ),
    );
  }

  // ── Main Tab ──────────────────────────────────────────────────────────────
  function BlastLogTab() {
    const [briefs,    setBriefs]    = useState([]);
    const [loading,   setLoading]   = useState(true);
    const [err,       setErr]       = useState(null);
    const [reBlastSol, setReBlastSol] = useState(null);

    const load = useCallback(async () => {
      setLoading(true);
      setErr(null);
      try {
        const data = await api("getBriefs", { limit: 60 });
        setBriefs(data || []);
      } catch (e) {
        setErr(e.message);
      } finally {
        setLoading(false);
      }
    }, []);

    useEffect(() => { load(); }, []);

    return h("div", {
      style: { padding: "20px", maxWidth: "900px", margin: "0 auto" },
    },
      // Header
      h("div", {
        style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" },
      },
        h("div", null,
          h("div", { style: { fontFamily: serif, fontSize: "13px", letterSpacing: ".15em", color: gold + ".5)" } }, "BLAST BRIEFS"),
          h("div", { style: { fontFamily: serif, fontSize: "20px", color: gold + ".9)", marginTop: "2px" } }, "Daily Run History"),
        ),
        h("button", {
          onClick: load,
          style: { padding: "6px 14px", fontFamily: serif, fontSize: "9px", letterSpacing: ".1em", background: "rgba(201,168,76,.08)", border: "1px solid " + gold + ".25)", color: gold + ".8)", borderRadius: "4px", cursor: "pointer" },
        }, "↻ Refresh"),
      ),

      loading && h("div", { style: { fontFamily: mono, fontSize: "12px", color: "var(--body-faint)", padding: "40px", textAlign: "center" } }, "Loading briefs…"),

      err && h("div", { style: { fontFamily: mono, fontSize: "12px", color: "#ef4444", padding: "16px", background: "rgba(239,68,68,.07)", borderRadius: "4px", marginBottom: "12px" } }, "Error: " + err),

      !loading && !err && briefs.length === 0 && h("div", {
        style: { fontFamily: mono, fontSize: "12px", color: "var(--body-faint)", padding: "60px", textAlign: "center", fontStyle: "italic" },
      }, "No blast briefs yet — run the Railway agent to see results here."),

      ...briefs.map(brief => h(BriefCard, {
        key: brief._id?.toString() || brief.run_date,
        brief,
        onReBlast: setReBlastSol,
      })),

      // Re-blast drawer
      reBlastSol && h(ReBlastDrawer, {
        sol: reBlastSol,
        onClose: () => setReBlastSol(null),
        onSent: () => { setReBlastSol(null); load(); },
      }),
    );
  }

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.BlastLogTab = BlastLogTab;
})();
