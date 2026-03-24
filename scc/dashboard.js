(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — DASHBOARD / MANAGEMENT REPORT v2
  //  Full report: bid funnel · margin bands · FSC performance ·
  //  revenue summary · win/loss · funding split · payment status
  //  Pre-compiled React · No Babel · No JSX
  // ═══════════════════════════════════════════════════════════════════════

  const { createElement: h, Fragment, useState, useEffect } = React;

  function DashboardTab({ rows }) {
    const { fmt, TIER_MARGINS, calcBidMath, FE } = window.SCC_MATH;

    // ── DATE HELPERS ──────────────────────────────────────────────────────
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

    // ── AWARD DATA ────────────────────────────────────────────────────────
    const [awards, setAwards] = useState([]);
    useEffect(() => {
      if (window.SCC_DB && window.SCC_DB.dbGetAwards) {
        window.SCC_DB.dbGetAwards().then((a) => setAwards(a || []));
      }
    }, []);

    // ── PIPELINE SLICES ───────────────────────────────────────────────────
    const active = rows.filter(
      (r) => !["Awarded", "Lost", "On Hold"].includes(r.status),
    );
    const awarded = rows.filter((r) => r.status === "Awarded");
    const lost = rows.filter((r) => r.status === "Lost");
    const onHold = rows.filter((r) => r.status === "On Hold");
    const submitted = rows.filter((r) => r.status === "Bid Submitted");
    const pending = rows.filter((r) => r.status === "Pending Award");
    const dueWeek = rows.filter((r) => daysLeft(r) >= 0 && daysLeft(r) <= 7);
    const overdue = rows.filter(
      (r) => daysLeft(r) < 0 && !["Awarded", "Lost"].includes(r.status),
    );

    const totalBids = awarded.length + lost.length;
    const winRate =
      totalBids > 0 ? Math.round((awarded.length / totalBids) * 100) : null;

    // ── BID MATH ON ALL ROWS ──────────────────────────────────────────────
    function rowMath(r) {
      const qty = parseFloat(r.quantity) || 1;
      const govUnit = parseFloat(r.unit_price) || 0;
      const tier = r.tier || "Standard";
      const margin = TIER_MARGINS[tier] || 0.3;
      const costUnit = r.supplier_quote_price
        ? parseFloat(r.supplier_quote_price)
        : govUnit * 0.7;
      return calcBidMath(
        costUnit,
        qty,
        margin,
        0,
        0,
        parseFloat(r.shipping_cost || 0) || 0,
      );
    }

    // Pipeline totals (active only)
    let pipelineValue = 0,
      pipelineNet = 0,
      pipelineOop = 0;
    active.forEach((r) => {
      const m = rowMath(r);
      pipelineValue += m.bidTotal;
      pipelineNet += m.net;
      pipelineOop += m.cogs;
    });

    // Awards revenue from awards module
    let awardsRevenue = 0,
      awardsGP = 0,
      awardsNet = 0;
    let unpaidAmt = 0,
      paidAmt = 0;
    awards.forEach((a) => {
      awardsRevenue += parseFloat(a.bid_total || 0);
      awardsGP += parseFloat(a.gross_profit || 0);
      awardsNet += parseFloat(a.net_take || 0);
      if (a.payment_status === "paid") paidAmt += parseFloat(a.bid_total || 0);
      else unpaidAmt += parseFloat(a.bid_total || 0);
    });

    // ── MARGIN BAND BREAKDOWN ─────────────────────────────────────────────
    // Bands aligned to new 5-zone thresholds
    const BANDS = [
      {
        label: "Dead (<10%)",
        key: "dead",
        color: "#e74c3c",
        min: -Infinity,
        max: 0.1,
      },
      {
        label: "Thin (10–19%)",
        key: "thin",
        color: "#e8874f",
        min: 0.1,
        max: 0.2,
      },
      {
        label: "Stretch (20–29%)",
        key: "stretch",
        color: "#f0c040",
        min: 0.2,
        max: 0.3,
      },
      {
        label: "Go (30–44%)",
        key: "go",
        color: "#3dd68c",
        min: 0.3,
        max: 0.45,
      },
      {
        label: "Premium (45%+)",
        key: "premium",
        color: "#C9A84C",
        min: 0.45,
        max: Infinity,
      },
    ];

    const bandCounts = { dead: 0, thin: 0, stretch: 0, go: 0, premium: 0 };
    const bandValue = { dead: 0, thin: 0, stretch: 0, go: 0, premium: 0 };
    rows.forEach((r) => {
      const m = rowMath(r);
      const gp = m.gpPct / 100;
      const band = BANDS.find((b) => gp >= b.min && gp < b.max);
      if (band) {
        bandCounts[band.key]++;
        bandValue[band.key] += m.bidTotal;
      }
    });
    const totalBandCount = rows.length || 1;

    // ── FSC BREAKDOWN ─────────────────────────────────────────────────────
    const fscMap = {};
    rows.forEach((r) => {
      if (!r.fsc) return;
      if (!fscMap[r.fsc])
        fscMap[r.fsc] = { count: 0, won: 0, lost: 0, value: 0, net: 0 };
      const m = rowMath(r);
      fscMap[r.fsc].count++;
      fscMap[r.fsc].value += m.bidTotal;
      fscMap[r.fsc].net += m.net;
      if (r.status === "Awarded") fscMap[r.fsc].won++;
      if (r.status === "Lost") fscMap[r.fsc].lost++;
    });
    const fscList = Object.entries(fscMap)
      .sort((a, b) => b[1].value - a[1].value)
      .slice(0, 10);

    // ── TIER BREAKDOWN ────────────────────────────────────────────────────
    const tierCounts = {};
    rows.forEach((r) => {
      const t = r.tier || "Standard";
      tierCounts[t] = (tierCounts[t] || 0) + 1;
    });

    // ── SET-ASIDE BREAKDOWN ───────────────────────────────────────────────
    const saCounts = { Y: 0, N: 0 };
    const saWon = { Y: 0, N: 0 };
    rows.forEach((r) => {
      const sa = (r.set_aside || "N").toUpperCase() === "Y" ? "Y" : "N";
      saCounts[sa]++;
      if (r.status === "Awarded") saWon[sa]++;
    });

    // ── FUNDING SPLIT ─────────────────────────────────────────────────────
    let selfFundedCount = 0,
      sscCount = 0,
      selfFundedValue = 0,
      sscValue = 0;
    rows.forEach((r) => {
      const ext =
        parseFloat(r.extended_price) ||
        parseFloat(r.unit_price || 0) * parseFloat(r.quantity || 1);
      if (ext <= 10000) {
        selfFundedCount++;
        selfFundedValue += ext;
      } else {
        sscCount++;
        sscValue += ext;
      }
    });

    // ── STYLES ────────────────────────────────────────────────────────────
    const card = {
      background: "rgba(255,255,255,.55)",
      border: "1px solid rgba(120,80,0,.18)",
      borderTop: "2px solid rgba(120,80,0,.35)",
      padding: "18px 20px",
      borderRadius: "2px",
    };
    const sectionTitle = {
      fontFamily: "Cinzel,serif",
      fontSize: "11px",
      letterSpacing: "2px",
      textTransform: "uppercase",
      color: "rgba(100,65,0,.8)",
      marginBottom: "14px",
    };
    const kpiVal = {
      fontFamily: "JetBrains Mono,monospace",
      fontSize: "26px",
      fontWeight: 700,
    };
    const kpiLbl = {
      fontFamily: "Cinzel,serif",
      fontSize: "10px",
      letterSpacing: "1.5px",
      textTransform: "uppercase",
      color: "rgba(80,50,0,.65)",
      marginTop: "4px",
    };
    const divider = h("div", {
      style: {
        height: "1px",
        background: "rgba(120,80,0,.12)",
        margin: "18px 0",
      },
    });

    // ── BAR HELPER ────────────────────────────────────────────────────────
    const Bar = ({ pct, color, height }) =>
      h(
        "div",
        {
          style: {
            width: "100%",
            height: height || "6px",
            background: "rgba(245,240,232,.08)",
            borderRadius: "3px",
            overflow: "hidden",
            marginTop: "4px",
          },
        },
        h("div", {
          style: {
            width: Math.min(pct * 100, 100) + "%",
            height: "100%",
            background: color,
            borderRadius: "3px",
            transition: "width .5s ease",
          },
        }),
      );

    const Row2 = (lbl, val, color, sub) =>
      h(
        "div",
        {
          key: lbl,
          style: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "5px 0",
            borderBottom: "1px solid rgba(120,80,0,.1)",
          },
        },
        h(
          "span",
          {
            style: {
              fontSize: "12px",
              color: "rgba(60,35,0,.7)",
              fontFamily: "Cormorant Garamond,serif",
            },
          },
          lbl + (sub ? " · " + sub : ""),
        ),
        h(
          "span",
          {
            style: {
              fontSize: "13px",
              color: color || "#C9A84C",
              fontFamily: "Cinzel,serif",
              fontWeight: 600,
            },
          },
          val,
        ),
      );

    return h(
      "div",
      { style: { animation: "fadeUp .5s ease both", paddingBottom: "32px" } },

      // ── PAGE HEADER ───────────────────────────────────────────────────
      h(
        "div",
        {
          style: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            marginBottom: "24px",
            flexWrap: "wrap",
            gap: "8px",
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
                fontSize: "26px",
                letterSpacing: ".12em",
                color: "var(--gold-solid)",
              },
            },
            "Management Report",
          ),
          h(
            "div",
            {
              style: {
                fontFamily: "Cormorant Garamond,serif",
                fontStyle: "italic",
                fontSize: "14px",
                color: "var(--gold-dim)",
                marginTop: "3px",
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
        h(
          "div",
          {
            style: {
              fontFamily: "Cinzel,serif",
              fontSize: "11px",
              color: "rgba(80,50,0,.5)",
              letterSpacing: "1px",
            },
          },
          rows.length + " solicitations · " + awards.length + " awards",
        ),
      ),

      // ── ROW 1: TOP KPI CARDS ──────────────────────────────────────────
      h(
        "div",
        {
          style: {
            display: "grid",
            gridTemplateColumns: "repeat(5,1fr)",
            gap: "12px",
            marginBottom: "16px",
          },
        },

        // Active Bids
        h(
          "div",
          { style: card },
          h(
            "div",
            { style: { ...kpiVal, color: "var(--gold-solid)" } },
            active.length,
          ),
          h("div", { style: kpiLbl }, "Active Bids"),
          overdue.length > 0 &&
            h(
              "div",
              {
                style: {
                  fontSize: "11px",
                  color: "#e74c3c",
                  fontFamily: "Cinzel,serif",
                  marginTop: "4px",
                },
              },
              overdue.length + " overdue",
            ),
        ),

        // Win Rate
        h(
          "div",
          { style: card },
          h(
            "div",
            {
              style: {
                ...kpiVal,
                color:
                  winRate !== null
                    ? winRate >= 50
                      ? "#3dd68c"
                      : "#f0c040"
                    : "rgba(201,168,76,.4)",
              },
            },
            winRate !== null ? winRate + "%" : "—",
          ),
          h("div", { style: kpiLbl }, "Win Rate"),
          totalBids > 0 &&
            h(
              "div",
              {
                style: {
                  fontSize: "11px",
                  color: "rgba(80,50,0,.55)",
                  fontFamily: "Cormorant Garamond,serif",
                  marginTop: "3px",
                },
              },
              awarded.length + "W · " + lost.length + "L",
            ),
        ),

        // Pipeline Value
        h(
          "div",
          { style: card },
          h(
            "div",
            { style: { ...kpiVal, fontSize: "20px", color: "#C9A84C" } },
            fmt(pipelineValue),
          ),
          h("div", { style: kpiLbl }, "Pipeline Value"),
          h(
            "div",
            {
              style: {
                fontSize: "11px",
                color: "rgba(80,50,0,.55)",
                fontFamily: "Cormorant Garamond,serif",
                marginTop: "3px",
              },
            },
            "active bids only",
          ),
        ),

        // Awards Revenue
        h(
          "div",
          { style: card },
          h(
            "div",
            { style: { ...kpiVal, fontSize: "20px", color: "#3dd68c" } },
            fmt(awardsRevenue),
          ),
          h("div", { style: kpiLbl }, "Awarded Revenue"),
          awards.length > 0 &&
            h(
              "div",
              {
                style: {
                  fontSize: "11px",
                  color: "rgba(61,214,140,.5)",
                  fontFamily: "Cormorant Garamond,serif",
                  marginTop: "3px",
                },
              },
              awards.length + " contracts",
            ),
        ),

        // Due This Week
        h(
          "div",
          { style: card },
          h(
            "div",
            {
              style: {
                ...kpiVal,
                color: dueWeek.length > 0 ? "#f0c040" : "rgba(201,168,76,.4)",
              },
            },
            dueWeek.length,
          ),
          h("div", { style: kpiLbl }, "Due This Week"),
          submitted.length > 0 &&
            h(
              "div",
              {
                style: {
                  fontSize: "11px",
                  color: "rgba(80,50,0,.55)",
                  fontFamily: "Cormorant Garamond,serif",
                  marginTop: "3px",
                },
              },
              submitted.length + " submitted",
            ),
        ),
      ),

      // ── ROW 2: PIPELINE FUNNEL + MARGIN BANDS ─────────────────────────
      h(
        "div",
        {
          style: {
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "12px",
            marginBottom: "16px",
          },
        },

        // Bid Pipeline Funnel
        h(
          "div",
          { style: card },
          h("div", { style: sectionTitle }, "Pipeline Funnel"),
          ...[
            [
              "New / Researching",
              rows.filter((r) => ["New", "Researching"].includes(r.status))
                .length,
              "rgba(245,240,232,.5)",
            ],
            [
              "Sourcing",
              rows.filter((r) => r.status === "Sourcing").length,
              "#7eb8f7",
            ],
            ["Bid Submitted", submitted.length, "#C9A84C"],
            ["Pending Award", pending.length, "#f0c040"],
            ["Awarded", awarded.length, "#3dd68c"],
            ["Lost", lost.length, "#e74c3c"],
            ["On Hold", onHold.length, "rgba(245,240,232,.3)"],
          ].map(([label, count, color]) => {
            const pct = rows.length > 0 ? count / rows.length : 0;
            return h(
              "div",
              { key: label, style: { marginBottom: "8px" } },
              h(
                "div",
                {
                  style: {
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: "2px",
                  },
                },
                h(
                  "span",
                  {
                    style: {
                      fontSize: "12px",
                      color: "rgba(60,35,0,.75)",
                      fontFamily: "Cormorant Garamond,serif",
                    },
                  },
                  label,
                ),
                h(
                  "span",
                  {
                    style: {
                      fontSize: "12px",
                      color: color,
                      fontFamily: "Cinzel,serif",
                      fontWeight: 600,
                    },
                  },
                  count,
                ),
              ),
              Bar({ pct, color, height: "5px" }),
            );
          }),
        ),

        // Margin Band Distribution
        h(
          "div",
          { style: card },
          h("div", { style: sectionTitle }, "Margin Band Distribution"),
          h(
            "div",
            {
              style: {
                fontSize: "11px",
                color: "rgba(80,50,0,.5)",
                fontFamily: "Cormorant Garamond,serif",
                marginBottom: "10px",
              },
            },
            "Based on gross margin % across all " +
              rows.length +
              " solicitations",
          ),
          ...BANDS.map((band) => {
            const count = bandCounts[band.key];
            const pct = count / totalBandCount;
            return h(
              "div",
              { key: band.key, style: { marginBottom: "10px" } },
              h(
                "div",
                {
                  style: {
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: "2px",
                  },
                },
                h(
                  "span",
                  {
                    style: {
                      fontSize: "12px",
                      color: band.color,
                      fontFamily: "Cinzel,serif",
                      letterSpacing: ".5px",
                    },
                  },
                  band.label,
                ),
                h(
                  "div",
                  {
                    style: {
                      display: "flex",
                      gap: "12px",
                      alignItems: "center",
                    },
                  },
                  h(
                    "span",
                    {
                      style: {
                        fontSize: "11px",
                        color: "rgba(80,50,0,.6)",
                        fontFamily: "Cormorant Garamond,serif",
                      },
                    },
                    fmt(bandValue[band.key]),
                  ),
                  h(
                    "span",
                    {
                      style: {
                        fontSize: "12px",
                        color: band.color,
                        fontFamily: "Cinzel,serif",
                        fontWeight: 600,
                        minWidth: "28px",
                        textAlign: "right",
                      },
                    },
                    count,
                  ),
                ),
              ),
              Bar({ pct, color: band.color, height: "6px" }),
            );
          }),
        ),
      ),

      // ── ROW 3: REVENUE SUMMARY + WIN/LOSS ANALYSIS ────────────────────
      h(
        "div",
        {
          style: {
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "12px",
            marginBottom: "16px",
          },
        },

        // Revenue & Profit Summary
        h(
          "div",
          { style: card },
          h("div", { style: sectionTitle }, "Revenue & Profit Summary"),

          h(
            "div",
            { style: { marginBottom: "12px" } },
            h(
              "div",
              {
                style: {
                  fontSize: "10px",
                  color: "rgba(100,65,0,.7)",
                  fontFamily: "Cinzel,serif",
                  letterSpacing: "1px",
                  marginBottom: "6px",
                },
              },
              "AWARDED CONTRACTS",
            ),
            Row2("Contract Revenue", fmt(awardsRevenue), "#C9A84C"),
            Row2(
              "Gross Profit",
              fmt(awardsGP),
              awardsGP >= 0 ? "#3dd68c" : "#e74c3c",
            ),
            Row2(
              "Net Take",
              fmt(awardsNet),
              awardsNet >= 0 ? "#3dd68c" : "#e74c3c",
            ),
            awardsRevenue > 0
              ? Row2(
                  "Avg GP%",
                  (awardsRevenue > 0
                    ? ((awardsGP / awardsRevenue) * 100).toFixed(1)
                    : "—") + "%",
                  "#C9A84C",
                )
              : null,
          ),

          divider,

          h(
            "div",
            null,
            h(
              "div",
              {
                style: {
                  fontSize: "10px",
                  color: "rgba(100,65,0,.7)",
                  fontFamily: "Cinzel,serif",
                  letterSpacing: "1px",
                  marginBottom: "6px",
                },
              },
              "PAYMENT STATUS",
            ),
            Row2("Collected", fmt(paidAmt), "#3dd68c"),
            Row2(
              "Outstanding",
              fmt(unpaidAmt),
              unpaidAmt > 0 ? "#f0c040" : "rgba(245,240,232,.5)",
            ),
          ),

          divider,

          h(
            "div",
            null,
            h(
              "div",
              {
                style: {
                  fontSize: "10px",
                  color: "rgba(100,65,0,.7)",
                  fontFamily: "Cinzel,serif",
                  letterSpacing: "1px",
                  marginBottom: "6px",
                },
              },
              "ACTIVE PIPELINE",
            ),
            Row2("Potential Value", fmt(pipelineValue), "#C9A84C"),
            Row2(
              "Est. Net Take",
              fmt(pipelineNet),
              pipelineNet >= 0 ? "#3dd68c" : "#e74c3c",
            ),
            Row2("Est. Out of Pocket", fmt(pipelineOop), "#e74c3c"),
          ),
        ),

        // Win/Loss + Tier + Set-Aside + Funding Split
        h(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: "12px" } },

          // Win/Loss by Set-Aside
          h(
            "div",
            { style: { ...card, flex: "none" } },
            h("div", { style: sectionTitle }, "Win Rate by Set-Aside"),
            ...["Y", "N"].map((sa) => {
              const total = saCounts[sa];
              const won = saWon[sa];
              const rate = total > 0 ? won / total : 0;
              return h(
                "div",
                { key: sa, style: { marginBottom: "8px" } },
                h(
                  "div",
                  {
                    style: {
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: "2px",
                    },
                  },
                  h(
                    "span",
                    {
                      style: {
                        fontSize: "12px",
                        color: "rgba(60,35,0,.75)",
                        fontFamily: "Cormorant Garamond,serif",
                      },
                    },
                    sa === "Y" ? "Set-Aside (SDVOSB)" : "Unrestricted / Open",
                  ),
                  h(
                    "span",
                    {
                      style: {
                        fontSize: "12px",
                        color: rate >= 0.5 ? "#3dd68c" : "#f0c040",
                        fontFamily: "Cinzel,serif",
                        fontWeight: 600,
                      },
                    },
                    total > 0 ? Math.round(rate * 100) + "%" : "—",
                    h(
                      "span",
                      {
                        style: {
                          color: "rgba(80,50,0,.5)",
                          fontSize: "10px",
                          marginLeft: "6px",
                        },
                      },
                      "(" + total + ")",
                    ),
                  ),
                ),
                Bar({
                  pct: rate,
                  color: rate >= 0.5 ? "#3dd68c" : "#f0c040",
                  height: "5px",
                }),
              );
            }),
          ),

          // Tier distribution
          h(
            "div",
            { style: { ...card, flex: "none" } },
            h("div", { style: sectionTitle }, "Tier Distribution"),
            h(
              "div",
              {
                style: {
                  display: "grid",
                  gridTemplateColumns: "repeat(2,1fr)",
                  gap: "8px",
                },
              },
              ...Object.entries(tierCounts).map(([tier, count]) =>
                h(
                  "div",
                  {
                    key: tier,
                    style: {
                      padding: "8px 10px",
                      background: "rgba(120,80,0,.04)",
                      border: "1px solid rgba(120,80,0,.12)",
                      borderRadius: "4px",
                    },
                  },
                  h(
                    "div",
                    {
                      style: {
                        fontSize: "18px",
                        fontFamily: "Cinzel,serif",
                        fontWeight: 700,
                        color: tier.includes("Hanging")
                          ? "#C9A84C"
                          : tier.includes("Fast")
                            ? "#f0c040"
                            : "#7eb8f7",
                      },
                    },
                    count,
                  ),
                  h(
                    "div",
                    {
                      style: {
                        fontSize: "10px",
                        color: "rgba(80,50,0,.6)",
                        fontFamily: "Cinzel,serif",
                        letterSpacing: ".5px",
                        marginTop: "2px",
                      },
                    },
                    tier,
                  ),
                ),
              ),
            ),
          ),

          // Funding split
          h(
            "div",
            { style: { ...card, flex: "none" } },
            h("div", { style: sectionTitle }, "Funding Path Split"),
            h(
              "div",
              {
                style: {
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "8px",
                },
              },
              h(
                "div",
                {
                  style: {
                    padding: "8px 10px",
                    background: "rgba(61,214,140,.05)",
                    border: "1px solid rgba(0,140,80,.25)",
                    borderRadius: "4px",
                  },
                },
                h(
                  "div",
                  {
                    style: {
                      fontSize: "18px",
                      fontFamily: "Cinzel,serif",
                      fontWeight: 700,
                      color: "#3dd68c",
                    },
                  },
                  selfFundedCount,
                ),
                h(
                  "div",
                  {
                    style: {
                      fontSize: "10px",
                      color: "rgba(61,214,140,.6)",
                      fontFamily: "Cinzel,serif",
                      letterSpacing: ".5px",
                      marginTop: "2px",
                    },
                  },
                  "Self-Funded",
                ),
                h(
                  "div",
                  {
                    style: {
                      fontSize: "11px",
                      color: "rgba(80,50,0,.55)",
                      fontFamily: "Cormorant Garamond,serif",
                      marginTop: "2px",
                    },
                  },
                  fmt(selfFundedValue),
                ),
              ),
              h(
                "div",
                {
                  style: {
                    padding: "8px 10px",
                    background: "rgba(201,168,76,.05)",
                    border: "1px solid rgba(120,80,0,.2)",
                    borderRadius: "4px",
                  },
                },
                h(
                  "div",
                  {
                    style: {
                      fontSize: "18px",
                      fontFamily: "Cinzel,serif",
                      fontWeight: 700,
                      color: "#C9A84C",
                    },
                  },
                  sscCount,
                ),
                h(
                  "div",
                  {
                    style: {
                      fontSize: "10px",
                      color: "rgba(100,65,0,.75)",
                      fontFamily: "Cinzel,serif",
                      letterSpacing: ".5px",
                      marginTop: "2px",
                    },
                  },
                  "SSC / FE",
                ),
                h(
                  "div",
                  {
                    style: {
                      fontSize: "11px",
                      color: "rgba(80,50,0,.55)",
                      fontFamily: "Cormorant Garamond,serif",
                      marginTop: "2px",
                    },
                  },
                  fmt(sscValue),
                ),
              ),
            ),
          ),
        ),
      ),

      // ── ROW 4: FSC PERFORMANCE TABLE ──────────────────────────────────
      h(
        "div",
        { style: { ...card, marginBottom: "16px" } },
        h("div", { style: sectionTitle }, "FSC Lane Performance"),
        fscList.length === 0
          ? h(
              "div",
              {
                style: {
                  fontFamily: "Cormorant Garamond,serif",
                  fontStyle: "italic",
                  fontSize: "14px",
                  color: "rgba(80,50,0,.5)",
                },
              },
              "No FSC data yet",
            )
          : h(
              "div",
              { style: { overflowX: "auto" } },
              h(
                "table",
                { style: { width: "100%", borderCollapse: "collapse" } },
                h(
                  "thead",
                  null,
                  h(
                    "tr",
                    null,
                    ...[
                      "FSC",
                      "Lane",
                      "Bids",
                      "Won",
                      "Lost",
                      "Win%",
                      "Bid Value",
                      "Est. Net",
                    ].map((col) =>
                      h(
                        "th",
                        {
                          key: col,
                          style: {
                            fontFamily: "Cinzel,serif",
                            fontSize: "10px",
                            letterSpacing: "1.5px",
                            textTransform: "uppercase",
                            color: "rgba(100,65,0,.75)",
                            padding: "6px 12px",
                            textAlign:
                              col === "FSC" || col === "Lane"
                                ? "left"
                                : "right",
                            borderBottom: "1px solid rgba(120,80,0,.2)",
                            whiteSpace: "nowrap",
                          },
                        },
                        col,
                      ),
                    ),
                  ),
                ),
                h(
                  "tbody",
                  null,
                  fscList.map(([fsc, data], i) => {
                    const fscWinRate =
                      data.won + data.lost > 0
                        ? Math.round((data.won / (data.won + data.lost)) * 100)
                        : null;
                    const laneName =
                      (window.SCC_DIST?.FSC_LANES_MAP || {})[fsc] || "—";
                    return h(
                      "tr",
                      {
                        key: fsc,
                        style: {
                          background:
                            i % 2 === 0
                              ? "rgba(245,240,232,.02)"
                              : "transparent",
                          borderBottom: "1px solid rgba(120,80,0,.08)",
                        },
                      },
                      h(
                        "td",
                        {
                          style: {
                            padding: "8px 12px",
                            fontFamily: "JetBrains Mono,monospace",
                            fontSize: "12px",
                            color: "#C9A84C",
                          },
                        },
                        fsc,
                      ),
                      h(
                        "td",
                        {
                          style: {
                            padding: "8px 12px",
                            fontFamily: "Cormorant Garamond,serif",
                            fontSize: "12px",
                            color: "rgba(60,35,0,.7)",
                            maxWidth: "160px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          },
                        },
                        laneName,
                      ),
                      h(
                        "td",
                        {
                          style: {
                            padding: "8px 12px",
                            textAlign: "right",
                            fontFamily: "Cinzel,serif",
                            fontSize: "12px",
                            color: "rgba(60,35,0,.85)",
                          },
                        },
                        data.count,
                      ),
                      h(
                        "td",
                        {
                          style: {
                            padding: "8px 12px",
                            textAlign: "right",
                            fontFamily: "Cinzel,serif",
                            fontSize: "12px",
                            color: "#3dd68c",
                          },
                        },
                        data.won,
                      ),
                      h(
                        "td",
                        {
                          style: {
                            padding: "8px 12px",
                            textAlign: "right",
                            fontFamily: "Cinzel,serif",
                            fontSize: "12px",
                            color:
                              data.lost > 0
                                ? "#e74c3c"
                                : "rgba(245,240,232,.3)",
                          },
                        },
                        data.lost,
                      ),
                      h(
                        "td",
                        {
                          style: {
                            padding: "8px 12px",
                            textAlign: "right",
                            fontFamily: "Cinzel,serif",
                            fontSize: "12px",
                            color:
                              fscWinRate !== null
                                ? fscWinRate >= 50
                                  ? "#3dd68c"
                                  : "#f0c040"
                                : "rgba(245,240,232,.3)",
                          },
                        },
                        fscWinRate !== null ? fscWinRate + "%" : "—",
                      ),
                      h(
                        "td",
                        {
                          style: {
                            padding: "8px 12px",
                            textAlign: "right",
                            fontFamily: "Cinzel,serif",
                            fontSize: "12px",
                            color: "#C9A84C",
                          },
                        },
                        fmt(data.value),
                      ),
                      h(
                        "td",
                        {
                          style: {
                            padding: "8px 12px",
                            textAlign: "right",
                            fontFamily: "Cinzel,serif",
                            fontSize: "12px",
                            fontWeight: 600,
                            color: data.net >= 0 ? "#3dd68c" : "#e74c3c",
                          },
                        },
                        fmt(data.net),
                      ),
                    );
                  }),
                ),
              ),
            ),
      ),

      // ── ROW 5: DUE THIS WEEK ──────────────────────────────────────────
      dueWeek.length > 0 &&
        h(
          "div",
          { style: card },
          h(
            "div",
            { style: sectionTitle },
            "Due This Week · " +
              dueWeek.length +
              " solicitation" +
              (dueWeek.length !== 1 ? "s" : ""),
          ),
          h(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: "6px" } },
            dueWeek.map((r) => {
              const dl = daysLeft(r);
              const clr =
                dl === 0
                  ? "#e74c3c"
                  : dl <= 2
                    ? "#f0c040"
                    : "rgba(245,240,232,.6)";
              const lbl = dl === 0 ? "TODAY" : dl === 1 ? "TOMORROW" : dl + "d";
              return h(
                "div",
                {
                  key: r.sol_number,
                  style: {
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 12px",
                    background: "rgba(120,80,0,.03)",
                    borderLeft: "2px solid " + clr,
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
                        fontSize: "13px",
                        fontWeight: 700,
                        color: "#C9A84C",
                        letterSpacing: ".05em",
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
                        color: "rgba(60,35,0,.75)",
                        marginTop: "1px",
                      },
                    },
                    r.item_name || "—",
                  ),
                ),
                h(
                  "div",
                  {
                    style: {
                      display: "flex",
                      gap: "16px",
                      alignItems: "center",
                    },
                  },
                  h(
                    "span",
                    {
                      style: {
                        fontFamily: "Cormorant Garamond,serif",
                        fontSize: "12px",
                        color: "rgba(80,50,0,.6)",
                      },
                    },
                    r.fsc || "",
                  ),
                  h(
                    "span",
                    {
                      style: {
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "12px",
                        fontWeight: 700,
                        color: clr,
                      },
                    },
                    lbl,
                  ),
                ),
              );
            }),
          ),
        ),
    );
  }

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.DashboardTab = DashboardTab;
})();
