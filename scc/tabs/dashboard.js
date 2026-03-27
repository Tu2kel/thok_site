(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — DASHBOARD / MANAGEMENT REPORT v2
  //  Full report: bid funnel · margin bands · FSC performance ·
  //  revenue summary · win/loss · funding split · payment status
  //  Pre-compiled React · No Babel · No JSX
  // ═══════════════════════════════════════════════════════════════════════

  const { createElement: h, Fragment, useState, useEffect } = React;

  function DashboardTab({ rows, goPipeline }) {
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

    // ── ESBD DATA ─────────────────────────────────────────────────────────
    const [esbdBids, setEsbdBids] = useState([]);
    useEffect(() => {
      if (window.SCC_ESBD && window.SCC_ESBD.esbdGetAll) {
        window.SCC_ESBD.esbdGetAll().then((b) => setEsbdBids(b || []));
      }
    }, []);

    const esbdActive = esbdBids.filter(
      (b) => !["Awarded", "Lost", "No Bid"].includes(b.status),
    );
    const esbdAwarded = esbdBids.filter((b) => b.status === "Awarded");
    const esbdPipelineValue = esbdActive.reduce(
      (s, b) => s + (parseFloat(b.bid_total) || 0),
      0,
    );
    const esbdAwardedValue = esbdAwarded.reduce(
      (s, b) => s + (parseFloat(b.bid_total) || 0),
      0,
    );

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
    const due8to30 = rows.filter((r) => daysLeft(r) >= 8 && daysLeft(r) <= 30);

    // ── ESBD DEADLINE HELPERS ─────────────────────────────────────────────
    const parseEsbdDate = (s) => {
      if (!s) return null;
      // handles MM/DD/YY, MM/DD/YYYY, YYYY-MM-DD
      if (s.includes("-")) return new Date(s);
      const parts = s.split("/");
      if (parts.length < 3) return null;
      const [m, d, y] = parts;
      return new Date(
        parseInt(y) < 100 ? 2000 + parseInt(y) : parseInt(y),
        m - 1,
        d,
      );
    };
    const esbdDaysLeft = (b) => {
      const d = parseEsbdDate(b.due_date);
      return d ? Math.round((d - today) / 86400000) : 999;
    };
    const esbdOverdue = esbdActive.filter((b) => esbdDaysLeft(b) < 0);
    const esbdDueWeek = esbdActive.filter(
      (b) => esbdDaysLeft(b) >= 0 && esbdDaysLeft(b) <= 7,
    );
    const esbdDue8to30 = esbdActive.filter(
      (b) => esbdDaysLeft(b) >= 8 && esbdDaysLeft(b) <= 30,
    );

    // ── COMBINED DEADLINE BANDS ───────────────────────────────────────────
    const allOverdue = [
      ...overdue.map((r) => ({ ...r, _lane: "DIBBS", _dl: daysLeft(r) })),
      ...esbdOverdue.map((b) => ({
        sol_number: b.sol_id,
        item_name: b.title,
        fsc: b.nigp_code,
        _lane: "ESBD",
        _dl: esbdDaysLeft(b),
        _esbd: true,
      })),
    ].sort((a, b) => a._dl - b._dl);

    const allDueWeek = [
      ...dueWeek.map((r) => ({ ...r, _lane: "DIBBS", _dl: daysLeft(r) })),
      ...esbdDueWeek.map((b) => ({
        sol_number: b.sol_id,
        item_name: b.title,
        fsc: b.nigp_code,
        _lane: "ESBD",
        _dl: esbdDaysLeft(b),
        _esbd: true,
      })),
    ].sort((a, b) => a._dl - b._dl);

    const allDue8to30 = [
      ...due8to30.map((r) => ({ ...r, _lane: "DIBBS", _dl: daysLeft(r) })),
      ...esbdDue8to30.map((b) => ({
        sol_number: b.sol_id,
        item_name: b.title,
        fsc: b.nigp_code,
        _lane: "ESBD",
        _dl: esbdDaysLeft(b),
        _esbd: true,
      })),
    ].sort((a, b) => a._dl - b._dl);

    const totalDeadlines =
      allOverdue.length + allDueWeek.length + allDue8to30.length;

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

    // Est net take-home — sum of net across all active bids with supplier quotes
    const confirmedNet = active
      .filter((r) => r.supplier_quote_price)
      .reduce((s, r) => s + rowMath(r).net, 0);
    const estimatedNet = active.reduce((s, r) => s + rowMath(r).net, 0);

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

    // ── WIN / LOSS BREAKDOWN ─────────────────────────────────────────────
    // By tier
    const tierOutcomes = {};
    rows.forEach((r) => {
      const t = r.tier || "Standard";
      if (!tierOutcomes[t])
        tierOutcomes[t] = { won: 0, lost: 0, wonNet: 0, lostNet: 0 };
      const m = rowMath(r);
      if (r.status === "Awarded") {
        tierOutcomes[t].won++;
        tierOutcomes[t].wonNet += m.net;
      }
      if (r.status === "Lost") {
        tierOutcomes[t].lost++;
        tierOutcomes[t].lostNet += m.net;
      }
    });

    // Loss reasons — pull from win_loss_reason on lost rows
    const lossReasons = {};
    rows
      .filter((r) => r.status === "Lost" && r.win_loss_reason)
      .forEach((r) => {
        const reason = r.win_loss_reason.trim().toLowerCase();
        lossReasons[reason] = (lossReasons[reason] || 0) + 1;
      });
    const topReasons = Object.entries(lossReasons)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    // Avg net on won vs lost bids
    const wonRows = rows.filter((r) => r.status === "Awarded");
    const lostRows = rows.filter((r) => r.status === "Lost");
    const avgWonNet = wonRows.length
      ? wonRows.reduce((s, r) => s + rowMath(r).net, 0) / wonRows.length
      : 0;
    const avgLostNet = lostRows.length
      ? lostRows.reduce((s, r) => s + rowMath(r).net, 0) / lostRows.length
      : 0;

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
      background: "var(--card-bg, rgba(255,255,255,.55))",
      border: "1px solid rgba(120,80,0,.18)",
      borderTop: "2px solid rgba(120,80,0,.35)",
      padding: "18px 20px",
      borderRadius: "2px",
    };
    const sectionTitle = {
      fontFamily: "Cinzel,serif",
      fontSize: "13px",
      letterSpacing: "2px",
      textTransform: "uppercase",
      color: "var(--gold-dim, rgba(201,168,76,.7))",
      marginBottom: "14px",
    };
    const kpiVal = {
      fontFamily: "JetBrains Mono,monospace",
      fontSize: "26px",
      fontWeight: 700,
    };
    const kpiLbl = {
      fontFamily: "Cinzel,serif",
      fontSize: "13px",
      letterSpacing: "1.5px",
      textTransform: "uppercase",
      color: "var(--body-faint)",
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
              fontSize: "14px",
              color: "var(--body-faint)",
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
      {
        style: {
          animation: "fadeUp .5s ease both",
          paddingBottom: "32px",
          position: "relative",
        },
      },

      // watermark handled in index.html + app.js

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
            position: "relative",
            zIndex: 1,
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
              fontSize: "13px",
              color: "var(--body-faint)",
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
            position: "relative",
            zIndex: 1,
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
                  fontSize: "13px",
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
                  fontSize: "13px",
                  color: "var(--body-faint)",
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
                fontSize: "13px",
                color: "var(--body-faint)",
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
                  fontSize: "13px",
                  color: "rgba(61,214,140,.5)",
                  fontFamily: "Cormorant Garamond,serif",
                  marginTop: "3px",
                },
              },
              awards.length + " contracts",
            ),
        ),

        // Est. Net Take-Home
        h(
          "div",
          { style: card },
          h(
            "div",
            {
              style: {
                ...kpiVal,
                fontSize: "18px",
                background: "linear-gradient(90deg,#a8f0c6,#3ddc84,#1a9e52)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              },
            },
            fmt(estimatedNet),
          ),
          h("div", { style: kpiLbl }, "Est. Net Take-Home"),
          h(
            "div",
            {
              style: {
                fontSize: "12px",
                color:
                  confirmedNet > 0
                    ? "rgba(61,214,140,.6)"
                    : "var(--body-faint)",
                fontFamily: "Cormorant Garamond,serif",
                marginTop: "3px",
              },
            },
            confirmedNet > 0
              ? fmt(confirmedNet) + " confirmed"
              : "est. — no quotes yet",
          ),
        ),
      ),

      // ── ESBD + COMBINED TOTALS ─────────────────────────────────────────
      h(
        "div",
        {
          style: {
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: "12px",
            marginBottom: "16px",
            position: "relative",
            zIndex: 1,
          },
        },

        // DIBBS Pipeline
        h(
          "div",
          { style: { ...card, borderColor: "rgba(201,168,76,.3)" } },
          h(
            "div",
            { style: { ...sectionTitle, marginBottom: "12px" } },
            "DIBBS Pipeline",
          ),
          h(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: "8px" } },
            ...[
              ["Active Bids", active.length, "#C9A84C"],
              ["Pipeline Value", fmt(pipelineValue), "#C9A84C"],
              ["Awarded", awarded.length, "#3dd68c"],
              ["Awarded Revenue", fmt(awardsRevenue), "#3dd68c"],
            ].map(([label, val, color]) =>
              h(
                "div",
                {
                  key: label,
                  style: {
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                  },
                },
                h(
                  "span",
                  {
                    style: {
                      fontFamily: "Cormorant Garamond,serif",
                      fontSize: "14px",
                      color: "var(--body-faint)",
                    },
                  },
                  label,
                ),
                h(
                  "span",
                  {
                    style: {
                      fontFamily: "Cinzel,serif",
                      fontSize: "15px",
                      color,
                      fontWeight: 600,
                    },
                  },
                  val,
                ),
              ),
            ),
          ),
        ),

        // State & Federal Pipeline
        h(
          "div",
          { style: { ...card, borderColor: "rgba(135,206,235,.3)" } },
          h(
            "div",
            {
              style: {
                ...sectionTitle,
                marginBottom: "12px",
                color: "rgba(135,206,235,.8)",
              },
            },
            "State & Federal",
          ),
          esbdBids.length === 0
            ? h(
                "div",
                {
                  style: {
                    fontFamily: "Cormorant Garamond,serif",
                    fontSize: "13px",
                    fontStyle: "italic",
                    color: "var(--body-faint)",
                    marginTop: "8px",
                  },
                },
                "No bids yet.",
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
                ...[
                  ["Active Bids", esbdActive.length, "rgba(135,206,235,.9)"],
                  [
                    "Pipeline Value",
                    fmt(esbdPipelineValue),
                    "rgba(135,206,235,.9)",
                  ],
                  ["Awarded", esbdAwarded.length, "#3dd68c"],
                  ["Awarded Value", fmt(esbdAwardedValue), "#3dd68c"],
                ].map(([label, val, color]) =>
                  h(
                    "div",
                    {
                      key: label,
                      style: {
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                      },
                    },
                    h(
                      "span",
                      {
                        style: {
                          fontFamily: "Cormorant Garamond,serif",
                          fontSize: "14px",
                          color: "var(--body-faint)",
                        },
                      },
                      label,
                    ),
                    h(
                      "span",
                      {
                        style: {
                          fontFamily: "Cinzel,serif",
                          fontSize: "15px",
                          color,
                          fontWeight: 600,
                        },
                      },
                      val,
                    ),
                  ),
                ),
              ),
        ),

        // Combined Total
        h(
          "div",
          {
            style: {
              ...card,
              borderColor: "rgba(61,214,140,.35)",
              background: "rgba(61,214,140,.04)",
            },
          },
          h(
            "div",
            {
              style: {
                ...sectionTitle,
                marginBottom: "12px",
                color: "rgba(61,214,140,.8)",
              },
            },
            "Combined Total",
          ),
          h(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: "8px" } },
            ...[
              ["Total Active", active.length + esbdActive.length, "#C9A84C"],
              [
                "Total Pipeline",
                fmt(pipelineValue + esbdPipelineValue),
                "#C9A84C",
              ],
              ["Total Awarded", awarded.length + esbdAwarded.length, "#3dd68c"],
              [
                "Total Revenue",
                fmt(awardsRevenue + esbdAwardedValue),
                "#3dd68c",
              ],
            ].map(([label, val, color]) =>
              h(
                "div",
                {
                  key: label,
                  style: {
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                  },
                },
                h(
                  "span",
                  {
                    style: {
                      fontFamily: "Cormorant Garamond,serif",
                      fontSize: "14px",
                      color: "var(--body-faint)",
                    },
                  },
                  label,
                ),
                h(
                  "span",
                  {
                    style: {
                      fontFamily: "Cinzel,serif",
                      fontSize: "15px",
                      color,
                      fontWeight: 600,
                    },
                  },
                  val,
                ),
              ),
            ),
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
            position: "relative",
            zIndex: 1,
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
                      fontSize: "14px",
                      color: "var(--body-faint)",
                      fontFamily: "Cormorant Garamond,serif",
                    },
                  },
                  label,
                ),
                h(
                  "span",
                  {
                    style: {
                      fontSize: "14px",
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
                fontSize: "13px",
                color: "var(--body-faint)",
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
                      fontSize: "14px",
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
                        fontSize: "13px",
                        color: "var(--body-faint)",
                        fontFamily: "Cormorant Garamond,serif",
                      },
                    },
                    fmt(bandValue[band.key]),
                  ),
                  h(
                    "span",
                    {
                      style: {
                        fontSize: "14px",
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
            position: "relative",
            zIndex: 1,
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
                  fontSize: "13px",
                  color: "var(--body-faint)",
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
                  fontSize: "13px",
                  color: "var(--body-faint)",
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
                  fontSize: "13px",
                  color: "var(--body-faint)",
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
                        fontSize: "14px",
                        color: "var(--body-faint)",
                        fontFamily: "Cormorant Garamond,serif",
                      },
                    },
                    sa === "Y" ? "Set-Aside (SDVOSB)" : "Unrestricted / Open",
                  ),
                  h(
                    "span",
                    {
                      style: {
                        fontSize: "14px",
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
                          color: "var(--body-faint)",
                          fontSize: "13px",
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
                        fontSize: "13px",
                        color: "var(--body-faint)",
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
                      fontSize: "13px",
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
                      fontSize: "13px",
                      color: "var(--body-faint)",
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
                      fontSize: "13px",
                      color: "var(--body-faint)",
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
                      fontSize: "13px",
                      color: "var(--body-faint)",
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
        {
          style: {
            ...card,
            marginBottom: "16px",
            position: "relative",
            zIndex: 1,
          },
        },
        h("div", { style: sectionTitle }, "FSC Lane Performance"),
        fscList.length === 0
          ? h(
              "div",
              {
                style: {
                  fontFamily: "Cormorant Garamond,serif",
                  fontStyle: "italic",
                  fontSize: "14px",
                  color: "var(--body-faint)",
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
                            fontSize: "13px",
                            letterSpacing: "1.5px",
                            textTransform: "uppercase",
                            color: "var(--body-faint)",
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
                            fontSize: "14px",
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
                            fontSize: "14px",
                            color: "var(--body-faint)",
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
                            fontSize: "14px",
                            color: "var(--body-faint)",
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
                            fontSize: "14px",
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
                            fontSize: "14px",
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
                            fontSize: "14px",
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
                            fontSize: "14px",
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
                            fontSize: "14px",
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

      // ── ROW 4.5: BID OUTCOME ─────────────────────────────────────────
      (wonRows.length > 0 || lostRows.length > 0) &&
        h(
          "div",
          {
            style: {
              ...card,
              marginBottom: "16px",
              position: "relative",
              zIndex: 1,
            },
          },
          h("div", { style: sectionTitle }, "Bid Outcomes"),

          // Top 3 stat cards
          h(
            "div",
            {
              style: {
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: "16px",
                marginBottom: "20px",
              },
            },

            h(
              "div",
              {
                style: {
                  padding: "12px 14px",
                  background: "rgba(61,214,140,.05)",
                  border: "1px solid rgba(61,214,140,.15)",
                },
              },
              h(
                "div",
                {
                  style: {
                    fontFamily: "JetBrains Mono,monospace",
                    fontSize: "20px",
                    fontWeight: 700,
                    color: "#3dd68c",
                  },
                },
                fmt(avgWonNet),
              ),
              h(
                "div",
                {
                  style: {
                    fontFamily: "Cinzel,serif",
                    fontSize: "9px",
                    letterSpacing: ".14em",
                    textTransform: "uppercase",
                    color: "rgba(61,214,140,.5)",
                    marginTop: "4px",
                  },
                },
                "Avg Net — Won · " +
                  wonRows.length +
                  " bid" +
                  (wonRows.length !== 1 ? "s" : ""),
              ),
            ),

            h(
              "div",
              {
                style: {
                  padding: "12px 14px",
                  background: "rgba(231,76,60,.04)",
                  border: "1px solid rgba(231,76,60,.15)",
                },
              },
              h(
                "div",
                {
                  style: {
                    fontFamily: "JetBrains Mono,monospace",
                    fontSize: "20px",
                    fontWeight: 700,
                    color: "#e74c3c",
                  },
                },
                fmt(avgLostNet),
              ),
              h(
                "div",
                {
                  style: {
                    fontFamily: "Cinzel,serif",
                    fontSize: "9px",
                    letterSpacing: ".14em",
                    textTransform: "uppercase",
                    color: "rgba(231,76,60,.4)",
                    marginTop: "4px",
                  },
                },
                "Avg Net — Lost · " +
                  lostRows.length +
                  " bid" +
                  (lostRows.length !== 1 ? "s" : ""),
              ),
            ),

            h(
              "div",
              {
                style: {
                  padding: "12px 14px",
                  background: "rgba(201,168,76,.04)",
                  border: "1px solid rgba(201,168,76,.12)",
                },
              },
              h(
                "div",
                {
                  style: {
                    fontFamily: "JetBrains Mono,monospace",
                    fontSize: "20px",
                    fontWeight: 700,
                    color:
                      avgWonNet >= avgLostNet
                        ? "#C9A84C"
                        : "rgba(201,168,76,.4)",
                  },
                },
                fmt(Math.abs(avgWonNet - avgLostNet)),
              ),
              h(
                "div",
                {
                  style: {
                    fontFamily: "Cinzel,serif",
                    fontSize: "9px",
                    letterSpacing: ".14em",
                    textTransform: "uppercase",
                    color: "var(--gold-dim)",
                    marginTop: "4px",
                  },
                },
                avgWonNet >= avgLostNet
                  ? "Won bids avg higher"
                  : "Lost bids avg higher",
              ),
            ),
          ),

          // Two-column: tier breakdown + loss reasons
          h(
            "div",
            {
              style: {
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "16px",
              },
            },

            // By Tier
            h(
              "div",
              null,
              h(
                "div",
                {
                  style: {
                    fontFamily: "Cinzel,serif",
                    fontSize: "9px",
                    letterSpacing: ".14em",
                    textTransform: "uppercase",
                    color: "var(--gold-dim)",
                    marginBottom: "10px",
                  },
                },
                "By Tier",
              ),
              h(
                "div",
                {
                  style: {
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                  },
                },
                ...Object.entries(tierOutcomes).map(([tier, data]) => {
                  const total = data.won + data.lost;
                  const rate = total > 0 ? data.won / total : 0;
                  const tierClr = tier.includes("Hanging")
                    ? "#C9A84C"
                    : tier.includes("Fast")
                      ? "#f0c040"
                      : "#7eb8f7";
                  return h(
                    "div",
                    {
                      key: tier,
                      style: {
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "7px 10px",
                        background: "rgba(120,80,0,.03)",
                        borderLeft: "2px solid " + tierClr,
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
                            fontSize: "12px",
                            color: tierClr,
                            letterSpacing: ".04em",
                          },
                        },
                        tier,
                      ),
                      h(
                        "div",
                        {
                          style: {
                            fontFamily: "JetBrains Mono,monospace",
                            fontSize: "11px",
                            color: "var(--body-faint)",
                            marginTop: "2px",
                          },
                        },
                        data.won + "W · " + data.lost + "L",
                      ),
                    ),
                    h(
                      "div",
                      {
                        style: {
                          fontFamily: "JetBrains Mono,monospace",
                          fontSize: "16px",
                          fontWeight: 700,
                          color:
                            rate >= 0.5
                              ? "#3dd68c"
                              : rate > 0
                                ? "#f0c040"
                                : "rgba(245,240,232,.3)",
                        },
                      },
                      total > 0 ? Math.round(rate * 100) + "%" : "—",
                    ),
                  );
                }),
              ),
            ),

            // Loss Reasons
            h(
              "div",
              null,
              h(
                "div",
                {
                  style: {
                    fontFamily: "Cinzel,serif",
                    fontSize: "9px",
                    letterSpacing: ".14em",
                    textTransform: "uppercase",
                    color: "var(--gold-dim)",
                    marginBottom: "10px",
                  },
                },
                "Loss Reasons",
              ),
              topReasons.length === 0
                ? h(
                    "div",
                    {
                      style: {
                        fontFamily: "Cormorant Garamond,serif",
                        fontStyle: "italic",
                        fontSize: "13px",
                        color: "var(--body-faint)",
                      },
                    },
                    lostRows.length === 0
                      ? "No losses recorded yet."
                      : "No loss reasons logged — add them in the pipeline drawer.",
                  )
                : h(
                    "div",
                    {
                      style: {
                        display: "flex",
                        flexDirection: "column",
                        gap: "5px",
                      },
                    },
                    ...topReasons.map(([reason, count]) =>
                      h(
                        "div",
                        {
                          key: reason,
                          style: {
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: "6px 10px",
                            background: "rgba(231,76,60,.04)",
                            borderLeft: "2px solid rgba(231,76,60,.3)",
                          },
                        },
                        h(
                          "span",
                          {
                            style: {
                              fontFamily: "Cormorant Garamond,serif",
                              fontSize: "13px",
                              color: "var(--body-dim)",
                              textTransform: "capitalize",
                            },
                          },
                          reason,
                        ),
                        h(
                          "span",
                          {
                            style: {
                              fontFamily: "JetBrains Mono,monospace",
                              fontSize: "13px",
                              fontWeight: 700,
                              color: "#e74c3c",
                            },
                          },
                          "x" + count,
                        ),
                      ),
                    ),
                  ),
            ),
          ),
        ),

      // ── ROW 5: 30-DAY DEADLINE VIEW ──────────────────────────────────
      totalDeadlines > 0 &&
        h(
          "div",
          { style: { ...card, position: "relative", zIndex: 1 } },
          h(
            "div",
            { style: { ...sectionTitle, marginBottom: "16px" } },
            "Upcoming Deadlines · " +
              totalDeadlines +
              " solicitation" +
              (totalDeadlines !== 1 ? "s" : ""),
          ),

          // ── Deadline row renderer ──
          (() => {
            const DeadlineRow = (r) => {
              const dl = r._dl;
              const isOverdue = dl < 0;
              const clr = isOverdue
                ? "#e74c3c"
                : dl === 0
                  ? "#e74c3c"
                  : dl <= 2
                    ? "#f0c040"
                    : dl <= 7
                      ? "rgba(245,240,232,.75)"
                      : "rgba(201,168,76,.45)";
              const lbl = isOverdue
                ? Math.abs(dl) + "d ago"
                : dl === 0
                  ? "TODAY"
                  : dl === 1
                    ? "TOMORROW"
                    : dl + "d";
              const isEsbd = r._esbd;
              return h(
                "div",
                {
                  key: r.sol_number,
                  onClick: () =>
                    !isEsbd && goPipeline && goPipeline(r.sol_number),
                  style: {
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 12px",
                    background: isOverdue
                      ? "rgba(231,76,60,.04)"
                      : "rgba(120,80,0,.03)",
                    borderLeft: "2px solid " + clr,
                    cursor: isEsbd ? "default" : "pointer",
                    transition: "background .15s",
                    marginBottom: "4px",
                  },
                  onMouseEnter: (e) => {
                    if (!isEsbd)
                      e.currentTarget.style.background = "rgba(201,168,76,.06)";
                  },
                  onMouseLeave: (e) => {
                    e.currentTarget.style.background = isOverdue
                      ? "rgba(231,76,60,.04)"
                      : "rgba(120,80,0,.03)";
                  },
                },
                h(
                  "div",
                  null,
                  h(
                    "div",
                    {
                      style: {
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      },
                    },
                    h(
                      "span",
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
                      "span",
                      {
                        style: {
                          fontFamily: "Cinzel,serif",
                          fontSize: "8px",
                          letterSpacing: ".1em",
                          padding: "2px 6px",
                          border:
                            "1px solid " +
                            (isEsbd
                              ? "rgba(135,206,235,.3)"
                              : "rgba(201,168,76,.25)"),
                          color: isEsbd
                            ? "rgba(135,206,235,.8)"
                            : "rgba(201,168,76,.6)",
                          background: isEsbd
                            ? "rgba(135,206,235,.06)"
                            : "rgba(201,168,76,.04)",
                        },
                      },
                      r._lane,
                    ),
                  ),
                  h(
                    "div",
                    {
                      style: {
                        fontFamily: "Cormorant Garamond,serif",
                        fontSize: "13px",
                        color: "var(--body-faint)",
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
                      display: "flex",
                      gap: "16px",
                      alignItems: "center",
                    },
                  },
                  r.fsc &&
                    h(
                      "span",
                      {
                        style: {
                          fontFamily: "Cormorant Garamond,serif",
                          fontSize: "13px",
                          color: "var(--body-faint)",
                        },
                      },
                      r.fsc,
                    ),
                  h(
                    "span",
                    {
                      style: {
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "13px",
                        fontWeight: 700,
                        color: clr,
                        minWidth: "70px",
                        textAlign: "right",
                      },
                    },
                    lbl,
                  ),
                ),
              );
            };

            return h(
              "div",
              null,

              // Overdue band
              allOverdue.length > 0 &&
                h(
                  "div",
                  null,
                  h(
                    "div",
                    {
                      style: {
                        fontFamily: "Cinzel,serif",
                        fontSize: "9px",
                        letterSpacing: ".16em",
                        color: "#e74c3c",
                        textTransform: "uppercase",
                        marginBottom: "6px",
                        marginTop: "4px",
                      },
                    },
                    "▲ Overdue — " + allOverdue.length,
                  ),
                  ...allOverdue.map(DeadlineRow),
                ),

              // Due 0-7 days band
              allDueWeek.length > 0 &&
                h(
                  "div",
                  {
                    style: { marginTop: allOverdue.length > 0 ? "14px" : "0" },
                  },
                  h(
                    "div",
                    {
                      style: {
                        fontFamily: "Cinzel,serif",
                        fontSize: "9px",
                        letterSpacing: ".16em",
                        color: "#f0c040",
                        textTransform: "uppercase",
                        marginBottom: "6px",
                      },
                    },
                    "◆ Due This Week — " + allDueWeek.length,
                  ),
                  ...allDueWeek.map(DeadlineRow),
                ),

              // Due 8-30 days band
              allDue8to30.length > 0 &&
                h(
                  "div",
                  {
                    style: {
                      marginTop:
                        allOverdue.length > 0 || allDueWeek.length > 0
                          ? "14px"
                          : "0",
                    },
                  },
                  h(
                    "div",
                    {
                      style: {
                        fontFamily: "Cinzel,serif",
                        fontSize: "9px",
                        letterSpacing: ".16em",
                        color: "rgba(201,168,76,.5)",
                        textTransform: "uppercase",
                        marginBottom: "6px",
                      },
                    },
                    "◇ Next 30 Days — " + allDue8to30.length,
                  ),
                  ...allDue8to30.map(DeadlineRow),
                ),
            );
          })(),
        ),
    );
  }

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.DashboardTab = DashboardTab;
})();
