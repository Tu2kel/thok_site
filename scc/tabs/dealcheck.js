(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — DEAL CHECKER TAB v2
  //  5-zone DLA thresholds · Factoring Express fee model · Self-funded mode
  //  Pre-compiled React · No Babel · No JSX
  //  Exposes: window.SCC_TABS.DealCheckTab
  //  Load order: after bidmath.js, before app.js
  // ═══════════════════════════════════════════════════════════════════════

  const { createElement: h, useState, useEffect, useRef } = React;

  // ── 5-ZONE DLA THRESHOLDS (SSC path) ────────────────────────────────────
  const ZONES = [
    {
      key: "dead",
      label: "DEAD DEAL",
      icon: "✕",
      min: 0,
      max: 0.1,
      color: "#e74c3c",
      glow: "rgba(231,76,60,.35)",
    },
    {
      key: "thin",
      label: "THIN",
      icon: "▽",
      min: 0.1,
      max: 0.2,
      color: "#e8874f",
      glow: "rgba(232,135,79,.30)",
    },
    {
      key: "stretch",
      label: "STRETCH",
      icon: "⚠",
      min: 0.2,
      max: 0.3,
      color: "#f0c040",
      glow: "rgba(240,192,64,.30)",
    },
    {
      key: "go",
      label: "GO",
      icon: "✓",
      min: 0.3,
      max: 0.45,
      color: "#3dd68c",
      glow: "rgba(61,214,140,.35)",
    },
    {
      key: "premium",
      label: "PREMIUM",
      icon: "★",
      min: 0.45,
      max: 1.01,
      color: "#C9A84C",
      glow: "rgba(201,168,76,.40)",
    },
  ];

  // Self-funded thresholds (no SSC overhead)
  const ZONES_SELF = [
    {
      key: "dead",
      label: "DEAD DEAL",
      icon: "✕",
      min: 0,
      max: 0.05,
      color: "#e74c3c",
      glow: "rgba(231,76,60,.35)",
    },
    {
      key: "thin",
      label: "THIN",
      icon: "▽",
      min: 0.05,
      max: 0.12,
      color: "#e8874f",
      glow: "rgba(232,135,79,.30)",
    },
    {
      key: "stretch",
      label: "STRETCH",
      icon: "⚠",
      min: 0.12,
      max: 0.2,
      color: "#f0c040",
      glow: "rgba(240,192,64,.30)",
    },
    {
      key: "go",
      label: "GO",
      icon: "✓",
      min: 0.2,
      max: 0.35,
      color: "#3dd68c",
      glow: "rgba(61,214,140,.35)",
    },
    {
      key: "premium",
      label: "PREMIUM",
      icon: "★",
      min: 0.35,
      max: 1.01,
      color: "#C9A84C",
      glow: "rgba(201,168,76,.40)",
    },
  ];

  function getZone(gpPct, selfFunded) {
    if (gpPct === null || isNaN(gpPct)) return null;
    const zones = selfFunded ? ZONES_SELF : ZONES;
    return (
      zones.find((z) => gpPct >= z.min && gpPct < z.max) ||
      zones[zones.length - 1]
    );
  }

  const PAY_DAYS = [
    { label: "20d · best", val: 20, feePct: 1.67 },
    { label: "30d · typical", val: 30, feePct: 2.503 },
    { label: "45d · common", val: 45, feePct: 4.169 },
    { label: "60d · worst", val: 60, feePct: 5.002 },
  ];

  const fmtPct = (n) => (n * 100).toFixed(1) + "%";
  const fmtDol = (n) =>
    "$" +
    parseFloat(n).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const parseDol = (s) =>
    parseFloat((s || "").toString().replace(/[$,]/g, "")) || 0;

  function DealCheckTab() {
    const { dbGetAll } = window.SCC_DB;
    const { calcFEFees, fmt, FE } = window.SCC_MATH;

    const [solInput, setSolInput] = useState("");
    const [suggestions, setSuggestions] = useState([]);
    const [showDrop, setShowDrop] = useState(false);
    const [record, setRecord] = useState(null);
    const [allRows, setAllRows] = useState([]);
    const dropRef = useRef(null);

    const [vendorUnit, setVendorUnit] = useState("");
    const [bidUnit, setBidUnit] = useState("");
    const [qty, setQty] = useState("1");
    const [shipping, setShipping] = useState("0");

    const [selfFunded, setSelfFunded] = useState(false);
    const [usePO, setUsePO] = useState(true);
    const [payDay, setPayDay] = useState(60);

    useEffect(() => {
      dbGetAll().then((r) => setAllRows(r || []));
    }, []);

    useEffect(() => {
      const handler = (e) => {
        if (dropRef.current && !dropRef.current.contains(e.target))
          setShowDrop(false);
      };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }, []);

    const onSolType = (val) => {
      setSolInput(val);
      setRecord(null);
      if (!val.trim()) {
        setSuggestions([]);
        setShowDrop(false);
        return;
      }
      const q = val.toUpperCase();
      const hits = allRows
        .filter(
          (r) =>
            (r.sol_number || "").toUpperCase().includes(q) ||
            (r.nsn || "").includes(q) ||
            (r.item_name || "").toUpperCase().includes(q),
        )
        .slice(0, 8);
      setSuggestions(hits);
      setShowDrop(hits.length > 0);
    };

    const selectRecord = (row) => {
      setRecord(row);
      setSolInput(row.sol_number);
      setShowDrop(false);
      if (row.quantity) setQty(String(row.quantity));
      if (row.bid_price) setBidUnit(String(row.bid_price));
      else if (row.unit_price) setBidUnit(String(row.unit_price));
      const ext =
        parseFloat(row.extended_price) ||
        parseFloat(row.unit_price || 0) * parseFloat(row.quantity || 1);
      if (ext && ext <= 10000) setSelfFunded(true);
    };

    const vCost = parseDol(vendorUnit);
    const vBid = parseDol(bidUnit);
    const vQty = parseFloat(qty) || 1;
    const vShip = parseDol(shipping);

    let result = null,
      zone = null,
      feDetail = null;

    if (vCost > 0 && vBid > 0) {
      const cogs = vCost * vQty + vShip;
      const gross = vBid * vQty;
      const gp = gross - cogs;
      const gpPct = gross > 0 ? gp / gross : 0;
      let dedAmt = 0;
      if (!selfFunded) {
        feDetail = calcFEFees(gross, payDay, usePO);
        dedAmt = feDetail.totalFee;
      }
      const net = gp - dedAmt;
      const netPct = gross > 0 ? net / gross : 0;
      result = { cogs, gross, gp, gpPct, dedAmt, net, netPct };
      zone = getZone(gpPct, selfFunded);
    }

    const lbl = {
      fontFamily: "Cinzel,serif",
      fontSize: "10px",
      letterSpacing: "1.5px",
      textTransform: "uppercase",
      color: "rgba(201,168,76,.6)",
      marginBottom: "5px",
    };

    const Toggle = ({ on, onToggle, goldWhenOn }) =>
      h(
        "div",
        {
          onClick: onToggle,
          style: {
            width: goldWhenOn ? "28px" : "36px",
            height: goldWhenOn ? "16px" : "20px",
            borderRadius: "10px",
            background: on
              ? goldWhenOn
                ? "#C9A84C"
                : "#3dd68c"
              : "rgba(245,240,232,.15)",
            position: "relative",
            transition: "background .2s",
            flexShrink: 0,
            cursor: "pointer",
          },
        },
        h("div", {
          style: {
            position: "absolute",
            top: goldWhenOn ? "2px" : "3px",
            left: on ? (goldWhenOn ? "14px" : "18px") : "2px",
            width: goldWhenOn ? "12px" : "14px",
            height: goldWhenOn ? "12px" : "14px",
            borderRadius: "50%",
            background: "#fff",
            transition: "left .2s",
            boxShadow: "0 1px 3px rgba(0,0,0,.4)",
          },
        }),
      );

    return h(
      "div",
      { style: { animation: "fadeUp .4s ease both", padding: "0 4px" } },

      h(
        "div",
        { className: "section-header" },
        h("div", { className: "section-title gold-text" }, "◈ Deal Checker"),
        h(
          "div",
          {
            style: {
              fontSize: "12px",
              color: "rgba(245,240,232,.4)",
              fontFamily: "Cormorant Garamond,serif",
              marginTop: "2px",
            },
          },
          "Factoring Express · worst-case 7.5% SSC · 5-zone DLA verdict",
        ),
      ),

      h(
        "div",
        {
          style: {
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "18px",
            marginTop: "18px",
          },
        },

        // LEFT
        h(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: "14px" } },

          // SOL
          h(
            "div",
            { className: "card", style: { padding: "16px" } },
            h("div", { style: lbl }, "SOL Lookup (optional)"),
            h(
              "div",
              { style: { position: "relative" }, ref: dropRef },
              h("input", {
                value: solInput,
                onChange: (e) => onSolType(e.target.value),
                onFocus: () => suggestions.length > 0 && setShowDrop(true),
                placeholder: "SOL number, NSN, or item name…",
                style: { width: "100%", boxSizing: "border-box" },
              }),
              showDrop &&
                h(
                  "div",
                  {
                    style: {
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      right: 0,
                      zIndex: 200,
                      background:
                        "linear-gradient(160deg,#2e2b32 0%,#1a1820 18%,#0e0d10 40%,#111012 100%)",
                      border: "1px solid rgba(201,168,76,.3)",
                      borderRadius: "6px",
                      marginTop: "2px",
                      maxHeight: "220px",
                      overflowY: "auto",
                    },
                  },
                  suggestions.map((row) =>
                    h(
                      "div",
                      {
                        key: row.sol_number,
                        onClick: () => selectRecord(row),
                        style: {
                          padding: "9px 12px",
                          cursor: "pointer",
                          borderBottom: "1px solid rgba(201,168,76,.1)",
                          display: "flex",
                          justifyContent: "space-between",
                        },
                        onMouseEnter: (e) =>
                          (e.currentTarget.style.background =
                            "rgba(201,168,76,.07)"),
                        onMouseLeave: (e) =>
                          (e.currentTarget.style.background = "transparent"),
                      },
                      h(
                        "span",
                        {
                          style: {
                            color: "#C9A84C",
                            fontSize: "12px",
                            fontFamily: "Cinzel,serif",
                          },
                        },
                        row.sol_number,
                      ),
                      h(
                        "span",
                        {
                          style: {
                            color: "rgba(245,240,232,.5)",
                            fontSize: "11px",
                            maxWidth: "160px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          },
                        },
                        row.item_name || row.nsn || "",
                      ),
                    ),
                  ),
                ),
            ),
            record &&
              h(
                "div",
                {
                  style: {
                    marginTop: "10px",
                    padding: "10px 12px",
                    borderRadius: "6px",
                    background: "rgba(201,168,76,.06)",
                    border: "1px solid rgba(201,168,76,.2)",
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "5px 16px",
                  },
                },
                ...[
                  ["NSN", record.nsn],
                  ["Item", record.item_name],
                  [
                    "Qty",
                    record.quantity
                      ? record.quantity + " " + (record.unit_of_issue || "")
                      : null,
                  ],
                  ["Ref", record.unit_price ? fmt(record.unit_price) : null],
                  ["Due", record.quote_due],
                  ["Tier", record.tier],
                ]
                  .filter(([, v]) => v)
                  .map(([l, v]) =>
                    h(
                      "div",
                      { key: l },
                      h(
                        "div",
                        {
                          style: {
                            fontSize: "9px",
                            color: "rgba(201,168,76,.5)",
                            fontFamily: "Cinzel,serif",
                            letterSpacing: "1px",
                            textTransform: "uppercase",
                          },
                        },
                        l,
                      ),
                      h(
                        "div",
                        {
                          style: {
                            fontSize: "12px",
                            color: "#F5F0E8",
                            marginTop: "1px",
                          },
                        },
                        v,
                      ),
                    ),
                  ),
              ),
          ),

          // Pricing
          h(
            "div",
            { className: "card", style: { padding: "16px" } },
            h("div", { style: lbl }, "Pricing"),
            h(
              "div",
              {
                style: {
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "10px",
                },
              },
              ...[
                ["Vendor Unit Cost", vendorUnit, setVendorUnit, "0.00"],
                ["Your Bid Price", bidUnit, setBidUnit, "0.00"],
                ["Quantity", qty, setQty, "1"],
                ["Shipping Est.", shipping, setShipping, "0.00"],
              ].map(([label, val, setter, ph]) =>
                h(
                  "div",
                  {
                    key: label,
                    className: "input-group",
                    style: { margin: 0 },
                  },
                  h("div", { className: "lbl" }, label),
                  h("input", {
                    type: "number",
                    step: "0.01",
                    min: "0",
                    value: val,
                    onChange: (e) => setter(e.target.value),
                    placeholder: ph,
                  }),
                ),
              ),
            ),
          ),

          // Funding
          h(
            "div",
            { className: "card", style: { padding: "16px" } },
            h("div", { style: lbl }, "Funding Mode"),

            // Self-funded row
            h(
              "div",
              {
                onClick: () => setSelfFunded((s) => !s),
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  marginBottom: "12px",
                  padding: "10px 12px",
                  background: selfFunded
                    ? "rgba(61,214,140,.08)"
                    : "rgba(245,240,232,.04)",
                  border:
                    "1px solid " +
                    (selfFunded
                      ? "rgba(61,214,140,.3)"
                      : "rgba(245,240,232,.1)"),
                  borderRadius: "6px",
                  cursor: "pointer",
                },
              },
              h(Toggle, {
                on: selfFunded,
                onToggle: () => {},
                goldWhenOn: false,
              }),
              h(
                "div",
                null,
                h(
                  "div",
                  {
                    style: {
                      fontSize: "12px",
                      color: selfFunded ? "#3dd68c" : "#F5F0E8",
                      fontFamily: "Cinzel,serif",
                      letterSpacing: "1px",
                    },
                  },
                  "Self-Funded",
                ),
                h(
                  "div",
                  {
                    style: {
                      fontSize: "11px",
                      color: "rgba(245,240,232,.4)",
                      fontFamily: "Cormorant Garamond,serif",
                    },
                  },
                  "$10K and under · No SSC fees",
                ),
              ),
            ),

            !selfFunded &&
              h(
                "div",
                {
                  style: {
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  },
                },

                // PO toggle
                h(
                  "div",
                  {
                    onClick: () => setUsePO((p) => !p),
                    style: {
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "8px 12px",
                      background: usePO
                        ? "rgba(201,168,76,.06)"
                        : "rgba(245,240,232,.04)",
                      border:
                        "1px solid " +
                        (usePO
                          ? "rgba(201,168,76,.25)"
                          : "rgba(245,240,232,.08)"),
                      borderRadius: "6px",
                      cursor: "pointer",
                    },
                  },
                  h(Toggle, {
                    on: usePO,
                    onToggle: () => {},
                    goldWhenOn: true,
                  }),
                  h(
                    "div",
                    null,
                    h(
                      "div",
                      {
                        style: {
                          fontSize: "11px",
                          color: usePO ? "#C9A84C" : "rgba(245,240,232,.5)",
                          fontFamily: "Cinzel,serif",
                          letterSpacing: "1px",
                        },
                      },
                      "PO Funding  (+2.50%)",
                    ),
                    h(
                      "div",
                      {
                        style: {
                          fontSize: "11px",
                          color: "rgba(245,240,232,.35)",
                          fontFamily: "Cormorant Garamond,serif",
                        },
                      },
                      "FE advance before delivery",
                    ),
                  ),
                ),

                // Pay day buttons
                h(
                  "div",
                  null,
                  h(
                    "div",
                    { style: { ...lbl, marginBottom: "6px" } },
                    "Expected DLA Payment Day",
                  ),
                  h(
                    "div",
                    {
                      style: {
                        display: "grid",
                        gridTemplateColumns: "repeat(4,1fr)",
                        gap: "6px",
                      },
                    },
                    PAY_DAYS.map((pd) =>
                      h(
                        "button",
                        {
                          key: pd.val,
                          onClick: () => setPayDay(pd.val),
                          style: {
                            padding: "7px 4px",
                            fontSize: "10px",
                            fontFamily: "Cinzel,serif",
                            letterSpacing: ".5px",
                            cursor: "pointer",
                            borderRadius: "4px",
                            border:
                              "1px solid " +
                              (payDay === pd.val
                                ? "rgba(201,168,76,.6)"
                                : "rgba(245,240,232,.1)"),
                            background:
                              payDay === pd.val
                                ? "rgba(201,168,76,.12)"
                                : "rgba(245,240,232,.03)",
                            color:
                              payDay === pd.val
                                ? "#C9A84C"
                                : "rgba(245,240,232,.45)",
                            transition: "all .15s",
                          },
                        },
                        h("div", null, pd.label),
                        h(
                          "div",
                          {
                            style: {
                              fontSize: "9px",
                              marginTop: "2px",
                              color:
                                payDay === pd.val
                                  ? "#f0c040"
                                  : "rgba(245,240,232,.3)",
                            },
                          },
                          pd.feePct.toFixed(2) + "%",
                        ),
                      ),
                    ),
                  ),
                  h(
                    "div",
                    {
                      style: {
                        marginTop: "5px",
                        fontSize: "11px",
                        color: "rgba(245,240,232,.3)",
                        fontFamily: "Cormorant Garamond,serif",
                      },
                    },
                    usePO
                      ? "Day 60: 5.00% factor + 2.50% PO = 7.50% combined"
                      : "Day 60: 5.00% factoring only · no PO fee",
                  ),
                ),
              ),

            selfFunded &&
              h(
                "div",
                {
                  style: {
                    fontSize: "11px",
                    color: "rgba(61,214,140,.6)",
                    fontFamily: "Cormorant Garamond,serif",
                    fontStyle: "italic",
                  },
                },
                "All SSC fees zeroed · net = gross profit · relaxed thresholds active",
              ),
          ),
        ),

        // RIGHT
        h(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: "14px" } },

          // Verdict
          h(
            "div",
            {
              className: "card",
              style: {
                padding: "28px 20px",
                minHeight: "220px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
                overflow: "hidden",
                borderColor: zone ? zone.color + "55" : "rgba(201,168,76,.15)",
                boxShadow: zone
                  ? "0 0 32px " + zone.glow + ", inset 0 0 24px " + zone.glow
                  : "none",
                transition: "all .35s ease",
              },
            },
            zone &&
              h("div", {
                style: {
                  position: "absolute",
                  inset: 0,
                  pointerEvents: "none",
                  opacity: 0.07,
                  background:
                    "radial-gradient(ellipse at 50% 40%," +
                    zone.color +
                    " 0%,transparent 70%)",
                },
              }),

            !result
              ? h(
                  "div",
                  {
                    style: {
                      textAlign: "center",
                      color: "rgba(245,240,232,.3)",
                      fontFamily: "Cormorant Garamond,serif",
                      fontSize: "15px",
                    },
                  },
                  "Enter vendor cost and bid price",
                  h("br"),
                  "to see your verdict",
                )
              : h(
                  React.Fragment,
                  null,
                  h(
                    "div",
                    {
                      style: {
                        fontSize: "52px",
                        lineHeight: 1,
                        marginBottom: "6px",
                        color: zone.color,
                        filter: "drop-shadow(0 0 12px " + zone.color + "88)",
                        transition: "all .3s",
                      },
                    },
                    zone.icon,
                  ),
                  h(
                    "div",
                    {
                      style: {
                        fontSize: "20px",
                        fontFamily: "Cinzel,serif",
                        letterSpacing: "3px",
                        color: zone.color,
                        textShadow: "0 0 16px " + zone.color,
                        marginBottom: "10px",
                      },
                    },
                    zone.label,
                  ),
                  h(
                    "div",
                    {
                      style: {
                        fontSize: "44px",
                        fontFamily: "Cinzel,serif",
                        fontWeight: 700,
                        color: zone.color,
                        lineHeight: 1,
                        marginBottom: "2px",
                      },
                    },
                    fmtPct(result.gpPct),
                  ),
                  h(
                    "div",
                    {
                      style: {
                        fontSize: "10px",
                        color: "rgba(245,240,232,.4)",
                        letterSpacing: "2px",
                        fontFamily: "Cinzel,serif",
                        textTransform: "uppercase",
                        marginBottom: "14px",
                      },
                    },
                    "Gross Margin",
                  ),

                  // Gauge
                  h(
                    "div",
                    {
                      style: {
                        width: "100%",
                        marginBottom: "4px",
                        position: "relative",
                      },
                    },
                    h(
                      "div",
                      {
                        style: {
                          width: "100%",
                          height: "8px",
                          borderRadius: "4px",
                          overflow: "hidden",
                          display: "flex",
                        },
                      },
                      ...(selfFunded ? ZONES_SELF : ZONES).map((z) =>
                        h("div", {
                          key: z.key,
                          style: {
                            flex: z.max - z.min,
                            background: z.color,
                            opacity: 0.55,
                          },
                        }),
                      ),
                    ),
                    h("div", {
                      style: {
                        position: "absolute",
                        top: "-4px",
                        left:
                          Math.min(Math.max(result.gpPct * 100, 0), 100) + "%",
                        transform: "translateX(-50%)",
                        width: "3px",
                        height: "16px",
                        background: "#fff",
                        borderRadius: "2px",
                        boxShadow: "0 0 6px rgba(255,255,255,.9)",
                        transition: "left .4s ease",
                      },
                    }),
                  ),
                  h(
                    "div",
                    {
                      style: {
                        width: "100%",
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: "8px",
                        color: "rgba(245,240,232,.3)",
                        fontFamily: "Cinzel,serif",
                        letterSpacing: "1px",
                        marginBottom: "4px",
                      },
                    },
                    ...(selfFunded ? ZONES_SELF : ZONES).map((z) =>
                      h(
                        "span",
                        { key: z.key, style: { color: z.color + "99" } },
                        (z.min * 100).toFixed(0) + "%",
                      ),
                    ),
                    h("span", null, "100%"),
                  ),
                  selfFunded &&
                    h(
                      "div",
                      {
                        style: {
                          marginTop: "6px",
                          padding: "3px 10px",
                          background: "rgba(61,214,140,.1)",
                          border: "1px solid rgba(61,214,140,.3)",
                          borderRadius: "12px",
                          fontSize: "10px",
                          color: "#3dd68c",
                          fontFamily: "Cinzel,serif",
                          letterSpacing: "1px",
                        },
                      },
                      "SELF-FUNDED · NO SSC FEES",
                    ),
                ),
          ),

          // Breakdown
          result &&
            h(
              "div",
              { className: "card", style: { padding: "16px" } },
              h("div", { style: lbl }, "Breakdown"),
              h(
                "div",
                {
                  style: {
                    display: "flex",
                    flexDirection: "column",
                    gap: "5px",
                  },
                },
                ...[
                  ["Bid Total", fmtDol(result.gross), "#C9A84C"],
                  ["COGS + Ship", fmtDol(result.cogs), "rgba(245,240,232,.65)"],
                  [
                    "Gross Profit",
                    fmtDol(result.gp),
                    result.gp >= 0 ? "#3dd68c" : "#e74c3c",
                  ],
                  [
                    "Gross Margin",
                    fmtPct(result.gpPct),
                    zone ? zone.color : "#C9A84C",
                  ],
                  ...(!selfFunded && feDetail
                    ? [
                        [
                          "Factor Fee (" + feDetail.payDay + "d)",
                          fmtDol(feDetail.factorFee),
                          "rgba(245,240,232,.45)",
                        ],
                        ...(usePO
                          ? [
                              [
                                "PO Funding Fee",
                                fmtDol(feDetail.poFee),
                                "rgba(245,240,232,.45)",
                              ],
                            ]
                          : []),
                        [
                          "Total SSC",
                          "−" + fmtDol(feDetail.totalFee),
                          "#e8874f",
                        ],
                      ]
                    : []),
                  [
                    "Net Profit",
                    fmtDol(result.net),
                    result.net >= 0 ? "#3dd68c" : "#e74c3c",
                  ],
                  [
                    "Net Margin",
                    fmtPct(result.netPct),
                    result.netPct >= 0.3
                      ? "#3dd68c"
                      : result.netPct >= 0.15
                        ? "#f0c040"
                        : "#e74c3c",
                  ],
                ].map(([l, v, c]) =>
                  h(
                    "div",
                    {
                      key: l,
                      style: {
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "4px 0",
                        borderBottom: "1px solid rgba(201,168,76,.07)",
                      },
                    },
                    h(
                      "span",
                      {
                        style: {
                          fontSize: "11px",
                          color: "rgba(245,240,232,.45)",
                          fontFamily: "Cinzel,serif",
                          letterSpacing: "1px",
                          textTransform: "uppercase",
                        },
                      },
                      l,
                    ),
                    h(
                      "span",
                      {
                        style: {
                          fontSize: "13px",
                          color: c,
                          fontFamily: "Cinzel,serif",
                          fontWeight: 600,
                        },
                      },
                      v,
                    ),
                  ),
                ),
                !selfFunded &&
                  feDetail &&
                  h(
                    "div",
                    {
                      style: {
                        marginTop: "8px",
                        padding: "8px 10px",
                        background: "rgba(201,168,76,.05)",
                        border: "1px solid rgba(201,168,76,.15)",
                        borderRadius: "4px",
                      },
                    },
                    h(
                      "div",
                      {
                        style: {
                          fontSize: "10px",
                          color: "rgba(201,168,76,.6)",
                          fontFamily: "Cinzel,serif",
                          letterSpacing: "1px",
                          marginBottom: "4px",
                        },
                      },
                      "FE ADVANCE SCHEDULE",
                    ),
                    ...[
                      [
                        "80% advance at funding",
                        fmtDol(feDetail.advanceAmt),
                        "#C9A84C",
                      ],
                      [
                        "20% reserve (after pay)",
                        fmtDol(feDetail.reserveAmt),
                        "rgba(245,240,232,.5)",
                      ],
                    ].map(([l, v, c]) =>
                      h(
                        "div",
                        {
                          key: l,
                          style: {
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: "12px",
                            marginTop: "2px",
                          },
                        },
                        h(
                          "span",
                          {
                            style: {
                              color: "rgba(245,240,232,.5)",
                              fontFamily: "Cormorant Garamond,serif",
                            },
                          },
                          l,
                        ),
                        h(
                          "span",
                          { style: { color: c, fontFamily: "Cinzel,serif" } },
                          v,
                        ),
                      ),
                    ),
                  ),
              ),
            ),

          // Cost ceilings
          vBid > 0 &&
            h(
              "div",
              { className: "card", style: { padding: "14px 16px" } },
              h("div", { style: lbl }, "Max Vendor Cost to Hit Zone"),
              h(
                "div",
                {
                  style: {
                    display: "flex",
                    flexDirection: "column",
                    gap: "5px",
                  },
                },
                ...(selfFunded ? ZONES_SELF : ZONES)
                  .filter((z) => z.key !== "dead")
                  .map((z) =>
                    h(
                      "div",
                      {
                        key: z.key,
                        style: {
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        },
                      },
                      h(
                        "span",
                        {
                          style: {
                            fontSize: "11px",
                            color: z.color,
                            fontFamily: "Cinzel,serif",
                            letterSpacing: ".5px",
                          },
                        },
                        z.label + " (" + (z.min * 100).toFixed(0) + "%+)",
                      ),
                      h(
                        "span",
                        {
                          style: {
                            fontSize: "13px",
                            color: "#C9A84C",
                            fontFamily: "Cinzel,serif",
                          },
                        },
                        fmtDol(vBid * (1 - z.min)),
                      ),
                    ),
                  ),
              ),
            ),
        ),
      ),
    );
  }

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.DealCheckTab = DealCheckTab;
})();
