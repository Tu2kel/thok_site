(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — PIPELINE · DRAWER
  //  Pre-compiled React · No Babel · No JSX
  //  Depends on: pipeline-vi.js (VendorIntelPanel via window.SCC_TABS)
  //  Exports: window.SCC_TABS.Drawer
  // ═══════════════════════════════════════════════════════════════════════

  const {
    createElement: hP,
    useState: usePState,
    useEffect: usePEffect,
    Fragment: PFrag,
  } = React;

  // ── WIN LEDGER PANEL ─────────────────────────────────────────────────
  function WinLedgerPanel({ record }) {
    const WL = window.SCC_WIN_LEDGER;
    const dists = (window.SCC_DIST && window.SCC_DIST.DISTRIBUTORS) || [];
    const [wins, setWins] = usePState(() => WL ? WL.lookup(record.nsn, record.ref_part_number) : []);
    const [open, setOpen] = usePState(false);
    const [vName, setVName] = usePState("");
    const [price, setPrice] = usePState("");
    const [bidPx, setBidPx] = usePState("");
    const [qty, setQty] = usePState(record.quantity || "");
    const [wNotes, setWNotes] = usePState("");
    const [saving, setSaving] = usePState(false);

    if (!WL) return null;

    const refresh = () => setWins(WL.lookup(record.nsn, record.ref_part_number));

    const doLog = () => {
      if (!vName.trim()) return;
      setSaving(true);
      WL.logWin({
        nsn: record.nsn || "",
        pn: record.ref_part_number || "",
        item_name: record.item_name || record.item_name_ai || "",
        vendor_name: vName.trim(),
        price: parseFloat(price) || null,
        bid_price: parseFloat(bidPx) || null,
        qty: qty || record.quantity || "",
        sol_number: record.sol_number || "",
        date: new Date().toISOString().slice(0, 10),
        notes: wNotes.trim(),
      });
      setVName(""); setPrice(""); setBidPx(""); setWNotes(""); setOpen(false);
      setSaving(false);
      refresh();
    };

    const doRemove = (id) => { WL.removeWin(id); refresh(); };

    const gold = { color: "var(--gold-solid)" };
    const dim = { color: "var(--body-dim)", fontFamily: "JetBrains Mono,monospace", fontSize: "11px" };
    const tag = (txt, col) => hP("span", {
      style: { fontSize: "9px", fontFamily: "Cinzel,serif", letterSpacing: ".1em", padding: "1px 7px",
        background: col + "18", border: "1px solid " + col + "44", color: col, borderRadius: "2px" }
    }, txt);

    return hP("div", {
      style: { marginTop: "20px", borderTop: "1px solid rgba(201,168,76,.15)", paddingTop: "16px" }
    },
      // Header
      hP("div", { style: { display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" } },
        hP("div", { style: { fontFamily: "Cinzel,serif", fontSize: "11px", letterSpacing: ".14em",
          textTransform: "uppercase", color: "var(--gold-solid)" } }, "↩ Win Ledger"),
        wins.length > 0 && tag(wins.length + " win" + (wins.length > 1 ? "s" : ""), "#4caf50"),
        hP("button", {
          onClick: () => setOpen(o => !o),
          style: { marginLeft: "auto", background: "transparent", border: "1px solid rgba(201,168,76,.3)",
            color: "var(--gold-dim)", fontFamily: "Cinzel,serif", fontSize: "9px", letterSpacing: ".1em",
            padding: "3px 10px", cursor: "pointer" }
        }, open ? "Cancel" : "+ Log Win"),
      ),

      // Log win form
      open && hP("div", {
        style: { background: "rgba(61,214,140,.04)", border: "1px solid rgba(61,214,140,.2)",
          borderLeft: "3px solid rgba(61,214,140,.5)", padding: "12px 14px", marginBottom: "12px" }
      },
        hP("div", { style: { fontFamily: "Cinzel,serif", fontSize: "9px", letterSpacing: ".14em",
          color: "var(--accent-green)", textTransform: "uppercase", marginBottom: "10px" } }, "Log Winning Vendor"),
        // Vendor name — datalist from distributor DB
        hP("div", { style: { marginBottom: "8px" } },
          hP("div", { style: { fontFamily: "Cinzel,serif", fontSize: "9px", letterSpacing: ".12em",
            color: "var(--body-faint)", textTransform: "uppercase", marginBottom: "4px" } }, "Vendor / Supplier *"),
          hP("input", {
            list: "wl-dist-list",
            value: vName,
            onChange: e => setVName(e.target.value),
            placeholder: "Type or pick from distributor DB…",
            style: { width: "100%", background: "var(--inset-bg)", border: "1px solid rgba(61,214,140,.25)",
              color: "var(--alabaster)", fontFamily: "JetBrains Mono,monospace", fontSize: "12px",
              padding: "7px 10px", boxSizing: "border-box", outline: "none" }
          }),
          hP("datalist", { id: "wl-dist-list" },
            ...dists.map(d => hP("option", { key: d.id, value: d.name }))
          ),
        ),
        // Price row
        hP("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", marginBottom: "8px" } },
          hP("div", null,
            hP("div", { style: { fontFamily: "Cinzel,serif", fontSize: "9px", letterSpacing: ".12em",
              color: "var(--body-faint)", textTransform: "uppercase", marginBottom: "4px" } }, "Cost / Unit ($)"),
            hP("input", { type: "number", value: price, onChange: e => setPrice(e.target.value),
              placeholder: "0.00",
              style: { width: "100%", background: "var(--inset-bg)", border: "1px solid rgba(61,214,140,.2)",
                color: "var(--alabaster)", fontFamily: "JetBrains Mono,monospace", fontSize: "12px",
                padding: "7px 10px", boxSizing: "border-box", outline: "none" } }),
          ),
          hP("div", null,
            hP("div", { style: { fontFamily: "Cinzel,serif", fontSize: "9px", letterSpacing: ".12em",
              color: "var(--body-faint)", textTransform: "uppercase", marginBottom: "4px" } }, "Bid Price / Unit ($)"),
            hP("input", { type: "number", value: bidPx, onChange: e => setBidPx(e.target.value),
              placeholder: "0.00",
              style: { width: "100%", background: "var(--inset-bg)", border: "1px solid rgba(61,214,140,.2)",
                color: "var(--alabaster)", fontFamily: "JetBrains Mono,monospace", fontSize: "12px",
                padding: "7px 10px", boxSizing: "border-box", outline: "none" } }),
          ),
          hP("div", null,
            hP("div", { style: { fontFamily: "Cinzel,serif", fontSize: "9px", letterSpacing: ".12em",
              color: "var(--body-faint)", textTransform: "uppercase", marginBottom: "4px" } }, "Qty"),
            hP("input", { value: qty, onChange: e => setQty(e.target.value),
              placeholder: record.quantity || "",
              style: { width: "100%", background: "var(--inset-bg)", border: "1px solid rgba(61,214,140,.2)",
                color: "var(--alabaster)", fontFamily: "JetBrains Mono,monospace", fontSize: "12px",
                padding: "7px 10px", boxSizing: "border-box", outline: "none" } }),
          ),
        ),
        // Notes
        hP("div", { style: { marginBottom: "10px" } },
          hP("div", { style: { fontFamily: "Cinzel,serif", fontSize: "9px", letterSpacing: ".12em",
            color: "var(--body-faint)", textTransform: "uppercase", marginBottom: "4px" } }, "Notes (optional)"),
          hP("input", { value: wNotes, onChange: e => setWNotes(e.target.value),
            placeholder: "Lead time, lot dates, contact name…",
            style: { width: "100%", background: "var(--inset-bg)", border: "1px solid rgba(61,214,140,.2)",
              color: "var(--alabaster)", fontFamily: "JetBrains Mono,monospace", fontSize: "12px",
              padding: "7px 10px", boxSizing: "border-box", outline: "none" } }),
        ),
        hP("button", {
          onClick: doLog, disabled: saving || !vName.trim(),
          style: { background: "rgba(61,214,140,.12)", border: "1px solid rgba(61,214,140,.4)",
            color: "var(--accent-green)", fontFamily: "Cinzel,serif", fontSize: "10px",
            letterSpacing: ".1em", padding: "7px 18px", cursor: "pointer" }
        }, saving ? "Saving…" : "◆ Save Win"),
      ),

      // Existing wins
      wins.length === 0
        ? hP("div", { style: { ...dim, fontStyle: "italic", color: "var(--body-faint)", padding: "8px 0" } },
            "No wins logged for this NSN yet.")
        : hP("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } },
            ...wins.map(w => {
              const age = WL.winAge(w);
              const net = WL.netAfterFE(w.bid_price, w.price);
              const borderColor = age ? age.color + "55" : "rgba(61,214,140,.15)";
              const leftColor  = age ? age.color       : "rgba(61,214,140,.5)";
              return hP("div", { key: w.id,
                style: { background: "rgba(61,214,140,.04)", border: "1px solid " + borderColor,
                  borderLeft: "3px solid " + leftColor, padding: "9px 12px",
                  display: "flex", alignItems: "flex-start", gap: "10px" }
              },
                hP("div", { style: { flex: 1 } },
                  // Vendor + age badge
                  hP("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" } },
                    hP("span", { style: { fontFamily: "Cinzel,serif", fontSize: "12px", ...gold } }, w.vendor_name),
                    age && hP("span", {
                      title: age.days + " days ago",
                      style: { fontSize: "9px", fontFamily: "JetBrains Mono,monospace", padding: "1px 6px",
                        background: age.color + "18", border: "1px solid " + age.color + "55",
                        color: age.color, borderRadius: "2px" }
                    }, age.label),
                  ),
                  // Cost · Bid · Net-after-FE
                  hP("div", { style: { ...dim, display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "2px" } },
                    w.price    ? hP("span", null, "Cost $" + Number(w.price).toFixed(2))    : null,
                    w.bid_price? hP("span", null, "Bid $"  + Number(w.bid_price).toFixed(2)): null,
                    net != null? hP("span", {
                      title: "Net after est. 5% FE (30-day)",
                      style: { color: net >= 0 ? "var(--accent-green)" : "var(--accent-red-soft)",
                        fontWeight: "600" }
                    }, "Net $" + net.toFixed(2)) : null,
                    w.qty       ? hP("span", null, "Qty " + w.qty)           : null,
                    w.sol_number? hP("span", { style: { color: "var(--body-faint)" } }, w.sol_number) : null,
                    hP("span", { style: { color: "var(--body-faint)" } }, w.date || w.logged),
                  ),
                  w.notes && hP("div", { style: { ...dim, fontStyle: "italic", marginTop: "2px",
                    color: "var(--body-faint)" } }, w.notes),
                ),
                hP("button", {
                  onClick: () => doRemove(w.id),
                  title: "Remove — use when quote elapsed, vendor changed, or lost",
                  style: { background: "transparent", border: "1px solid rgba(231,76,60,.2)",
                    color: "rgba(231,76,60,.5)", fontFamily: "Cinzel,serif", fontSize: "9px",
                    letterSpacing: ".08em", padding: "2px 8px", cursor: "pointer", whiteSpace: "nowrap" },
                  onMouseEnter: e => { e.target.style.color = "#e74c3c"; e.target.style.borderColor = "rgba(231,76,60,.5)"; },
                  onMouseLeave: e => { e.target.style.color = "rgba(231,76,60,.5)"; e.target.style.borderColor = "rgba(231,76,60,.2)"; },
                }, "Remove"),
              );
            })
          ),
    );
  }

  // ── DRAWER ───────────────────────────────────────────────────────────
  function Drawer({ record, onSave, showToast }) {
    // Components resolved at render time to avoid load-order undefined errors
    const DrawerSourcePanel = window.SCC_TABS.DrawerSourcePanel || null;
    const VendorIntelPanel = window.SCC_TABS.VendorIntelPanel || null;
    const AwardsIntelPanel = window.SCC_TABS.AwardsIntelPanel || null;
    const [dtab, setDtab] = usePState("supplier");
    const [form, setForm] = usePState({
      supplier_name: record.ref_supplier || "",
      supplier_website: "",
      supplier_phone: "",
      supplier_email: "",
      supplier_poc: "",
      supplier_quote_price: "",
      supplier_quote_date: "",
      supplier_quote_expires: "",
      supplier_lead_time: "",
      supplier_moq: "",
      actual_cost: "",
      bid_submitted_date: "",
      award_date: "",
      rebid: "",
      win_loss_reason: "",
      notes: "",
      nsn_win_count: "",
      nsn_loss_count: "",
      nsn_avg_win_margin: "",
      nsn_notes: "",
      quote_history: "",
      ...Object.fromEntries(
        Object.entries(record).filter(([k]) =>
          [
            "supplier_name",
            "supplier_website",
            "supplier_phone",
            "supplier_email",
            "supplier_poc",
            "supplier_quote_price",
            "supplier_quote_date",
            "supplier_quote_expires",
            "supplier_lead_time",
            "supplier_moq",
            "actual_cost",
            "bid_submitted_date",
            "award_date",
            "rebid",
            "win_loss_reason",
            "notes",
            "nsn_win_count",
            "nsn_loss_count",
            "nsn_avg_win_margin",
            "nsn_notes",
            "quote_history",
          ].includes(k),
        ),
      ),
    });
    const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

    const quoteEmail = `Subject: RFQ – ${record.nsn || "NSN TBD"} / ${record.sol_number} – Quote Request<br>
<br>
Good morning,<br>
<br>
My name is Anthony Kelley, Founder of Imperio Talent Solutions (CAGE: 152U4). We are a registered DLA supplier and are currently evaluating a solicitation for which your company is listed as an approved source.<br>
<br>
We are requesting a vendor quote for the following item:<br>
<br>
  Solicitation:   ${record.sol_number}<br>
  Item:           ${record.item_name || "—"}<br>
  NSN:            ${record.nsn || "—"}<br>
  Part Number:    ${record.ref_part_number || "—"}<br>
  Quantity:       ${record.quantity || "—"} ${record.unit_of_issue || ""}<br>
  Unit of Issue:  ${record.unit_of_issue || "—"}<br>
  Required Del.:  ${record.delivery_days || "—"} days ARO<br>
  Quote Due:      ${record.quote_due || "—"}<br>
<br>
Please provide your best unit price, lead time, and any applicable MOQ.<br>
<br>
Quotes can be returned to this email. If you have questions, feel free to reach out directly.<br>
<br>
Best regards,<br>
Anthony K. Kelley | Founder & CEO<br>
Imperio Talent Solutions | CAGE 152U4<br>
(254) 265-9335 | anthony@imperiovita.co`;

    const [emailBody, setEmailBody] = usePState(quoteEmail);
    const [copied, setCopied] = usePState(false);
    const copyEmail = () => {
      navigator.clipboard.writeText(emailBody).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    };

    const inp = (k, lbl) =>
      hP(
        "div",
        { className: "drawer-field" },
        hP("label", { style: { fontSize: "11.5px" } }, lbl),
        hP("input", {
          className: "drawer-input",
          style: { fontSize: "14.5px" },
          value: form[k] || "",
          placeholder: lbl,
          onChange: (e) => set(k, e.target.value),
        }),
      );

    const DRAWER_TABS = [
      ["supplier", "Supplier Intel"],
      ["vendor_intel", "◆ Vendor Intel"],
      ["bid", "Bid & Outcome"],
      ["quotes", "Quote History"],
      ["nsn", "NSN Intel"],
      ["awards_intel", "⬡ Awards Intel"],
      ["market_intel", "📊 Market"],
      ["mfg_ref", "◆ MFG Quotes"],
      ["source", "◆ Source"],
      ["email", "Email"],
      ["records", "📁 Records"],
    ];

    return hP(
      "div",
      { className: "drawer-inner" },
      hP(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "6px 14px 4px",
            borderBottom: "1px solid rgba(201,168,76,.15)",
            background: "rgba(201,168,76,.03)",
          },
        },
        hP("span", {
          style: {
            width: "7px",
            height: "7px",
            borderRadius: "50%",
            background: "#C9A84C",
            boxShadow: "0 0 6px #C9A84C88",
            animation: "pulse 2s infinite",
            display: "inline-block",
            flexShrink: 0,
          },
        }),
        hP(
          "span",
          {
            style: {
              fontFamily: "Cinzel,serif",
              fontSize: "9px",
              letterSpacing: ".1em",
              color: "var(--gold-dim)",
              textTransform: "uppercase",
            },
          },
          "Working · " +
            (record.sol_number || "") +
            " · " +
            (record.item_name || ""),
        ),
      ),
      hP(
        "div",
        { className: "drawer-tabs" },
        ...DRAWER_TABS.map(([id, lbl]) =>
          hP(
            "button",
            {
              key: id,
              "data-tab": id,
              className: "drawer-tab" + (dtab === id ? " active" : ""),
              onClick: () => setDtab(id),
            },
            lbl,
          ),
        ),
      ),
      hP(
        "div",
        { className: "drawer-body" },

        dtab === "vendor_intel" &&
          hP(
            PFrag,
            null,
            hP(
              "div",
              {
                className: "drawer-section-title",
                style: {
                  color: "var(--accent-green)",
                  borderColor: "rgba(61,214,140,.25)",
                  fontSize: "13px",
                },
              },
              "◆ Vendor Intel — " +
                (record.nsn || "No NSN") +
                " · FSC " +
                (record.fsc || "—"),
            ),
            VendorIntelPanel
              ? hP(VendorIntelPanel, {
                  record,
                  showToast: showToast || (() => {}),
                })
              : hP(
                  "div",
                  {
                    style: {
                      color: "var(--amber)",
                      padding: "20px",
                      fontFamily: "JetBrains Mono,monospace",
                      fontSize: "12px",
                    },
                  },
                  "Vendor Intel loading...",
                ),
          ),

        dtab === "awards_intel" &&
          hP(
            PFrag,
            null,
            hP(
              "div",
              {
                className: "drawer-section-title",
                style: {
                  color: "var(--amber)",
                  borderColor: "rgba(243,156,18,.25)",
                  fontSize: "13px",
                },
              },
              "⬡ Awards Intel — " +
                (record.nsn || "No NSN") +
                " · FSC " +
                (record.fsc || "—"),
            ),
            AwardsIntelPanel
              ? hP(AwardsIntelPanel, { record })
              : hP(
                  "div",
                  {
                    style: {
                      color: "var(--amber)",
                      padding: "20px",
                      fontFamily: "JetBrains Mono,monospace",
                      fontSize: "12px",
                    },
                  },
                  "Awards Intel loading...",
                ),
          ),

        dtab === "market_intel" &&
          hP(PFrag, null,
            hP("div", {
              className: "drawer-section-title",
              style: { color: "var(--gold-solid)", borderColor: "rgba(201,168,76,.25)", fontSize: "13px" },
            }, "📊 Market Intel — FSC " + (record.fsc || (record.nsn ? record.nsn.replace(/-/g,"").slice(0,4) : "—"))),
            window.SCC_TABS && window.SCC_TABS.MarketIntelPanel
              ? hP(window.SCC_TABS.MarketIntelPanel, { record })
              : hP("div", { style: { padding: "20px", fontFamily: "JetBrains Mono,monospace", fontSize: "12px", color: "var(--body-dim)" } }, "Market Intel loading…"),
          ),

        dtab === "supplier" &&
          hP(PFrag, null,
            (() => {
              const fld = (k, lbl, opts = {}) => hP("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } },
                hP("label", { style: { fontFamily: "Cinzel,serif", fontSize: "9px", letterSpacing: ".18em",
                  textTransform: "uppercase", color: "rgba(245,240,232,.38)" } }, lbl),
                hP("input", {
                  className: "drawer-input",
                  type: opts.type || "text",
                  value: form[k] || "",
                  placeholder: opts.ph || lbl,
                  onChange: e => set(k, e.target.value),
                  style: { fontSize: opts.size || "15px", width: "100%", boxSizing: "border-box",
                    padding: "9px 12px", ...(opts.bold ? { fontWeight: "600" } : {}) },
                }),
              );

              const hasQuote = !!(form.supplier_quote_price && parseFloat(form.supplier_quote_price) > 0);
              const quotePx  = hasQuote ? parseFloat(form.supplier_quote_price) : 0;

              return hP(PFrag, null,

                // ── Contact card ──
                hP("div", {
                  style: { background: "rgba(56,189,248,.04)", border: "1px solid rgba(56,189,248,.18)",
                    borderLeft: "3px solid rgba(56,189,248,.55)", borderRadius: "5px",
                    padding: "18px 20px", marginBottom: "12px" }
                },
                  hP("div", { style: { fontFamily: "Cinzel,serif", fontSize: "9px", letterSpacing: ".22em",
                    textTransform: "uppercase", color: "rgba(56,189,248,.65)", marginBottom: "16px" } }, "Contact"),

                  hP("div", { style: { marginBottom: "14px" } },
                    fld("supplier_name", "Supplier / Vendor Name", { ph: "e.g. Bonesteel Aerospace, LLC" }),
                    hP("div", { style: { fontFamily: "Cormorant Garamond,serif", fontStyle: "italic",
                      fontSize: "12px", color: "rgba(56,189,248,.55)", marginTop: "4px" } },
                      "Saving a quote here also logs this vendor to the global NSN Intel — no need to re-enter it under Vendor Intel."),
                  ),
                  hP("div", { style: { marginBottom: "14px" } },
                    fld("supplier_website", "Website", { ph: "https://" })
                  ),
                  hP("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "14px" } },
                    fld("supplier_phone", "Phone", { ph: "(xxx) xxx-xxxx" }),
                    fld("supplier_email", "Email", { ph: "vendor@company.com" }),
                  ),
                  fld("supplier_poc", "Point of Contact", { ph: "Name / title" }),
                ),

                // ── Quote card ──
                hP("div", {
                  style: { background: "rgba(201,168,76,.04)", border: "1px solid rgba(201,168,76,.22)",
                    borderLeft: "3px solid rgba(201,168,76,.65)", borderRadius: "5px",
                    padding: "18px 20px", marginBottom: "14px" }
                },
                  hP("div", { style: { display: "flex", alignItems: "flex-start",
                    justifyContent: "space-between", marginBottom: "16px" } },
                    hP("div", { style: { fontFamily: "Cinzel,serif", fontSize: "9px", letterSpacing: ".22em",
                      textTransform: "uppercase", color: "var(--gold-dim)" } }, "Quote"),
                    hasQuote && hP("div", {
                      style: { fontFamily: "JetBrains Mono,monospace", fontSize: "30px", fontWeight: "700",
                        background: "linear-gradient(to bottom,#cf972d,#f9f295,#e0aa3e)",
                        WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                        lineHeight: 1, letterSpacing: "-.02em" }
                    }, "$" + quotePx.toFixed(2) + " /ea"),
                  ),

                  hP("div", { style: { marginBottom: "16px" } },
                    fld("supplier_quote_price", "Quote Price / EA ($)", { type: "number", ph: "0.00", size: "22px", bold: true })
                  ),

                  hP("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "14px", marginBottom: "14px" } },
                    fld("supplier_quote_date",    "Quote Date",  { ph: "MM/DD/YY" }),
                    fld("supplier_quote_expires", "Expires",     { ph: "MM/DD/YY" }),
                    fld("supplier_lead_time",     "Lead Time",   { ph: "5 days ARO" }),
                  ),

                  hP("div", { style: { maxWidth: "42%" } },
                    fld("supplier_moq", "MOQ", { ph: "e.g. 10 EA" })
                  ),
                ),

                hP("button", {
                  className: "btn btn-primary",
                  onClick: () => onSave(form),
                  style: { marginTop: "4px" },
                },
                  hP("span", { className: "glint" }),
                  "Save Details",
                ),
              );
            })(),
          ),

        dtab === "bid" &&
          hP(
            PFrag,
            null,
            hP(
              "div",
              {
                className: "drawer-section-title",
                style: {
                  color: "var(--accent-green-dim)",
                  borderColor: "rgba(93,187,122,.25)",
                  fontSize: "13px",
                },
              },
              "Bid Price Calculator",
            ),
            // ── BID PRICE RECOMMENDATION PANEL ──────────────────────────
            (() => {
              const { calcBidMath, fmt } = window.SCC_MATH;
              const qty = parseFloat(record.quantity) || 1;
              const extPrice = parseFloat(record.unit_price) || 0;
              const rawCost = parseFloat(form.supplier_quote_price) || 0;
              const TIERS = [
                { label: "8%", pct: 0.08, color: "#e74c3c" },
                { label: "10%", pct: 0.1, color: "#e8874f" },
                { label: "15%", pct: 0.15, color: "#f0c040" },
                { label: "20%", pct: 0.2, color: "#7eb8f7" },
                { label: "25%", pct: 0.25, color: "#9ab8ff" },
                { label: "27.5%", pct: 0.275, color: "#C9A84C" },
                { label: "30%", pct: 0.3, color: "#f9f295" },
                { label: "35%", pct: 0.35, color: "#3dd68c" },
                { label: "40%", pct: 0.4, color: "#a8e6cf" },
              ];

              const hasCost = rawCost > 0;
              const histUnit = extPrice;

              return hP(
                "div",
                {
                  style: {
                    background: "var(--surface-inset)",
                    border: "1px solid rgba(201,168,76,.2)",
                    borderRadius: "6px",
                    padding: "14px 16px",
                    marginBottom: "16px",
                  },
                },
                // label
                hP(
                  "div",
                  {
                    style: {
                      fontFamily: "Cinzel,serif",
                      fontSize: "8.5px",
                      letterSpacing: ".15em",
                      color: "var(--gold-dim)",
                      textTransform: "uppercase",
                      marginBottom: "10px",
                    },
                  },
                  hasCost
                    ? "Supplier Cost: " + fmt(rawCost) + "/ea · Qty " + qty
                    : "Enter Supplier Quote Price in the Supplier tab to see bid recommendations",
                ),
                hasCost &&
                  hP(
                    "div",
                    {
                      style: {
                        display: "grid",
                        gridTemplateColumns: "repeat(3, 1fr)",
                        gap: "8px",
                      },
                    },
                    ...TIERS.map(({ label, pct, color }) => {
                      const bidUnit = +(rawCost / (1 - pct)).toFixed(2);
                      const bidTotal = +(bidUnit * qty).toFixed(2);
                      const gp = bidTotal - rawCost * qty;
                      const selfFunded = bidTotal < 10000;
                      const feAmt = selfFunded
                        ? 0
                        : window.SCC_MATH.calcFEFees(bidTotal, 60, true)
                            .totalFee;
                      const net = +(gp - feAmt).toFixed(2);
                      const netPct =
                        bidTotal > 0
                          ? ((net / bidTotal) * 100).toFixed(1)
                          : "0.0";
                      const beatsHist = histUnit > 0 && bidUnit <= histUnit;

                      return hP(
                        "div",
                        {
                          style: {
                            background: "rgba(0,0,0,.25)",
                            border: "1px solid " + color + "33",
                            borderRadius: "5px",
                            padding: "10px 10px 8px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "4px",
                          },
                        },
                        // tier label
                        hP(
                          "div",
                          {
                            style: {
                              fontFamily: "Cinzel,serif",
                              fontSize: "9px",
                              letterSpacing: ".12em",
                              color: color,
                              fontWeight: 700,
                              marginBottom: "2px",
                            },
                          },
                          label + " MARGIN",
                        ),
                        // bid price
                        hP(
                          "div",
                          {
                            style: {
                              fontFamily: "JetBrains Mono,monospace",
                              fontSize: "17px",
                              color: color,
                              fontWeight: 700,
                              lineHeight: 1,
                            },
                          },
                          fmt(bidUnit),
                        ),
                        hP(
                          "div",
                          {
                            style: {
                              fontFamily: "JetBrains Mono,monospace",
                              fontSize: "9.5px",
                              color: "var(--body-faint)",
                            },
                          },
                          "per ea",
                        ),
                        // total
                        hP(
                          "div",
                          {
                            style: {
                              fontFamily: "JetBrains Mono,monospace",
                              fontSize: "11px",
                              color: "var(--alabaster)",
                              marginTop: "4px",
                            },
                          },
                          "Total: " + fmt(bidTotal),
                        ),
                        // net after FE
                        hP(
                          "div",
                          {
                            style: {
                              fontFamily: "JetBrains Mono,monospace",
                              fontSize: "10px",
                              color: net > 0 ? "#3dd68c" : "#e74c3c",
                            },
                          },
                          "Net: " +
                            fmt(net) +
                            " (" +
                            netPct +
                            "%)" +
                            (!selfFunded ? " after FE" : " self-funded"),
                        ),
                        // vs hist
                        histUnit > 0 &&
                          hP(
                            "div",
                            {
                              style: {
                                fontFamily: "JetBrains Mono,monospace",
                                fontSize: "9px",
                                marginTop: "3px",
                                color: beatsHist ? "#3dd68c" : "#e74c3c",
                              },
                            },
                            beatsHist
                              ? "✓ under hist " + fmt(histUnit)
                              : "✗ over hist " + fmt(histUnit),
                          ),
                      );
                    }),
                  ),
              );
            })(),
            hP(
              "div",
              {
                className: "drawer-section-title",
                style: {
                  color: "var(--accent-green-dim)",
                  borderColor: "rgba(93,187,122,.25)",
                  fontSize: "13px",
                  marginTop: "8px",
                },
              },
              "Bid & Outcome",
            ),
            hP(
              "div",
              { className: "drawer-grid" },
              inp("actual_cost", "Final Actual Cost Post-Award ($)"),
              inp("bid_submitted_date", "Bid Submitted Date"),
              inp("award_date", "Award Date"),
              inp("rebid", "Re-bid Sol # (if re-issued)"),
              hP(
                "div",
                { className: "drawer-field", style: { gridColumn: "span 2" } },
                hP(
                  "label",
                  {
                    style: {
                      fontSize: "11.5px",
                      color: "var(--body-mono)",
                    },
                  },
                  "Win / Loss Reason",
                ),
                hP("textarea", {
                  className: "drawer-input",
                  value: form.win_loss_reason || "",
                  placeholder: "Why did we win or lose this one…",
                  onChange: (e) => set("win_loss_reason", e.target.value),
                  style: {
                    minHeight: "60px",
                    resize: "vertical",
                    fontSize: "14.5px",
                  },
                }),
              ),
              hP(
                "div",
                { className: "drawer-field", style: { gridColumn: "span 2" } },
                hP(
                  "label",
                  {
                    style: {
                      fontSize: "11.5px",
                      color: "var(--body-mono)",
                    },
                  },
                  "Notes",
                ),
                hP("textarea", {
                  className: "drawer-input",
                  value: form.notes || "",
                  placeholder: "Notes…",
                  onChange: (e) => set("notes", e.target.value),
                  style: {
                    minHeight: "60px",
                    resize: "vertical",
                    fontSize: "14.5px",
                  },
                }),
              ),
            ),
            hP(
              "button",
              {
                className: "btn btn-primary",
                onClick: () => onSave(form),
                style: { marginTop: "8px" },
              },
              hP("span", { className: "glint" }),
              "Save Details",
            ),
          ),

        dtab === "quotes" &&
          hP(
            PFrag,
            null,
            hP(
              "div",
              {
                className: "drawer-section-title",
                style: {
                  color: "var(--alabaster)",
                  borderColor: "var(--border-subtle)",
                  fontSize: "13px",
                },
              },
              "Quote History",
            ),
            hP(
              "div",
              { className: "drawer-grid" },
              inp("supplier_quote_price", "Active Quote Price/ea ($)"),
              inp("supplier_quote_date", "Quote Received (MM/DD/YY)"),
              inp("supplier_quote_expires", "Quote Expires (MM/DD/YY)"),
              inp("supplier_moq", "MOQ"),
            ),
            hP(
              "div",
              { className: "drawer-field", style: { marginTop: "8px" } },
              hP(
                "label",
                {
                  style: { fontSize: "11.5px", color: "var(--body-mono)" },
                },
                "Full Quote Log — paste all quotes received here",
              ),
              hP("textarea", {
                className: "drawer-input",
                value: form.quote_history || "",
                placeholder:
                  "03/07/26 — Cardinal Health $22.00/ea exp 04/07/26\n03/08/26 — Medline $19.50/ea exp 04/08/26",
                onChange: (e) => set("quote_history", e.target.value),
                style: {
                  minHeight: "120px",
                  resize: "vertical",
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "13.5px",
                },
              }),
            ),
            hP(
              "button",
              {
                className: "btn btn-primary",
                onClick: () => onSave(form),
                style: { marginTop: "12px" },
              },
              hP("span", { className: "glint" }),
              "Save Details",
            ),
          ),

        dtab === "nsn" &&
          hP(PFrag, null,
            hP("div", {
              className: "drawer-section-title",
              style: { color: "var(--accent-pink)", borderColor: "rgba(232,143,203,.25)", fontSize: "13px" },
            }, "NSN Intel — " + (record.nsn || "—") + " · FSC " + (record.fsc || "—")),
            hP("div", { className: "drawer-grid" },
              inp("nsn_win_count", "Times Won This NSN"),
              inp("nsn_loss_count", "Times Lost This NSN"),
              inp("nsn_avg_win_margin", "Avg Winning Margin % on This NSN"),
            ),
            hP("div", { className: "drawer-field", style: { marginTop: "8px" } },
              hP("label", { style: { fontSize: "11.5px", color: "var(--body-mono)" } },
                "NSN Notes — pricing patterns, supplier behavior, shelf life flags"),
              hP("textarea", {
                className: "drawer-input",
                value: form.nsn_notes || "",
                placeholder: "Cardinal Health always wins at ~22% margin on this NSN\nShelf life: 60 months, watch lot dates",
                onChange: (e) => set("nsn_notes", e.target.value),
                style: { minHeight: "120px", resize: "vertical", fontFamily: "JetBrains Mono,monospace", fontSize: "13.5px" },
              }),
            ),
            hP("button", { className: "btn btn-primary", onClick: () => onSave(form), style: { marginTop: "12px" } },
              hP("span", { className: "glint" }), "Save Details"),

            // ── WIN LEDGER ──────────────────────────────────────────────
            hP(WinLedgerPanel, { record }),
          ),

        dtab === "source" &&
          hP(
            PFrag,
            null,
            hP(
              "div",
              {
                className: "drawer-section-title",
                style: {
                  color: "var(--gold-solid)",
                  borderColor: "rgba(201,168,76,.3)",
                  fontSize: "13px",
                },
              },
              "◆ Source — " +
                (record.nsn || "No NSN") +
                " · FSC " +
                (record.fsc || "—"),
            ),
            DrawerSourcePanel
              ? hP(DrawerSourcePanel, { record })
              : hP(
                  "div",
                  {
                    style: {
                      color: "var(--amber)",
                      padding: "20px",
                      fontFamily: "JetBrains Mono,monospace",
                      fontSize: "12px",
                    },
                  },
                  "Source panel loading...",
                ),
          ),

        dtab === "email" &&
          hP(
            PFrag,
            null,
            hP(
              "div",
              {
                className: "drawer-section-title",
                style: {
                  color: "var(--accent-red-soft)",
                  borderColor: "rgba(232,116,116,.25)",
                  fontSize: "13px",
                },
              },
              "Quote Request Email",
            ),
            hP(
              "div",
              {
                style: {
                  marginBottom: "10px",
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "12.5px",
                  color: "var(--amber)",
                  letterSpacing: ".06em",
                },
              },
              "Auto-filled from record — edit before sending.",
            ),
            hP("textarea", {
              value: emailBody,
              onChange: (e) => setEmailBody(e.target.value),
              style: {
                width: "100%",
                minHeight: "300px",
                resize: "vertical",
                background: "var(--inset-bg)",
                border: "1px solid rgba(201,168,76,.2)",
                color: "var(--alabaster)",
                fontFamily: "JetBrains Mono,monospace",
                fontSize: "12.5px",
                padding: "12px 14px",
                outline: "none",
                lineHeight: "1.7",
                letterSpacing: ".02em",
                boxSizing: "border-box",
              },
            }),
            hP(
              "div",
              {
                style: {
                  display: "flex",
                  gap: "10px",
                  marginTop: "10px",
                  alignItems: "center",
                },
              },
              hP(
                "button",
                {
                  className: "btn btn-secondary",
                  onClick: copyEmail,
                  style: { padding: "7px 20px", fontSize: "12px" },
                },
                hP("span", { className: "glint" }),
                copied ? "✓ Copied" : "Copy Email",
              ),
              hP(
                "a",
                {
                  href:
                    "mailto:" +
                    (form.supplier_email || "") +
                    "?subject=" +
                    encodeURIComponent(
                      "RFQ – " +
                        (record.nsn || record.sol_number) +
                        " / " +
                        record.sol_number,
                    ) +
                    "&body=" +
                    encodeURIComponent(emailBody),
                  style: { textDecoration: "none" },
                },
                hP(
                  "button",
                  {
                    className: "btn btn-primary",
                    style: { padding: "7px 20px", fontSize: "12px" },
                  },
                  hP("span", { className: "glint" }),
                  "✉ Send via Email",
                ),
              ),
            ),
          ),

        dtab === "mfg_ref" &&
          hP(
            PFrag,
            null,
            hP(
              "div",
              {
                className: "drawer-section-title",
                style: {
                  color: "var(--gold-solid)",
                  borderColor: "rgba(201,168,76,.25)",
                  fontSize: "13px",
                },
              },
              "◆ MFG Reference Table · " + (record.sol_number || ""),
            ),
            window.SCC_TABS.MFGRefTable
              ? hP(window.SCC_TABS.MFGRefTable, { record, showToast })
              : hP(
                  "div",
                  {
                    style: {
                      color: "var(--amber)",
                      padding: "20px",
                      fontFamily: "JetBrains Mono,monospace",
                      fontSize: "12px",
                    },
                  },
                  "MFG Ref Table loading...",
                ),
          ),

        dtab === "records" && hP(SolRecordsPanel, { record, showToast }),
      ),
    );
  }

  // ── SOL RECORDS PANEL ────────────────────────────────────────────────
  function SolRecordsPanel({ record, showToast }) {
    const SR = window.SCC_RECORDS;
    const [recs, setRecs] = usePState([]);
    const [noteText, setNoteText] = usePState("");
    const [editingId, setEditingId] = usePState(null);
    const [editVal, setEditVal] = usePState("");
    const [loading, setLoading] = usePState(true);

    const refresh = async () => {
      if (!SR) return;
      const all = await SR.getRecords(record.sol_number);
      setRecs(all);
      setLoading(false);
    };

    usePEffect(() => { refresh(); }, [record.sol_number]);

    const addNote = async () => {
      if (!noteText.trim() || !SR) return;
      await SR.addRecord(record.sol_number, { type: "note", name: "Note", notes: noteText.trim() });
      setNoteText("");
      refresh();
    };

    const handleFile = async (e) => {
      if (!SR) return;
      const file = e.target.files[0];
      if (!file) return;
      const data = await file.arrayBuffer();
      await SR.addRecord(record.sol_number, {
        type: file.type.includes("pdf") ? "pdf" : file.type.startsWith("image") ? "image" : "doc",
        name: file.name,
        data,
        notes: "",
      });
      e.target.value = "";
      refresh();
    };

    const doRemove = async (id) => {
      await SR.removeRecord(id);
      refresh();
    };

    const saveEditNote = async (id) => {
      await SR.updateNotes(id, editVal);
      setEditingId(null);
      refresh();
    };

    const downloadRec = (r) => {
      if (!r.data) return;
      const blob = new Blob([r.data], { type: r.type === "pdf" ? "application/pdf" : r.type === "image" ? "image/*" : "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = r.name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    };

    const mono11 = { fontFamily: "JetBrains Mono,monospace", fontSize: "11px" };
    const labelStyle = { fontFamily: "Cinzel,serif", fontSize: "9px", letterSpacing: ".12em",
      textTransform: "uppercase", color: "var(--body-faint)", marginBottom: "5px" };
    const iconFor = (type) => type === "pdf" ? "📄" : type === "image" ? "🖼" : type === "note" ? "📝" : "📎";

    if (!SR) return hP("div", { style: { padding: "20px", color: "var(--body-dim)", ...mono11 } },
      "Sol Records module not loaded.");

    return hP("div", null,
      hP("div", { className: "drawer-section-title",
        style: { color: "var(--gold-solid)", borderColor: "rgba(201,168,76,.3)", fontSize: "13px" } },
        "📁 Sol Records · " + record.sol_number),
      hP("div", { style: { fontFamily: "Cormorant Garamond,serif", fontStyle: "italic", fontSize: "12px",
        color: "var(--body-faint)", marginBottom: "16px" } },
        "Permanent record file · 4-year retention · store anything related to this solicitation"),

      // File upload
      hP("div", { style: { marginBottom: "12px" } },
        hP("div", { style: labelStyle }, "Attach File (PDF, image, doc)"),
        hP("input", { type: "file", accept: ".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,.txt",
          onChange: handleFile,
          style: { color: "var(--alabaster)", ...mono11, cursor: "pointer" } }),
      ),

      // Add note
      hP("div", { style: { marginBottom: "16px", background: "var(--inset-bg)",
        border: "1px solid rgba(201,168,76,.15)", borderTop: "2px solid rgba(201,168,76,.3)", padding: "12px 14px" } },
        hP("div", { style: labelStyle }, "+ Add Note"),
        hP("textarea", {
          value: noteText, onChange: e => setNoteText(e.target.value),
          placeholder: "Quote details, vendor conversation, discrepancy notes, delivery updates…",
          style: { width: "100%", minHeight: "80px", background: "var(--inset-bg)", resize: "vertical",
            border: "1px solid rgba(201,168,76,.2)", color: "var(--alabaster)", ...mono11,
            padding: "8px 10px", outline: "none", boxSizing: "border-box" },
        }),
        hP("button", {
          onClick: addNote, disabled: !noteText.trim(),
          style: { marginTop: "8px", background: "rgba(201,168,76,.1)", border: "1px solid rgba(201,168,76,.35)",
            color: "var(--gold-solid)", fontFamily: "Cinzel,serif", fontSize: "9px",
            letterSpacing: ".1em", padding: "5px 14px", cursor: "pointer" }
        }, "Add Note"),
      ),

      // Records list
      loading
        ? hP("div", { style: { ...mono11, color: "var(--body-faint)" } }, "Loading…")
        : recs.length === 0
        ? hP("div", { style: { ...mono11, fontStyle: "italic", color: "var(--body-faint)", padding: "8px 0" } },
            "No records yet. Attach the solicitation PDF and any correspondence here.")
        : hP("div", { style: { display: "flex", flexDirection: "column", gap: "8px" } },
            ...recs.map(r => hP("div", { key: r.id,
              style: { background: "var(--inset-bg)", border: "1px solid rgba(201,168,76,.12)",
                borderLeft: r.type === "note" ? "3px solid rgba(201,168,76,.4)" : "3px solid rgba(90,120,200,.5)",
                padding: "10px 12px" }
            },
              hP("div", { style: { display: "flex", alignItems: "flex-start", gap: "8px" } },
                hP("span", null, iconFor(r.type)),
                hP("div", { style: { flex: 1 } },
                  hP("div", { style: { fontFamily: "Cinzel,serif", fontSize: "11px", color: "var(--alabaster)", marginBottom: "2px" } }, r.name),
                  hP("div", { style: { ...mono11, fontSize: "9px", color: "var(--body-faint)" } },
                    new Date(r.added).toLocaleDateString() + " " + new Date(r.added).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })),
                  r.type === "note" && editingId !== r.id
                    ? hP("div", { style: { ...mono11, color: "var(--body-dim)", marginTop: "5px", whiteSpace: "pre-wrap" } }, r.notes)
                    : r.type === "note" && editingId === r.id
                    ? hP("div", null,
                        hP("textarea", {
                          value: editVal, onChange: e => setEditVal(e.target.value),
                          style: { width: "100%", minHeight: "70px", background: "var(--surface-card)",
                            border: "1px solid rgba(201,168,76,.3)", color: "var(--alabaster)", ...mono11,
                            padding: "6px 8px", outline: "none", boxSizing: "border-box", resize: "vertical" }
                        }),
                        hP("button", { onClick: () => saveEditNote(r.id),
                          style: { marginTop: "4px", marginRight: "6px", background: "rgba(201,168,76,.1)",
                            border: "1px solid rgba(201,168,76,.3)", color: "var(--gold-dim)",
                            fontFamily: "Cinzel,serif", fontSize: "9px", letterSpacing: ".08em",
                            padding: "3px 10px", cursor: "pointer" } }, "Save"),
                        hP("button", { onClick: () => setEditingId(null),
                          style: { background: "transparent", border: "none", color: "var(--body-faint)",
                            fontFamily: "Cinzel,serif", fontSize: "9px", cursor: "pointer" } }, "Cancel"),
                      )
                    : r.notes
                    ? hP("div", { style: { ...mono11, fontSize: "10px", color: "var(--body-faint)", marginTop: "4px", fontStyle: "italic" } }, r.notes)
                    : null,
                ),
                hP("div", { style: { display: "flex", flexDirection: "column", gap: "4px" } },
                  r.data && hP("button", { onClick: () => downloadRec(r),
                    style: { background: "transparent", border: "1px solid rgba(90,120,200,.3)",
                      color: "var(--accent-blue-bright)", fontFamily: "Cinzel,serif", fontSize: "9px",
                      letterSpacing: ".06em", padding: "2px 8px", cursor: "pointer", whiteSpace: "nowrap" }
                  }, "Download"),
                  r.type === "note" && hP("button", {
                    onClick: () => { setEditingId(r.id); setEditVal(r.notes || ""); },
                    style: { background: "transparent", border: "1px solid rgba(201,168,76,.2)",
                      color: "var(--gold-dim)", fontFamily: "Cinzel,serif", fontSize: "9px",
                      letterSpacing: ".06em", padding: "2px 8px", cursor: "pointer" }
                  }, "Edit"),
                  hP("button", { onClick: () => doRemove(r.id),
                    style: { background: "transparent", border: "1px solid rgba(231,76,60,.2)",
                      color: "rgba(231,76,60,.5)", fontFamily: "Cinzel,serif", fontSize: "9px",
                      letterSpacing: ".06em", padding: "2px 8px", cursor: "pointer" },
                    onMouseEnter: e => { e.target.style.color = "#e74c3c"; },
                    onMouseLeave: e => { e.target.style.color = "rgba(231,76,60,.5)"; },
                  }, "Remove"),
                ),
              ),
            ))
          ),
    );
  }

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.Drawer = Drawer;
})();
