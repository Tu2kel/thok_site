(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — INTAKE TAB + PRICING PANEL
  //  Pre-compiled React · No Babel · No JSX
  // ═══════════════════════════════════════════════════════════════════════

  const { createElement: h, useState: useIntakeState, Fragment } = React;

  // ── BAA COO REFERENCE MODAL ──────────────────────────────────────────
  const BAA_NON_QUAL = window.SCC_CONSTANTS.BAA_NON_QUAL;
  const BAA_QUAL     = window.SCC_CONSTANTS.BAA_QUAL;

  function BAAModal() {
    const [open, setOpen] = useIntakeState(false);
    const btn = {
      padding: "6px 14px",
      fontFamily: "Cinzel,serif",
      fontSize: "9px",
      letterSpacing: ".1em",
      background: "transparent",
      border: "1px solid rgba(201,168,76,.25)",
      color: "rgba(201,168,76,.7)",
      borderRadius: "4px",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      gap: "6px",
      transition: "all .15s",
    };
    const overlay = {
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: "rgba(0,0,0,.75)",
      zIndex: 9999,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    };
    const modal = {
      background: "#1a181b",
      border: "1px solid rgba(201,168,76,.25)",
      borderRadius: "8px",
      width: "520px",
      maxHeight: "80vh",
      overflowY: "auto",
      boxShadow: "0 8px 40px rgba(0,0,0,.6)",
    };
    const sectionHdr = (txt, color) =>
      h(
        "div",
        {
          style: {
            padding: "6px 16px",
            fontFamily: "Cinzel,serif",
            fontSize: "9px",
            letterSpacing: ".12em",
            textTransform: "uppercase",
            color,
            borderBottom: "1px solid rgba(201,168,76,.1)",
            background: "rgba(0,0,0,.3)",
          },
        },
        txt,
      );
    const pill = (name, isOut) =>
      h(
        "div",
        {
          key: name,
          style: {
            padding: "4px 10px",
            fontSize: "12px",
            fontFamily: "JetBrains Mono,monospace",
            borderRadius: "3px",
            border: isOut
              ? "1px solid rgba(231,76,60,.3)"
              : "1px solid rgba(201,168,76,.15)",
            color: isOut ? "#ff6b7a" : "var(--alabaster)",
            background: isOut ? "rgba(231,76,60,.08)" : "rgba(201,168,76,.04)",
          },
        },
        name,
      );

    return h(
      Fragment,
      null,
      h(
        "button",
        { style: btn, onClick: () => setOpen(true) },
        h(
          "span",
          {
            style: {
              fontFamily: "Cinzel,serif",
              fontSize: "10px",
              fontWeight: "700",
              border: "1px solid rgba(201,168,76,.4)",
              borderRadius: "50%",
              width: "16px",
              height: "16px",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--gold-solid)",
            },
          },
          "?",
        ),
        "BAA COO REF",
      ),
      open &&
        h(
          "div",
          { style: overlay, onClick: () => setOpen(false) },
          h(
            "div",
            { style: modal, onClick: (e) => e.stopPropagation() },
            h(
              "div",
              {
                style: {
                  padding: "14px 16px",
                  borderBottom: "1px solid rgba(201,168,76,.15)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
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
                      letterSpacing: ".12em",
                      color: "var(--gold-solid)",
                      textTransform: "uppercase",
                    },
                  },
                  "DFARS 252.225-7001",
                ),
                h(
                  "div",
                  {
                    style: {
                      fontFamily: "Cormorant Garamond,serif",
                      fontSize: "13px",
                      fontStyle: "italic",
                      color: "rgba(201,168,76,.6)",
                      marginTop: "2px",
                    },
                  },
                  "Buy American & Balance of Payments — applies all quotes above $10K",
                ),
              ),
              h(
                "button",
                {
                  onClick: () => setOpen(false),
                  style: {
                    background: "none",
                    border: "none",
                    color: "rgba(201,168,76,.5)",
                    fontSize: "18px",
                    cursor: "pointer",
                    lineHeight: 1,
                  },
                },
                "×",
              ),
            ),
            sectionHdr("Non-Qualifying — Cannot Source From", "#ff6b7a"),
            h(
              "div",
              {
                style: {
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "6px",
                  padding: "12px 16px",
                  borderBottom: "1px solid rgba(201,168,76,.1)",
                },
              },
              ...BAA_NON_QUAL.map((c) => pill(c, true)),
            ),
            sectionHdr("Qualifying — Clear to Source", "var(--gold-solid)"),
            h(
              "div",
              {
                style: {
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "6px",
                  padding: "12px 16px",
                },
              },
              ...BAA_QUAL.map((c) => pill(c, false)),
            ),
            h(
              "div",
              {
                style: {
                  padding: "10px 16px",
                  borderTop: "1px solid rgba(201,168,76,.1)",
                  fontFamily: "Cormorant Garamond,serif",
                  fontStyle: "italic",
                  fontSize: "13px",
                  color: "rgba(201,168,76,.5)",
                },
              },
              'Supplier gate question: "Country of origin?" — domestic or named qualifying country closes it. Vague = dig or pass.',
            ),
          ),
        ),
    );
  }

  // ── PRICING PANEL ────────────────────────────────────────────────────
  function PricingPanel({ parsed, onTierChange }) {
    const { fmt, TIER_MARGINS, calcBidMath } = window.SCC_MATH;

    const [factoring, setFactoring] = useIntakeState(3);
    const [pofunding, setPofunding] = useIntakeState(0);
    const [shipping, setShipping] = useIntakeState(0);
    const [supplierUnit, setSupplierUnit] = useIntakeState("");
    const [showDed, setShowDed] = useIntakeState(false);
    // null = ride the cost-plus floor; a number = manual bid override (price-to-market)
    const [bidOverride, setBidOverride] = useIntakeState(null);
    const [selectedTier, setSelectedTier] = useIntakeState(
      parsed.tier || "Standard",
    );

    const qty = parseFloat(parsed.quantity) || 1;
    const govUnit = parseFloat(parsed.unit_price) || 0;
    const tier = selectedTier;
    const tierMargin = TIER_MARGINS[tier] || 0.3;
    const hasQuote = supplierUnit !== "";
    const estCostUnit = govUnit * 0.7;
    const activeSupplierUnit = hasQuote ? supplierUnit : estCostUnit.toFixed(2);

    // ── BID PRICE: floor = cost-plus (tier min margin) · ceiling = gov hist ──
    const costUnitNum = parseFloat(activeSupplierUnit) || 0;
    const floorBid =
      costUnitNum > 0 ? +(costUnitNum / (1 - tierMargin)).toFixed(2) : 0;
    // Gov't historical unit price is the intelligence anchor / realistic ceiling.
    // If cost lands near/above it, open headroom so the slider still has range.
    const ceilBid =
      govUnit > floorBid ? govUnit : +(floorBid * 1.5).toFixed(2);
    const activeBid = bidOverride != null ? bidOverride : floorBid;
    // Back-solve an effective margin so calcBidMath reproduces the chosen bid
    // exactly (cost / (1 − (1 − cost/bid)) = bid) — no changes needed downstream.
    const effMargin =
      bidOverride != null && costUnitNum > 0 && activeBid > 0
        ? 1 - costUnitNum / activeBid
        : tierMargin;
    const m = calcBidMath(
      activeSupplierUnit,
      qty,
      effMargin,
      factoring,
      pofunding,
      shipping,
    );
    const meetsMargin = m.gpPct >= tierMargin * 100 - 0.5;
    const mcls = meetsMargin
      ? "var(--green)"
      : m.gpPct >= 15
        ? "var(--amber)"
        : "var(--red)";
    const ncls = m.net >= 0 ? "var(--green)" : "var(--red)";
    const inpStyle = {
      width: "160px",
      background: "var(--inset-bg)",
      border: "1px solid rgba(201,168,76,.2)",
      color: "var(--alabaster)",
      fontFamily: "JetBrains Mono,monospace",
      fontSize: "14px",
      padding: "8px 10px",
    };

    const kpis = [
      [
        "Bid Type",
        h(
          "div",
          null,
          h(
            "select",
            {
              value: selectedTier,
              onChange: (e) => {
                setSelectedTier(e.target.value);
                if (typeof onTierChange === "function")
                  onTierChange(e.target.value);
              },
              style: {
                background: "var(--surface-inset)",
                border: "1px solid rgba(201,168,76,.3)",
                color: "var(--gold-solid)",
                fontFamily: "Cinzel,serif",
                fontSize: "14px",
                letterSpacing: ".08em",
                padding: "6px 10px",
                cursor: "pointer",
                outline: "none",
                borderRadius: "2px",
                width: "100%",
              },
            },
            h("option", { value: "Standard" }, "Standard — 27.5%"),
            h("option", { value: "Fast Award" }, "Fast Award — 30%"),
            h(
              "option",
              { value: "Low Hanging Fruit" },
              "Low Hanging Fruit — 35%",
            ),
            h(
              "option",
              { value: "Small Business Set-Aside" },
              "Small Business Set-Aside — 30%",
            ),
            h("option", { value: "Floor 8%" }, "Floor — 8%"),
            h("option", { value: "Floor 10%" }, "Floor — 10%"),
            h("option", { value: "Floor 15%" }, "Floor — 15%"),
          ),
          h(
            "span",
            {
              style: {
                fontSize: "10px",
                color: "rgba(201,168,76,.5)",
                display: "block",
                marginTop: "3px",
              },
            },
            "sets minimum margin",
          ),
        ),
      ],
      [
        "Gov't Ref Price",
        h(
          "span",
          { style: { color: "var(--body-dim)", fontSize: "14px" } },
          fmt(govUnit),
          h(
            "span",
            {
              style: {
                fontSize: "10px",
                display: "block",
                color: "var(--body-faint)",
              },
            },
            (parsed.price_is_hist ? "hist. contract" : "ref price") +
              (parsed.extended_price && parsed.extended_price !== govUnit
                ? " · ext: " + fmt(parsed.extended_price)
                : ""),
          ),
        ),
      ],
      [
        "Supplier Cost/ea",
        h(
          "span",
          { style: { color: "var(--amber)" } },
          fmt(parseFloat(activeSupplierUnit)),
          h(
            "span",
            {
              style: {
                fontSize: "10px",
                marginLeft: "4px",
                color: "rgba(243,156,18,.5)",
              },
            },
            hasQuote ? "actual" : "est 70%",
          ),
        ),
      ],
      [
        "Your Bid Price/ea",
        h(
          "span",
          {
            className: "gold-text",
            style: { fontSize: "22px", fontWeight: "700" },
          },
          fmt(m.bidUnit),
        ),
      ],
      [
        "Bid Total",
        h(
          "span",
          { style: { color: "var(--accent-yellow)", fontWeight: "600" } },
          fmt(m.bidTotal),
          h(
            "span",
            {
              style: {
                fontSize: "10px",
                display: "block",
                color: "var(--body-faint)",
              },
            },
            "×" + qty + " units",
          ),
        ),
      ],
      ["Gross Profit", h("span", { style: { color: mcls } }, fmt(m.gp))],
      [
        "Margin",
        h(
          "span",
          { style: { color: mcls, fontWeight: "700" } },
          m.gpPct.toFixed(1) + "%",
          !meetsMargin &&
            h(
              "span",
              {
                style: {
                  fontSize: "10px",
                  display: "block",
                  color: "var(--red)",
                },
              },
              "below " + (tierMargin * 100).toFixed(0) + "% target",
            ),
        ),
      ],
      [
        "Out of Pocket",
        h(
          "span",
          { style: { color: "var(--red)", fontWeight: "600" } },
          fmt(m.cogs),
          h(
            "span",
            {
              style: {
                fontSize: "10px",
                display: "block",
                color: "rgba(231,76,60,.5)",
              },
            },
            (hasQuote ? "actual cost" : "est cost") + " ×" + qty,
          ),
        ),
      ],
      [
        "Net Take Home",
        h(
          "span",
          { style: { color: ncls, fontSize: "22px", fontWeight: "700" } },
          fmt(m.net),
        ),
      ],
    ];

    return h(
      "div",
      null,
      // Pricing bar
      h(
        "div",
        { className: "pricing-bar" },
        ...kpis.map(([lbl, val]) =>
          h(
            "div",
            { key: lbl, className: "p-item" },
            h("div", { className: "p-lbl" }, lbl),
            h("div", { className: "p-val" }, val),
          ),
        ),
      ),

      // Supplier quote input row
      h(
        "div",
        {
          style: {
            display: "flex",
            gap: "20px",
            alignItems: "flex-end",
            marginBottom: "14px",
            flexWrap: "wrap",
            padding: "4px 0",
          },
        },
        h(
          "div",
          null,
          h(
            "div",
            { className: "f-lbl", style: { marginBottom: "5px" } },
            "Supplier Quote/ea $ ",
            h(
              "span",
              { style: { color: "rgba(243,156,18,.45)", fontSize: "11px" } },
              "(blank = 70% gov ref estimate)",
            ),
          ),
          h("input", {
            type: "number",
            step: "0.01",
            placeholder: fmt(estCostUnit) + " est.",
            value: supplierUnit,
            onChange: (e) => setSupplierUnit(e.target.value),
            style: inpStyle,
          }),
        ),
        h(
          "button",
          {
            className: "btn btn-secondary",
            onClick: () => setShowDed((s) => !s),
            style: { padding: "8px 18px", fontSize: "12px" },
          },
          h("span", { className: "glint" }),
          (showDed ? "▴" : "▾") + " Deductions",
        ),
        !meetsMargin &&
          m.bidUnit > 0 &&
          h(
            "div",
            {
              style: {
                alignSelf: "flex-end",
                padding: "8px 14px",
                background: "rgba(231,76,60,.1)",
                border: "1px solid rgba(231,76,60,.35)",
                fontFamily: "JetBrains Mono,monospace",
                fontSize: "12px",
                color: "var(--red)",
              },
            },
            "⚠ Margin below " +
              (tierMargin * 100).toFixed(0) +
              "% " +
              tier +
              " target — consider passing",
          ),
      ),

      // Bid price slider — price to market between the cost-plus floor and
      // the gov historical price (the only market intel on the record).
      floorBid > 0 &&
        h(
          "div",
          {
            style: {
              padding: "14px 16px",
              marginBottom: "16px",
              background: "rgba(0,0,0,.25)",
              border:
                "1px solid " +
                (bidOverride != null
                  ? "rgba(201,168,76,.35)"
                  : "rgba(201,168,76,.12)"),
            },
          },
          h(
            "div",
            {
              style: {
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: "8px",
              },
            },
            h(
              "div",
              { className: "f-lbl" },
              "Bid Price/ea — drag to price to market ",
              h(
                "span",
                { style: { color: "rgba(201,168,76,.5)", fontSize: "11px" } },
                bidOverride != null ? "(manual override)" : "(riding min-margin floor)",
              ),
            ),
            h(
              "div",
              {
                style: {
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "14px",
                  color: "var(--gold-solid)",
                },
              },
              fmt(activeBid),
              govUnit > 0 &&
                h(
                  "span",
                  {
                    style: {
                      fontSize: "11px",
                      color: "var(--body-faint)",
                      marginLeft: "8px",
                    },
                  },
                  ((activeBid / govUnit) * 100).toFixed(0) +
                    "% of gov hist " +
                    fmt(govUnit),
                ),
            ),
          ),
          h(
            "div",
            { style: { display: "flex", gap: "12px", alignItems: "center" } },
            h("input", {
              type: "range",
              min: floorBid,
              max: Math.max(ceilBid, floorBid + 0.01),
              step: 0.01,
              value: Math.min(Math.max(activeBid, floorBid), ceilBid),
              onChange: (e) => setBidOverride(parseFloat(e.target.value)),
              style: { flex: 1, accentColor: "var(--gold-solid)", cursor: "pointer" },
            }),
            h("input", {
              type: "number",
              step: "0.01",
              value: activeBid,
              onChange: (e) => {
                const v = parseFloat(e.target.value);
                setBidOverride(e.target.value === "" || isNaN(v) ? null : v);
              },
              style: { ...inpStyle, width: "110px" },
            }),
            bidOverride != null &&
              h(
                "button",
                {
                  className: "btn btn-secondary",
                  onClick: () => setBidOverride(null),
                  style: { padding: "6px 12px", fontSize: "11px" },
                },
                h("span", { className: "glint" }),
                "Reset to floor",
              ),
          ),
          h(
            "div",
            {
              style: {
                display: "flex",
                justifyContent: "space-between",
                fontFamily: "JetBrains Mono,monospace",
                fontSize: "10px",
                color: "var(--body-faint)",
                marginTop: "6px",
              },
            },
            h(
              "span",
              null,
              "floor " +
                fmt(floorBid) +
                " · " +
                (tierMargin * 100).toFixed(0) +
                "% min margin",
            ),
            h("span", null, "gov hist ceiling " + fmt(ceilBid)),
          ),
        ),

      // Deductions panel
      showDed &&
        h(
          "div",
          {
            style: {
              display: "flex",
              gap: "20px",
              flexWrap: "wrap",
              padding: "16px",
              background: "rgba(0,0,0,.25)",
              border: "1px solid rgba(201,168,76,.1)",
              marginBottom: "16px",
            },
          },
          [
            ["Factoring %", factoring, setFactoring, "pct"],
            ["PO Funding %", pofunding, setPofunding, "pct"],
            ["Shipping Total $", shipping, setShipping, "dollar"],
          ].map(([lbl, val, setter, type]) =>
            h(
              "div",
              { key: lbl },
              h(
                "div",
                { className: "f-lbl", style: { marginBottom: "4px" } },
                lbl,
              ),
              h("input", {
                type: "number",
                step: type === "dollar" ? "0.01" : "0.1",
                value: val,
                onChange: (e) => setter(parseFloat(e.target.value) || 0),
                style: { ...inpStyle, width: "130px" },
              }),
            ),
          ),
          h(
            "div",
            {
              style: {
                alignSelf: "flex-end",
                fontFamily: "JetBrains Mono,monospace",
                fontSize: "12px",
                color: "var(--gold-dim)",
              },
            },
            "Total deductions: " + fmt(m.dedAmt),
          ),
        ),
    );
  }

  // ── INTAKE TAB ────────────────────────────────────────────────────────
  function IntakeTab({
    boxA,
    setBoxA,
    boxB,
    setBoxB,
    parsed,
    onParse,
    onClear,
    onSave,
  }) {
    const { fmt, tierClass } = window.SCC_MATH;

    const fields = parsed
      ? [
          ["Sol Number", parsed.sol_number],
          ["NSN", parsed.nsn],
          ["FSC", parsed.fsc],
          ["Item Name", parsed.item_name],
          [
            "Quantity",
            parsed.quantity
              ? parsed.quantity + " " + (parsed.unit_of_issue || "")
              : null,
          ],
          ["Unit Price", parsed.unit_price ? fmt(parsed.unit_price) : null],
          [
            "Extended",
            parsed.extended_price ? fmt(parsed.extended_price) : null,
          ],
          ["Quote Due", parsed.quote_due],
          ["Posted", parsed.posted_date],
          [
            "Delivery",
            parsed.delivery_days ? parsed.delivery_days + " days" : null,
          ],
          ["FOB", parsed.fob],
          ["Set Aside", parsed.set_aside],
          ["Ship To", parsed.ship_to],
          ["CLIN", parsed.clin],
          ["Shelf Life", parsed.shelf_life],
          ["Packaging", parsed.packaging_standard],
          ["Ref Supplier", parsed.ref_supplier],
          ["Ref P/N", parsed.ref_part_number],
          ["CAGE", parsed.ref_supplier_cage],
          ["All Suppliers", parsed.all_suppliers],
        ]
      : [];

    return h(
      "div",
      { style: { animation: "fadeUp .4s ease both" } },
      h(
        "div",
        { className: "intake-grid" },
        h(
          "div",
          { className: "input-group" },
          h("div", { className: "lbl" }, "DIBBS Listing Paste"),
          h("textarea", {
            value: boxA,
            onChange: (e) => setBoxA(e.target.value),
            placeholder:
              "Paste the full DIBBS listing text here (SPE... line)…",
          }),
        ),
        h(
          "div",
          { className: "input-group" },
          h("div", { className: "lbl" }, "AI-Enriched Text (Optional)"),
          h("textarea", {
            value: boxB,
            onChange: (e) => setBoxB(e.target.value),
            placeholder: "Paste Claude or AI structured extraction here…",
          }),
        ),
      ),

      h(
        "div",
        { style: { display: "flex", gap: "12px", flexWrap: "wrap" } },
        h(
          "button",
          { className: "btn btn-primary", onClick: onParse },
          h("span", { className: "glint" }),
          "Parse RFQ",
        ),
        h(
          "button",
          { className: "btn btn-secondary", onClick: onClear },
          h("span", { className: "glint" }),
          "Clear",
        ),
        h(BAAModal, null),
      ),

      parsed &&
        h(
          "div",
          { className: "preview-box" },
          h(
            "div",
            { className: "preview-title gold-text" },
            "Parsed Record Preview",
          ),

          // Pricing Panel
          h(PricingPanel, { parsed }),

          // Fields grid
          h(
            "div",
            { className: "fields-grid" },
            ...fields.map(([lbl, val]) =>
              h(
                "div",
                { key: lbl, className: "field" },
                h("div", { className: "f-lbl" }, lbl),
                h(
                  "div",
                  { className: "f-val " + (val ? "" : "f-missing") },
                  val || "—",
                ),
              ),
            ),
          ),

          // Tier badge
          parsed.tier &&
            h(
              "div",
              { style: { marginBottom: "20px" } },
              h(
                "span",
                { className: "tier " + tierClass(parsed.tier) },
                parsed.tier,
              ),
              h(
                "span",
                {
                  style: {
                    fontFamily: "JetBrains Mono,monospace",
                    fontSize: "12px",
                    color: "var(--gold-dim)",
                    marginLeft: "12px",
                  },
                },
                "Target margin: " +
                  ((parsed.targetMargin || 0.3) * 100).toFixed(0) +
                  "%",
              ),
            ),

          // All suppliers
          parsed.all_suppliers &&
            h(
              "div",
              {
                style: {
                  marginBottom: "20px",
                  padding: "12px 16px",
                  background: "rgba(0,0,0,.3)",
                  border: "1px solid rgba(201,168,76,.1)",
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "12px",
                  color: "var(--body-muted)",
                },
              },
              h(
                "div",
                {
                  style: {
                    color: "var(--gold-dim)",
                    fontSize: "10px",
                    letterSpacing: ".15em",
                    textTransform: "uppercase",
                    marginBottom: "6px",
                  },
                },
                "All Reference Suppliers",
              ),
              parsed.all_suppliers,
            ),

          // Blocked manufacturer warning
          (() => {
            const isBlocked = window.SCC_TABS && window.SCC_TABS.isBlocked;
            const hit =
              isBlocked && parsed.ref_supplier
                ? isBlocked(parsed.ref_supplier)
                : null;
            if (!hit) return null;
            return h(
              "div",
              {
                style: {
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "14px",
                  padding: "14px 18px",
                  marginBottom: "16px",
                  background: "rgba(231,76,60,.08)",
                  border: "1px solid rgba(231,76,60,.5)",
                  borderLeft: "4px solid #e74c3c",
                  animation: "fadeUp .25s ease both",
                },
              },
              h(
                "span",
                { style: { fontSize: "22px", lineHeight: "1.1" } },
                "⚠",
              ),
              h(
                "div",
                null,
                h(
                  "div",
                  {
                    style: {
                      fontFamily: "Cinzel,serif",
                      fontSize: "13px",
                      letterSpacing: ".1em",
                      textTransform: "uppercase",
                      color: "#ff6b7a",
                      marginBottom: "4px",
                    },
                  },
                  "BLOCKED MANUFACTURER — " + hit.name,
                ),
                hit.reason &&
                  h(
                    "div",
                    {
                      style: {
                        fontFamily: "Cormorant Garamond,serif",
                        fontSize: "14px",
                        fontStyle: "italic",
                        color: "rgba(231,76,60,.7)",
                        marginBottom: "3px",
                      },
                    },
                    "↳ " + hit.reason,
                  ),
                h(
                  "div",
                  {
                    style: {
                      fontFamily: "JetBrains Mono,monospace",
                      fontSize: "10px",
                      color: "rgba(231,76,60,.5)",
                    },
                  },
                  "Ref Supplier on this sol is blocked — source through distributors only. Do not contact direct.",
                ),
              ),
            );
          })(),

          // Save button
          h(
            "button",
            {
              className: "btn btn-primary",
              onClick: onSave,
              style: { marginTop: "8px" },
            },
            h("span", { className: "glint" }),
            "Save to Pipeline",
          ),
        ),
    );
  }

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.IntakeTab = IntakeTab;
  window.SCC_TABS.PricingPanel = PricingPanel;
})();
