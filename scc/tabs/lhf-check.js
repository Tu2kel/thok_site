(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — LHF QUOTE CHECKER
  //  Pre-compiled React · No Babel · No JSX
  //  Opens DIBBS RFQ pages in sequence for manual quote-button verification
  //  Exports: window.SCC_TABS.LHFCheckTab
  // ═══════════════════════════════════════════════════════════════════════

  const { createElement: h, useState, useEffect, useRef, useCallback } = React;

  const DIBBS_URL = "https://www.dibbs.bsm.dla.mil/RFQ/RFQRec.aspx?sn=";

  // Parse sol numbers from raw paste — handles Navigator format or plain list
  function parseSols(raw) {
    const sols = new Set();
    // Match SPE-format sol numbers: 13 alphanumeric chars starting with SPE
    const matches = raw.match(/SPE[A-Z0-9]{10}/gi) || [];
    matches.forEach((s) => sols.add(s.toUpperCase()));
    // Also match plain line-by-line (one per line, trimmed)
    raw.split(/[\n,;\s]+/).forEach((tok) => {
      const t = tok.trim().toUpperCase();
      if (/^SPE[A-Z0-9]{10}$/.test(t)) sols.add(t);
    });
    return [...sols];
  }

  function LHFCheckTab({ onSendToIntake }) {
    const [paste, setPaste] = useState("");
    const [sols, setSols] = useState([]); // parsed list
    const [results, setResults] = useState({}); // { sol: "open"|"closed"|"pending"|"skipped" }
    const [current, setCurrent] = useState(null); // sol being checked
    const [idx, setIdx] = useState(0); // position in list
    const [running, setRunning] = useState(false);
    const [countdown, setCountdown] = useState(0);
    const [autoAdv, setAutoAdv] = useState(true); // auto-advance after delay
    const [delay, setDelay] = useState(4); // seconds between opens
    const timerRef = useRef(null);
    const tabRef = useRef(null);

    // ── Parse on paste change ──────────────────────────────────────────
    useEffect(() => {
      const parsed = parseSols(paste);
      setSols(parsed);
      setResults({});
      setIdx(0);
      setCurrent(null);
      setRunning(false);
    }, [paste]);

    // ── Countdown tick ─────────────────────────────────────────────────
    useEffect(() => {
      if (countdown <= 0) return;
      const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
      return () => clearTimeout(t);
    }, [countdown]);

    // ── Auto-advance when countdown hits 0 ────────────────────────────
    useEffect(() => {
      if (countdown === 0 && running && autoAdv && current) {
        advance("pending"); // mark as pending if user didn't mark it
      }
    }, [countdown]);

    const markAndAdvance = useCallback(
      (status) => {
        if (!current) return;
        setResults((r) => ({ ...r, [current]: status }));
        setRunning(false);
        setCurrent(null);
        setCountdown(0);
        if (timerRef.current) clearTimeout(timerRef.current);
        // Move to next unmarked
        const next = findNext(idx + 1);
        if (next !== null) setIdx(next);
      },
      [current, idx, sols],
    );

    const advance = useCallback(
      (status) => {
        markAndAdvance(status || "pending");
      },
      [markAndAdvance],
    );

    function findNext(from) {
      for (let i = from; i < sols.length; i++) {
        if (!results[sols[i]] || results[sols[i]] === "pending") return i;
      }
      return null;
    }

    const openNext = useCallback(() => {
      const sol = sols[idx];
      if (!sol) return;
      setCurrent(sol);
      setRunning(true);
      setCountdown(delay);
      // Close previous tab if still open
      if (tabRef.current && !tabRef.current.closed) {
        tabRef.current.close();
      }
      tabRef.current = window.open(DIBBS_URL + sol, "dibbs_check");
    }, [sols, idx, delay]);

    // keyboard shortcut: O = open, C = closed, S = skip, space/enter = next
    useEffect(() => {
      const handler = (e) => {
        if (!running && !current) return;
        if (e.key === "o" || e.key === "O") markAndAdvance("open");
        if (e.key === "c" || e.key === "C") markAndAdvance("closed");
        if (e.key === "s" || e.key === "S") markAndAdvance("skipped");
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          if (running) markAndAdvance("pending");
        }
      };
      window.addEventListener("keydown", handler);
      return () => window.removeEventListener("keydown", handler);
    }, [running, current, markAndAdvance]);

    const counts = {
      open: Object.values(results).filter((v) => v === "open").length,
      closed: Object.values(results).filter((v) => v === "closed").length,
      skipped: Object.values(results).filter((v) => v === "skipped").length,
      pending: Object.values(results).filter((v) => v === "pending").length,
    };
    const done =
      sols.length > 0 &&
      sols.every((s) => results[s] && results[s] !== "pending");
    const openSols = sols.filter((s) => results[s] === "open");

    // ── Styles ─────────────────────────────────────────────────────────
    const btn = (bg, border, color, disabled) => ({
      padding: "8px 18px",
      fontFamily: "Cinzel,serif",
      fontSize: "10px",
      letterSpacing: ".1em",
      background: disabled ? "rgba(255,255,255,.05)" : bg,
      border: "1px solid " + (disabled ? "rgba(255,255,255,.1)" : border),
      color: disabled ? "var(--body-faint)" : color,
      borderRadius: "4px",
      cursor: disabled ? "not-allowed" : "pointer",
      transition: "all .15s",
    });

    const statusColor = (s) =>
      s === "open"
        ? "#3dd68c"
        : s === "closed"
          ? "#e74c3c"
          : s === "skipped"
            ? "#888"
            : s === "pending"
              ? "var(--gold-dim)"
              : "var(--body-faint)";

    const statusLabel = (s) =>
      s === "open"
        ? "OPEN"
        : s === "closed"
          ? "CLOSED"
          : s === "skipped"
            ? "SKIP"
            : s === "pending"
              ? "?"
              : "—";

    return h(
      "div",
      { style: { padding: "20px", maxWidth: "900px" } },

      // ── Header ──
      h(
        "div",
        { style: { marginBottom: "20px" } },
        h(
          "div",
          {
            style: {
              fontFamily: "Cinzel,serif",
              fontSize: "20px",
              letterSpacing: ".1em",
              color: "var(--gold-solid)",
            },
          },
          "LHF Quote Checker",
        ),
        h(
          "div",
          {
            style: {
              fontFamily: "Cormorant Garamond,serif",
              fontStyle: "italic",
              fontSize: "13px",
              color: "var(--gold-dim)",
              marginTop: "4px",
            },
          },
          "Paste Navigator LHF output \u2014 opens each sol in DIBBS for quote-button verification",
        ),
      ),

      // ── Paste input ──
      sols.length === 0 &&
        h(
          "div",
          null,
          h(
            "div",
            {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: "8px",
                letterSpacing: ".15em",
                textTransform: "uppercase",
                color: "var(--gold-dim)",
                marginBottom: "6px",
              },
            },
            "Paste Navigator LHF Output or Sol Numbers",
          ),
          h("textarea", {
            value: paste,
            onChange: (e) => setPaste(e.target.value),
            placeholder:
              "Paste full Navigator LHF output or just sol numbers (one per line or space-separated)\nSPE4A626T626G\nSPE8ED26Q0232\n...",
            rows: 10,
            style: {
              width: "100%",
              boxSizing: "border-box",
              padding: "12px",
              background: "var(--surface-sheen)",
              border: "1px solid rgba(201,168,76,.2)",
              color: "var(--alabaster)",
              fontFamily: "JetBrains Mono,monospace",
              fontSize: "11px",
              borderRadius: "4px",
              resize: "vertical",
            },
          }),
        ),

      // ── Parsed + controls ──
      sols.length > 0 &&
        h(
          "div",
          null,

          // Stats bar
          h(
            "div",
            {
              style: {
                display: "flex",
                gap: "16px",
                alignItems: "center",
                marginBottom: "16px",
                flexWrap: "wrap",
              },
            },
            h(
              "div",
              {
                style: {
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "11px",
                  color: "var(--gold-dim)",
                },
              },
              sols.length + " sols parsed",
            ),
            counts.open > 0 &&
              h(
                "div",
                {
                  style: {
                    fontFamily: "JetBrains Mono,monospace",
                    fontSize: "11px",
                    color: "#3dd68c",
                  },
                },
                counts.open + " open",
              ),
            counts.closed > 0 &&
              h(
                "div",
                {
                  style: {
                    fontFamily: "JetBrains Mono,monospace",
                    fontSize: "11px",
                    color: "#e74c3c",
                  },
                },
                counts.closed + " closed",
              ),
            counts.skipped > 0 &&
              h(
                "div",
                {
                  style: {
                    fontFamily: "JetBrains Mono,monospace",
                    fontSize: "11px",
                    color: "#888",
                  },
                },
                counts.skipped + " skipped",
              ),
            counts.pending > 0 &&
              h(
                "div",
                {
                  style: {
                    fontFamily: "JetBrains Mono,monospace",
                    fontSize: "11px",
                    color: "var(--gold-dim)",
                  },
                },
                counts.pending + " unchecked",
              ),
            h(
              "button",
              {
                onClick: () => {
                  setPaste("");
                  setSols([]);
                },
                style: {
                  ...btn(
                    "transparent",
                    "rgba(201,168,76,.2)",
                    "var(--gold-dim)",
                  ),
                  padding: "4px 10px",
                  fontSize: "9px",
                  marginLeft: "auto",
                },
              },
              "Clear",
            ),
          ),

          // Current sol banner
          current &&
            h(
              "div",
              {
                style: {
                  padding: "16px 20px",
                  marginBottom: "16px",
                  background: "rgba(61,214,140,.06)",
                  border: "1px solid rgba(61,214,140,.3)",
                  borderLeft: "4px solid #3dd68c",
                  borderRadius: "4px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "12px",
                },
              },
              h(
                "div",
                null,
                h(
                  "div",
                  {
                    style: {
                      fontFamily: "Cinzel,serif",
                      fontSize: "11px",
                      letterSpacing: ".1em",
                      color: "var(--gold-dim)",
                      marginBottom: "4px",
                    },
                  },
                  "NOW CHECKING",
                ),
                h(
                  "div",
                  {
                    style: {
                      fontFamily: "JetBrains Mono,monospace",
                      fontSize: "18px",
                      color: "#3dd68c",
                      letterSpacing: ".08em",
                    },
                  },
                  current,
                ),
                h(
                  "div",
                  {
                    style: {
                      fontFamily: "Cormorant Garamond,serif",
                      fontStyle: "italic",
                      fontSize: "12px",
                      color: "var(--body-faint)",
                      marginTop: "4px",
                    },
                  },
                  "Check the DIBBS tab \u2014 is the Quote button active?",
                ),
              ),
              // Auto-advance countdown
              autoAdv &&
                countdown > 0 &&
                h(
                  "div",
                  {
                    style: {
                      fontFamily: "JetBrains Mono,monospace",
                      fontSize: "28px",
                      color: "var(--gold-dim)",
                      minWidth: "40px",
                      textAlign: "center",
                    },
                  },
                  countdown,
                ),
            ),

          // Keyboard shortcut hint
          current &&
            h(
              "div",
              {
                style: {
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "9px",
                  color: "var(--body-faint)",
                  marginBottom: "12px",
                  letterSpacing: ".06em",
                },
              },
              "Keyboard: \u00A0[O] Open \u00A0\u00A0[C] Closed \u00A0\u00A0[S] Skip \u00A0\u00A0[Space] Defer",
            ),

          // Mark buttons
          current &&
            h(
              "div",
              {
                style: {
                  display: "flex",
                  gap: "8px",
                  marginBottom: "16px",
                  flexWrap: "wrap",
                },
              },
              h(
                "button",
                {
                  onClick: () => markAndAdvance("open"),
                  style: btn(
                    "rgba(61,214,140,.2)",
                    "rgba(61,214,140,.5)",
                    "#3dd68c",
                  ),
                },
                "\u2713 Open",
              ),
              h(
                "button",
                {
                  onClick: () => markAndAdvance("closed"),
                  style: btn(
                    "rgba(231,76,60,.15)",
                    "rgba(231,76,60,.4)",
                    "#e74c3c",
                  ),
                },
                "\u2715 Closed",
              ),
              h(
                "button",
                {
                  onClick: () => markAndAdvance("skipped"),
                  style: btn(
                    "transparent",
                    "rgba(255,255,255,.1)",
                    "var(--body-faint)",
                  ),
                },
                "Skip",
              ),
            ),

          // Start / Next button
          !current &&
            !done &&
            h(
              "div",
              {
                style: {
                  display: "flex",
                  gap: "12px",
                  alignItems: "center",
                  marginBottom: "16px",
                  flexWrap: "wrap",
                },
              },
              h(
                "button",
                {
                  onClick: openNext,
                  style: btn(
                    "rgba(201,168,76,.2)",
                    "rgba(201,168,76,.5)",
                    "var(--gold-solid)",
                  ),
                },
                sols[idx]
                  ? "Open " + sols[idx] + " in DIBBS \u2192"
                  : "All Checked",
              ),

              // Settings
              h(
                "div",
                {
                  style: { display: "flex", alignItems: "center", gap: "8px" },
                },
                h(
                  "label",
                  {
                    style: {
                      fontFamily: "JetBrains Mono,monospace",
                      fontSize: "9px",
                      color: "var(--body-faint)",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      cursor: "pointer",
                    },
                  },
                  h("input", {
                    type: "checkbox",
                    checked: autoAdv,
                    onChange: (e) => setAutoAdv(e.target.checked),
                  }),
                  "Auto-advance",
                ),
                autoAdv &&
                  h(
                    "div",
                    {
                      style: {
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                      },
                    },
                    h(
                      "label",
                      {
                        style: {
                          fontFamily: "JetBrains Mono,monospace",
                          fontSize: "9px",
                          color: "var(--body-faint)",
                        },
                      },
                      "Delay:",
                    ),
                    h(
                      "select",
                      {
                        value: delay,
                        onChange: (e) => setDelay(Number(e.target.value)),
                        style: {
                          background: "var(--surface-inset)",
                          border: "1px solid rgba(201,168,76,.2)",
                          color: "var(--gold-dim)",
                          fontFamily: "JetBrains Mono,monospace",
                          fontSize: "9px",
                          padding: "2px 4px",
                        },
                      },
                      [3, 4, 5, 8, 10].map((v) =>
                        h("option", { key: v, value: v }, v + "s"),
                      ),
                    ),
                  ),
              ),
            ),

          // Open sols output — show mid-check as soon as any are confirmed open
          openSols.length > 0 &&
            h(
              "div",
              {
                style: {
                  padding: "16px",
                  background: "rgba(61,214,140,.06)",
                  border: "1px solid rgba(61,214,140,.2)",
                  borderRadius: "6px",
                  marginBottom: "16px",
                },
              },
              h(
                "div",
                {
                  style: {
                    fontFamily: "Cinzel,serif",
                    fontSize: "10px",
                    letterSpacing: ".1em",
                    color: "#3dd68c",
                    marginBottom: "10px",
                  },
                },
                "CHECK COMPLETE \u2014 " +
                  openSols.length +
                  " Open Solicitations",
              ),
              h(
                "div",
                {
                  style: {
                    fontFamily: "JetBrains Mono,monospace",
                    fontSize: "11px",
                    color: "var(--alabaster)",
                    lineHeight: 1.8,
                  },
                },
                openSols.join("\n"),
              ),
              h(
                "div",
                {
                  style: {
                    display: "flex",
                    gap: "8px",
                    marginTop: "10px",
                    flexWrap: "wrap",
                  },
                },
                h(
                  "button",
                  {
                    onClick: () => {
                      const text = openSols.join("\n");
                      navigator.clipboard.writeText(text).catch(() => {});
                    },
                    style: {
                      ...btn(
                        "rgba(61,214,140,.15)",
                        "rgba(61,214,140,.3)",
                        "#3dd68c",
                      ),
                      fontSize: "9px",
                    },
                  },
                  "Copy Sol Numbers",
                ),
                onSendToIntake &&
                  h(
                    "button",
                    {
                      onClick: () => onSendToIntake(openSols),
                      style: {
                        ...btn(
                          "rgba(201,168,76,.2)",
                          "rgba(201,168,76,.5)",
                          "var(--gold-solid)",
                        ),
                        fontSize: "9px",
                      },
                    },
                    "\u2192 Send to Intake",
                  ),
              ),
            ),

          // Sol list
          h(
            "div",
            {
              style: {
                border: "1px solid rgba(201,168,76,.1)",
                borderRadius: "4px",
                overflow: "hidden",
              },
            },
            h(
              "div",
              {
                style: {
                  background: "rgba(201,168,76,.06)",
                  padding: "6px 12px",
                  fontFamily: "Cinzel,serif",
                  fontSize: "7px",
                  letterSpacing: ".15em",
                  color: "rgba(201,168,76,.5)",
                  textTransform: "uppercase",
                },
              },
              "Solicitation Queue",
            ),
            sols.map((sol, i) => {
              const status = results[sol];
              const isCurrent = sol === current;
              const isNext = !current && i === idx;
              return h(
                "div",
                {
                  key: sol,
                  style: {
                    display: "flex",
                    alignItems: "center",
                    padding: "8px 12px",
                    borderBottom: "1px solid rgba(201,168,76,.06)",
                    background: isCurrent
                      ? "rgba(61,214,140,.05)"
                      : isNext
                        ? "rgba(201,168,76,.03)"
                        : "transparent",
                    gap: "12px",
                  },
                },
                // Index
                h(
                  "span",
                  {
                    style: {
                      fontFamily: "JetBrains Mono,monospace",
                      fontSize: "9px",
                      color: "var(--body-faint)",
                      minWidth: "24px",
                    },
                  },
                  i + 1 + ".",
                ),
                // Sol number
                h(
                  "a",
                  {
                    href: DIBBS_URL + sol,
                    target: "_blank",
                    style: {
                      fontFamily: "JetBrains Mono,monospace",
                      fontSize: "12px",
                      color: isCurrent ? "#3dd68c" : "var(--gold-solid)",
                      textDecoration: "none",
                      flex: 1,
                      letterSpacing: ".04em",
                    },
                  },
                  sol,
                ),
                // Current indicator
                isCurrent &&
                  h(
                    "span",
                    {
                      style: {
                        fontFamily: "Cinzel,serif",
                        fontSize: "8px",
                        color: "#3dd68c",
                        letterSpacing: ".1em",
                      },
                    },
                    "\u25B6 CHECKING",
                  ),
                isNext &&
                  !isCurrent &&
                  h(
                    "span",
                    {
                      style: {
                        fontFamily: "Cinzel,serif",
                        fontSize: "8px",
                        color: "var(--gold-dim)",
                        letterSpacing: ".1em",
                      },
                    },
                    "NEXT",
                  ),
                // Status badge
                h(
                  "span",
                  {
                    style: {
                      fontFamily: "Cinzel,serif",
                      fontSize: "8px",
                      letterSpacing: ".1em",
                      color: statusColor(status),
                      background:
                        status === "open"
                          ? "rgba(61,214,140,.1)"
                          : status === "closed"
                            ? "rgba(231,76,60,.1)"
                            : "transparent",
                      border: status
                        ? "1px solid " + statusColor(status) + "40"
                        : "1px solid transparent",
                      padding: "2px 8px",
                      borderRadius: "3px",
                      minWidth: "52px",
                      textAlign: "center",
                    },
                  },
                  statusLabel(status),
                ),
                // Quick mark buttons (only on unresolved rows)
                !status &&
                  !isCurrent &&
                  h(
                    "div",
                    { style: { display: "flex", gap: "4px" } },
                    h(
                      "button",
                      {
                        onClick: () => {
                          setResults((r) => ({ ...r, [sol]: "open" }));
                          if (isNext) {
                            const n = findNext(i + 1);
                            if (n !== null) setIdx(n);
                          }
                        },
                        style: {
                          padding: "1px 6px",
                          fontFamily: "JetBrains Mono,monospace",
                          fontSize: "8px",
                          background: "rgba(61,214,140,.1)",
                          border: "1px solid rgba(61,214,140,.3)",
                          color: "#3dd68c",
                          borderRadius: "2px",
                          cursor: "pointer",
                        },
                      },
                      "O",
                    ),
                    h(
                      "button",
                      {
                        onClick: () => {
                          setResults((r) => ({ ...r, [sol]: "closed" }));
                          if (isNext) {
                            const n = findNext(i + 1);
                            if (n !== null) setIdx(n);
                          }
                        },
                        style: {
                          padding: "1px 6px",
                          fontFamily: "JetBrains Mono,monospace",
                          fontSize: "8px",
                          background: "rgba(231,76,60,.1)",
                          border: "1px solid rgba(231,76,60,.3)",
                          color: "#e74c3c",
                          borderRadius: "2px",
                          cursor: "pointer",
                        },
                      },
                      "C",
                    ),
                  ),
              );
            }),
          ),
        ),
    );
  }

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.LHFCheckTab = LHFCheckTab;
})();
