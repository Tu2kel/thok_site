(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — NSN INTELLIGENCE TAB
  //  Standalone NSN lookup: Bid Worthiness Score, procurement history,
  //  prior awardees, price anchors. No sol needed — search any NSN.
  //  Exposes: window.SCC_TABS.SupplierRolodexTab (kept for app.js compat)
  // ═══════════════════════════════════════════════════════════════════════

  const { createElement: h, useState, useCallback } = React;

  const LOOKUP_HISTORY_KEY = "scc_nsn_lookup_history";

  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(LOOKUP_HISTORY_KEY) || "[]"); }
    catch { return []; }
  }

  function saveHistory(entries) {
    try { localStorage.setItem(LOOKUP_HISTORY_KEY, JSON.stringify(entries)); }
    catch (_) {}
  }

  function StatBox({ label, value, color }) {
    return h("div", null,
      h("div", {
        style: {
          fontFamily: "Cinzel,serif",
          fontSize: "8px",
          letterSpacing: ".14em",
          textTransform: "uppercase",
          color: "rgba(245,240,232,.32)",
          marginBottom: "4px",
        },
      }, label),
      h("div", {
        style: {
          fontFamily: "JetBrains Mono,monospace",
          fontSize: "17px",
          fontWeight: "700",
          color: color || "rgba(245,240,232,.7)",
        },
      }, value),
    );
  }

  function NSNLookupTab() {
    const [input, setInput] = useState("");
    const [status, setStatus] = useState("idle"); // idle | loading | done | error
    const [result, setResult] = useState(null);
    const [errorMsg, setErrorMsg] = useState("");
    const [history, setHistory] = useState(loadHistory);

    const run = useCallback(async (nsnOverride) => {
      const nsn = (nsnOverride || input).trim().replace(/\s+/g, "");
      if (!nsn) return;

      const fetchFn = window.SCC_TABS && window.SCC_TABS.fetchAwardHistory;
      const scoreFn = window.SCC_TABS && window.SCC_TABS.calcNSNScore;
      if (!fetchFn || !scoreFn) {
        setErrorMsg("Awards Intel module not loaded — check script order in index");
        setStatus("error");
        return;
      }

      setStatus("loading");
      setResult(null);
      setErrorMsg("");

      try {
        const { results, mode } = await fetchFn(nsn);
        const nsnScore = scoreFn(results, "");
        const res = { nsn, awards: results, nsnScore, queryMode: mode };
        setResult(res);

        const entry = { nsn, score: nsnScore.score, label: nsnScore.label, color: nsnScore.color, ts: Date.now() };
        const newHist = [entry, ...history.filter(e => e.nsn !== nsn)].slice(0, 10);
        setHistory(newHist);
        saveHistory(newHist);
        setStatus("done");
      } catch (e) {
        setErrorMsg(e.message);
        setStatus("error");
      }
    }, [input, history]);

    const BidGauge = window.SCC_TABS && window.SCC_TABS.BidWorthinessGauge;
    const ATable = window.SCC_TABS && window.SCC_TABS.AwardsTable;
    const fmt = n => "$" + Math.round(Number(n) || 0).toLocaleString();

    return h("div", {
      style: { padding: "22px 24px", animation: "fadeUp .3s ease both", maxWidth: "900px" },
    },

      // ── Page header ──
      h("div", { style: { marginBottom: "22px" } },
        h("div", {
          style: {
            fontFamily: "Cinzel,serif",
            fontSize: "20px",
            letterSpacing: ".1em",
            color: "#C9A84C",
            marginBottom: "5px",
          },
        }, "NSN Intelligence"),
        h("div", {
          style: {
            fontFamily: "Cormorant Garamond,serif",
            fontStyle: "italic",
            fontSize: "14px",
            color: "rgba(201,168,76,.5)",
          },
        }, "Enter any NSN to get bid worthiness score, procurement history, and price anchors"),
      ),

      // ── Search box ──
      h("div", {
        style: {
          display: "flex",
          gap: "10px",
          alignItems: "center",
          background: "rgba(201,168,76,.035)",
          border: "1px solid rgba(201,168,76,.2)",
          borderRadius: "6px",
          padding: "14px 16px",
          marginBottom: "14px",
        },
      },
        h("input", {
          value: input,
          onChange: e => setInput(e.target.value),
          onKeyDown: e => e.key === "Enter" && run(),
          placeholder: "e.g.  5305-01-064-7311  or  5305010647311",
          style: {
            flex: 1,
            background: "transparent",
            border: "none",
            color: "#f5f0e8",
            fontFamily: "JetBrains Mono,monospace",
            fontSize: "16px",
            outline: "none",
            letterSpacing: ".03em",
          },
        }),
        h("button", {
          onClick: () => run(),
          disabled: status === "loading",
          style: {
            fontFamily: "Cinzel,serif",
            fontSize: "9px",
            letterSpacing: ".15em",
            textTransform: "uppercase",
            padding: "10px 22px",
            background: status === "loading" ? "rgba(201,168,76,.05)" : "rgba(201,168,76,.1)",
            border: "1px solid rgba(201,168,76,.32)",
            color: "#C9A84C",
            borderRadius: "4px",
            cursor: status === "loading" ? "default" : "pointer",
            whiteSpace: "nowrap",
          },
        }, status === "loading" ? "Searching…" : "⚡ Search"),
      ),

      // ── Recent history chips ──
      history.length > 0 && h("div", {
        style: {
          display: "flex",
          flexWrap: "wrap",
          gap: "6px",
          alignItems: "center",
          marginBottom: "22px",
        },
      },
        h("span", {
          style: {
            fontFamily: "Cinzel,serif",
            fontSize: "8px",
            letterSpacing: ".14em",
            textTransform: "uppercase",
            color: "rgba(245,240,232,.28)",
            marginRight: "4px",
          },
        }, "Recent:"),
        ...history.map((entry, i) => h("button", {
          key: i,
          onClick: () => { setInput(entry.nsn); run(entry.nsn); },
          style: {
            fontFamily: "JetBrains Mono,monospace",
            fontSize: "10px",
            padding: "3px 10px",
            background: "rgba(255,255,255,.04)",
            border: "1px solid " + (entry.color || "rgba(201,168,76,.25)") + "55",
            color: entry.color || "rgba(245,240,232,.55)",
            borderRadius: "3px",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "7px",
          },
        },
          h("span", null, entry.nsn),
          h("span", { style: { fontSize: "9px", fontFamily: "Cinzel,serif", opacity: 0.65 } }, entry.score),
        )),
      ),

      // ── Loading spinner ──
      status === "loading" && h("div", {
        style: { padding: "48px 0", textAlign: "center" },
      },
        h("div", {
          style: {
            width: "36px",
            height: "36px",
            border: "2px solid rgba(201,168,76,.12)",
            borderTop: "2px solid #C9A84C",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
            margin: "0 auto 14px",
          },
        }),
        h("div", {
          style: {
            fontFamily: "Cormorant Garamond,serif",
            fontSize: "15px",
            color: "rgba(245,240,232,.38)",
            fontStyle: "italic",
          },
        }, "Querying USASpending.gov…"),
      ),

      // ── Error ──
      status === "error" && h("div", {
        style: {
          padding: "14px 16px",
          background: "rgba(231,76,60,.05)",
          border: "1px solid rgba(231,76,60,.2)",
          borderRadius: "4px",
          fontFamily: "JetBrains Mono,monospace",
          fontSize: "12px",
          color: "#e87474",
          marginBottom: "16px",
        },
      }, "Error: " + errorMsg),

      // ── Results ──
      status === "done" && result && h("div", { style: { animation: "fadeUp .3s ease both" } },

        // ── Bid Worthiness card ──
        h("div", {
          style: {
            display: "flex",
            gap: "26px",
            alignItems: "flex-start",
            padding: "22px",
            background: "#201f2d",
            border: "1px solid rgba(201,168,76,.18)",
            borderTop: "2px solid " + result.nsnScore.color,
            borderRadius: "8px",
            marginBottom: "18px",
            boxShadow: "0 8px 40px rgba(0,0,0,.6)",
          },
        },
          BidGauge
            ? h(BidGauge, { score: result.nsnScore.score, size: 100 })
            : h("div", {
                style: {
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "36px",
                  fontWeight: "700",
                  color: result.nsnScore.color,
                  minWidth: "60px",
                  textAlign: "center",
                },
              }, String(result.nsnScore.score)),

          h("div", { style: { flex: 1, minWidth: 0 } },
            h("div", {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: "9px",
                letterSpacing: ".2em",
                textTransform: "uppercase",
                color: "rgba(201,168,76,.45)",
                marginBottom: "7px",
              },
            }, "Bid Worthiness — NSN " + result.nsn),
            h("div", {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: "18px",
                color: result.nsnScore.color,
                letterSpacing: ".04em",
                marginBottom: "6px",
              },
            }, result.nsnScore.label),
            h("div", {
              style: {
                fontFamily: "Cormorant Garamond,serif",
                fontSize: "14.5px",
                color: "rgba(245,240,232,.52)",
                fontStyle: "italic",
                lineHeight: 1.6,
                marginBottom: "18px",
              },
            }, result.nsnScore.reason),

            h("div", { style: { display: "flex", gap: "28px", flexWrap: "wrap" } },
              result.nsnScore.avgAward > 0 &&
                h(StatBox, { label: "Avg Award", value: fmt(result.nsnScore.avgAward), color: "#f59e0b" }),
              h(StatBox, { label: "Total Awards", value: String(result.awards.length), color: "rgba(245,240,232,.65)" }),
              result.nsnScore.uniqueWinners && result.nsnScore.uniqueWinners.length > 0 &&
                h(StatBox, {
                  label: "Prior Winners",
                  value: String(result.nsnScore.uniqueWinners.length),
                  color: result.nsnScore.uniqueWinners.length >= 3 ? "#3dd68c" :
                         result.nsnScore.uniqueWinners.length >= 2 ? "#7eb8f7" : "#e87474",
                }),
              result.nsnScore.oemHit &&
                h(StatBox, { label: "OEM Alert", value: "Flagged", color: "#e87474" }),
              result.nsnScore.hasRestriction &&
                h(StatBox, { label: "Restriction", value: "Detected", color: "#f59e0b" }),
            ),
          ),
        ),

        // ── Query mode ──
        h("div", {
          style: {
            fontFamily: "JetBrains Mono,monospace",
            fontSize: "9px",
            letterSpacing: ".12em",
            textTransform: "uppercase",
            color: result.queryMode === "nsn" ? "#3dd68c" :
                   result.queryMode === "psc" ? "#f59e0b" : "rgba(245,240,232,.3)",
            marginBottom: "18px",
            opacity: 0.8,
          },
        },
          result.queryMode === "nsn"
            ? "● Exact NSN match — " + result.nsn
            : result.queryMode === "psc"
              ? "◎ FSC " + result.nsn.replace(/\D/g, "").slice(0, 4) + " lane fallback (no NSN-specific history)"
              : "○ No award history found",
        ),

        // ── Prior Awardees ──
        result.nsnScore.uniqueWinners && result.nsnScore.uniqueWinners.length > 0 &&
          h("div", { style: { marginBottom: "18px" } },
            h("div", {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: "9px",
                letterSpacing: ".18em",
                textTransform: "uppercase",
                color: "rgba(201,168,76,.52)",
                marginBottom: "10px",
              },
            }, "Prior Awardees — Who's Been Winning"),
            h("div", { style: { display: "flex", flexWrap: "wrap", gap: "7px" } },
              ...result.nsnScore.uniqueWinners.map((name, i) => {
                const SA = window.SCC_SOURCE_ACTIONS || {};
                return h("div", {
                  key: i,
                  style: {
                    display: "inline-flex",
                    alignItems: "center",
                    background: "rgba(201,168,76,.06)",
                    border: "1px solid rgba(201,168,76,.18)",
                    borderRadius: "3px",
                  },
                },
                  h("span", {
                    style: {
                      fontFamily: "JetBrains Mono,monospace",
                      fontSize: "10px",
                      padding: "4px 9px",
                      color: "rgba(245,240,232,.82)",
                    },
                  }, name),
                  h("button", {
                    title: "SAM.gov entity lookup",
                    onClick: () => SA.searchAwardee && SA.searchAwardee(name),
                    style: {
                      background: "transparent",
                      border: "none",
                      borderLeft: "1px solid rgba(201,168,76,.15)",
                      color: "rgba(201,168,76,.55)",
                      fontFamily: "Cinzel,serif",
                      fontSize: "8px",
                      letterSpacing: ".1em",
                      padding: "4px 8px",
                      cursor: "pointer",
                    },
                  }, "SAM"),
                );
              }),
            ),
          ),

        // ── Procurement History Table ──
        h("div", { style: { marginBottom: "16px" } },
          h("div", {
            style: {
              fontFamily: "Cinzel,serif",
              fontSize: "9px",
              letterSpacing: ".18em",
              textTransform: "uppercase",
              color: "rgba(201,168,76,.52)",
              marginBottom: "12px",
            },
          }, "Procurement History"),
          ATable
            ? h(ATable, { awards: result.awards })
            : h("div", {
                style: {
                  fontFamily: "Cormorant Garamond,serif",
                  fontSize: "13px",
                  fontStyle: "italic",
                  color: "rgba(245,240,232,.35)",
                },
              }, "(Awards table loading — reload if this persists)"),
        ),

        h("button", {
          onClick: () => { setStatus("idle"); setResult(null); setInput(""); },
          style: {
            marginTop: "6px",
            background: "transparent",
            border: "1px solid rgba(245,240,232,.12)",
            color: "rgba(245,240,232,.35)",
            fontFamily: "Cinzel,serif",
            fontSize: "9px",
            letterSpacing: ".14em",
            textTransform: "uppercase",
            padding: "7px 16px",
            cursor: "pointer",
            borderRadius: "3px",
          },
        }, "← New Search"),
      ),

      // ── Empty state ──
      status === "idle" && !history.length && h("div", {
        style: { padding: "60px 0", textAlign: "center" },
      },
        h("div", {
          style: {
            fontFamily: "Cormorant Garamond,serif",
            fontSize: "18px",
            fontStyle: "italic",
            color: "rgba(201,168,76,.4)",
            marginBottom: "8px",
          },
        }, "Enter an NSN above to begin"),
        h("div", {
          style: {
            fontFamily: "JetBrains Mono,monospace",
            fontSize: "11px",
            color: "rgba(245,240,232,.18)",
            letterSpacing: ".08em",
          },
        }, "Pulls live data from USASpending.gov"),
      ),
    );
  }

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.SupplierRolodexTab = NSNLookupTab;
})();
