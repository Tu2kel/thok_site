(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — DASHBOARD TAB
  //  Pre-compiled React · No Babel · No JSX
  // ═══════════════════════════════════════════════════════════════════════

  const { createElement: h, Fragment } = React;

  function DashboardTab({ rows }) {
    const { fmt, TIER_MARGINS, calcBidMath } = window.SCC_MATH;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const parseD = (s) => {
      if (!s) return null;
      const [m, d, y] = s.split("/");
      return new Date(2000 + parseInt(y), m - 1, d);
    };
    const daysLeft = (r) => {
      const d = parseD(r.quote_due);
      return d ? Math.round((d - today) / 86400000) : 999;
    };

    const active = rows.filter((r) => !["Awarded", "Lost"].includes(r.status));
    const awarded = rows.filter((r) => r.status === "Awarded");
    const lost = rows.filter((r) => r.status === "Lost");
    const dueWeek = rows.filter((r) => daysLeft(r) >= 0 && daysLeft(r) <= 7);
    const overdue = rows.filter(
      (r) => daysLeft(r) < 0 && !["Awarded", "Lost"].includes(r.status),
    );

    let totalNet = 0,
      totalOop = 0;
    active.forEach((r) => {
      const qty = parseFloat(r.quantity) || 1;
      const govUnit = parseFloat(r.unit_price) || 0;
      const tier = r.tier || "Standard";
      const tierMargin = TIER_MARGINS[tier] || 0.3;
      const costUnit = r.supplier_quote_price
        ? parseFloat(r.supplier_quote_price)
        : govUnit * 0.7;
      const m = calcBidMath(costUnit, qty, tierMargin, 0, 0, 0);
      totalNet += m.net;
      totalOop += m.cogs;
    });

    // FSC breakdown
    const fscMap = {};
    rows.forEach((r) => {
      if (!r.fsc) return;
      if (!fscMap[r.fsc]) fscMap[r.fsc] = { count: 0, net: 0, won: 0, lost: 0 };
      fscMap[r.fsc].count++;
      const qty = parseFloat(r.quantity) || 1;
      const govUnit = parseFloat(r.unit_price) || 0;
      const tier = r.tier || "Standard";
      const costUnit = r.supplier_quote_price
        ? parseFloat(r.supplier_quote_price)
        : govUnit * 0.7;
      const m = calcBidMath(costUnit, qty, TIER_MARGINS[tier] || 0.3, 0, 0, 0);
      fscMap[r.fsc].net += m.net;
      if (r.status === "Awarded") fscMap[r.fsc].won++;
      if (r.status === "Lost") fscMap[r.fsc].lost++;
    });
    const fscList = Object.entries(fscMap).sort((a, b) => b[1].net - a[1].net);
    const winRate =
      awarded.length + lost.length > 0
        ? Math.round((awarded.length / (awarded.length + lost.length)) * 100)
        : null;

    const cardStyle = {
      background: "var(--surface-sheen)",
      border: "1px solid rgba(201,168,76,.2)",
      borderTop: "2px solid rgba(201,168,76,.5)",
      padding: "20px 24px",
      flex: "1",
      minWidth: "160px",
    };
    const cardLbl = {
      fontFamily: "Cinzel,serif",
      fontSize: "12px",
      letterSpacing: ".18em",
      color: `red`,
      textTransform: "uppercase",
      marginBottom: "12px",
      fontWeight: `bold`,
    };
    const cardVal = {
      fontFamily: "JetBrains Mono,monospace",
      fontSize: "28px",
      fontWeight: "700",
    };

    return h(
      "div",
      { style: { animation: "fadeUp .5s ease both" } },
      // Header
      h(
        "div",
        {
          style: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            marginBottom: "28px",
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
                fontSize: "28px",
                letterSpacing: ".12em",
                color: "var(--gold-solid)",
              },
            },
            "Command Overview",
          ),
          h(
            "div",
            {
              style: {
                fontFamily: "Cormorant Garamond,serif",
                fontStyle: "italic",
                fontSize: "15px",
                color: "var(--gold-dim)",
                marginTop: "4px",
              },
            },
            new Date().toLocaleDateString("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            }),
          ),
        ),
      ),

      // KPI Cards
      h(
        "div",
        {
          style: {
            display: "flex",
            gap: "14px",
            flexWrap: "wrap",
            marginBottom: "28px",
          },
        },
        h(
          "div",
          { style: cardStyle },
          h("div", { style: cardLbl }, "Active Bids"),
          h(
            "div",
            { style: { ...cardVal, color: "var(--gold-solid)" } },
            active.length,
          ),
        ),
        h(
          "div",
          { style: cardStyle },
          h("div", { style: cardLbl }, "Due This Week"),
          h(
            "div",
            {
              style: {
                ...cardVal,
                color:
                  dueWeek.length > 0 ? "var(--amber)" : "var(--gold-solid)",
              },
            },
            dueWeek.length,
          ),
          overdue.length > 0 &&
            h(
              "div",
              {
                style: {
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "14px",
                  color: "var(--red)",
                  marginTop: "4px",
                },
              },
              overdue.length + " overdue",
            ),
        ),
        h(
          "div",
          { style: cardStyle },
          h("div", { style: cardLbl }, "Est. Net Take Home"),
          h(
            "div",
            {
              style: {
                ...cardVal,
                background: "linear-gradient(90deg,#a8f0c6,#3ddc84)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              },
            },
            fmt(totalNet),
          ),
          h(
            "div",
            {
              style: {
                fontFamily: "JetBrains Mono,monospace",
                fontSize: "14px",
                color: "var(--body-faint)",
                marginTop: "4px",
              },
            },
            "active pipeline",
          ),
        ),
        h(
          "div",
          { style: cardStyle },
          h("div", { style: cardLbl }, "Est. Out of Pocket"),
          h(
            "div",
            { style: { ...cardVal, color: "var(--red)" } },
            fmt(totalOop),
          ),
          h(
            "div",
            {
              style: {
                fontFamily: "JetBrains Mono,monospace",
                fontSize: "14px",
                color: "var(--accent-red-dim)",
                marginTop: "4px",
              },
            },
            "supplier cost",
          ),
        ),
        h(
          "div",
          { style: cardStyle },
          h("div", { style: cardLbl }, "Win Rate"),
          h(
            "div",
            {
              style: {
                ...cardVal,
                color:
                  winRate >= 50
                    ? "var(--green)"
                    : winRate !== null
                      ? "var(--amber)"
                      : "var(--gold-dim)",
              },
            },
            winRate !== null ? winRate + "%" : "—",
          ),
          h(
            "div",
            {
              style: {
                fontFamily: "JetBrains Mono,monospace",
                fontSize: "14px",
                color: "var(--body-faint)",
                marginTop: "4px",
              },
            },
            awarded.length + "W / " + lost.length + "L",
          ),
        ),
        h(
          "div",
          { style: cardStyle },
          h("div", { style: cardLbl }, "Total Bids"),
          h(
            "div",
            { style: { ...cardVal, color: "var(--gold-solid)" } },
            rows.length,
          ),
          h(
            "div",
            {
              style: {
                fontFamily: "JetBrains Mono,monospace",
                fontSize: "14px",
                color: "var(--body-faint)",
                marginTop: "4px",
              },
            },
            "all time",
          ),
        ),
      ),

      // Bottom row
      h(
        "div",
        {
          style: {
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "14px",
          },
        },

        // Due This Week
        h(
          "div",
          { style: { ...cardStyle, flex: "unset", minWidth: "unset" } },
          h(
            "div",
            { style: { ...cardLbl, marginBottom: "14px" } },
            "Due This Week",
          ),
          dueWeek.length === 0
            ? h(
                "div",
                {
                  style: {
                    fontFamily: "Cormorant Garamond,serif",
                    fontStyle: "italic",
                    fontSize: "15px",
                    color: "var(--body-faint)",
                  },
                },
                "No bids due this week",
              )
            : h(
                "div",
                {
                  style: {
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  },
                },
                dueWeek.map((r) => {
                  const dl = daysLeft(r);
                  const clr =
                    dl === 0
                      ? "var(--red)"
                      : dl === 1
                        ? "var(--amber)"
                        : "var(--body-mono)";
                  const label =
                    dl === 0 ? "TODAY" : dl === 1 ? "TOMORROW" : dl + "d";
                  return h(
                    "div",
                    {
                      key: r.sol_number,
                      style: {
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "8px 12px",
                        background: "var(--inset-bg)",
                        borderLeft:
                          "2px solid " +
                          (dl === 0
                            ? "var(--red)"
                            : dl <= 2
                              ? "var(--amber)"
                              : "rgba(201,168,76,.3)"),
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
                            fontSize: "14px",
                            fontWeight: "bold",
                            letterSpacing: ".06em",
                            background: `linear-gradient(
                                135deg,
                                #140000 0%,
                                #4a0606 18%,
                                #8f0d0d 32%,
                                #d81f1f 45%,
                                #d81f1f 55%,
                                #8f0d0d 68%,
                                #4a0606 82%,
                                #140000 100%
                              )`,
                            WebkitBackgroundClip: "text",
                            backgroundClip: "text",
                            color: "transparent",
                          },
                        },
                        r.sol_number,
                      ),
                      h(
                        "div",
                        {
                          style: {
                            fontFamily: "Cormorant Garamond,serif",
                            fontSize: "13px",
                            fontWeight: "bold",
                            color: "var(--body-color)",
                            marginTop: "2px",
                          },
                        },
                        r.item_name || "—",
                      ),
                    ),
                    h(
                      "div",
                      {
                        style: {
                          fontFamily: "JetBrains Mono,monospace",
                          fontSize: "13px",
                          fontWeight: "700",
                          color: clr,
                        },
                      },
                      label,
                    ),
                  );
                }),
              ),
        ),

        // FSC Breakdown
        h(
          "div",
          { style: { ...cardStyle, flex: "unset", minWidth: "unset" } },
          h(
            "div",
            { style: { ...cardLbl, marginBottom: "14px" } },
            "FSC Lane Performance",
          ),
          fscList.length === 0
            ? h(
                "div",
                {
                  style: {
                    fontFamily: "Cormorant Garamond,serif",
                    fontStyle: "italic",
                    fontSize: "15px",
                    color: "var(--body-faint)",
                  },
                },
                "No FSC data yet",
              )
            : h(
                "div",
                {
                  style: {
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                  },
                },
                fscList.slice(0, 8).map(([fsc, data]) =>
                  h(
                    "div",
                    {
                      key: fsc,
                      style: {
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "6px 12px",
                        background: "var(--inset-bg)",
                        borderLeft: "2px solid rgba(201,168,76,.25)",
                      },
                    },
                    h(
                      "div",
                      null,
                      h(
                        "span",
                        {
                          style: {
                            fontFamily: "JetBrains Mono, monospace",
                            fontSize: "12px",
                            background: `linear-gradient(
                              135deg,
                              #140000 0%,
                              #4a0606 18%,
                              #8f0d0d 32%,
                              #d81f1f 45%,
                              
                              #d81f1f 55%,
                              #8f0d0d 68%,
                              #4a0606 82%,
                              #140000 100%
                            )`,
                            WebkitBackgroundClip: "text",
                            backgroundClip: "text",
                            color: "transparent",
                          },
                        },
                        fsc,
                      ),
                      // h('span',{style:{fontFamily:'JetBrains Mono,monospace',fontSize:'12px',color:'var(--gold-solid)'}},fsc),
                      h(
                        "span",
                        {
                          style: {
                            fontFamily: "Cormorant Garamond,serif",
                            fontSize: "12px",
                            color: "var(--accent-blue)",
                            marginLeft: "8px",
                          },
                        },
                        (window.SCC_DIST?.FSC_LANES_MAP || {})[fsc] || "",
                      ),
                      h(
                        "span",
                        {
                          style: {
                            fontFamily: "JetBrains Mono,monospace",
                            fontSize: "12px",
                            color: "var(--body-color)",
                            marginLeft: "8px",
                          },
                        },
                        data.count + " bids",
                      ),
                    ),
                    h(
                      "span",
                      {
                        style: {
                          fontFamily: "JetBrains Mono,monospace",
                          fontSize: "13px",
                          fontWeight: "700",
                          color: data.net >= 0 ? "var(--green)" : "var(--red)",
                        },
                      },
                      fmt(data.net),
                    ),
                  ),
                ),
              ),
        ),
      ),
    );
  }

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.DashboardTab = DashboardTab;
})();
