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

  // ── DRAWER ───────────────────────────────────────────────────────────
  function Drawer({ record, onSave, showToast }) {
    // Components resolved at render time to avoid load-order undefined errors
    const DrawerSourcePanel = window.SCC_TABS.DrawerSourcePanel || null;
    const VendorIntelPanel = window.SCC_TABS.VendorIntelPanel || null;
    const AwardsIntelPanel = window.SCC_TABS.AwardsIntelPanel || null;
    const [dtab, setDtab] = usePState("supplier");
    const [form, setForm] = usePState({
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
      ["mfg_ref", "◆ MFG Quotes"],
      ["source", "◆ Source"],
      ["email", "Email"],
    ];

    return hP(
      "div",
      { className: "drawer-inner" },
      hP("div", {
        style: {
          display: "flex", alignItems: "center", gap: "8px",
          padding: "6px 14px 4px",
          borderBottom: "1px solid rgba(201,168,76,.15)",
          background: "rgba(201,168,76,.03)",
        }
      },
        hP("span", {
          style: {
            width: "7px", height: "7px", borderRadius: "50%",
            background: "#C9A84C", boxShadow: "0 0 6px #C9A84C88",
            animation: "pulse 2s infinite", display: "inline-block", flexShrink: 0,
          }
        }),
        hP("span", {
          style: {
            fontFamily: "Cinzel,serif", fontSize: "9px", letterSpacing: ".1em",
            color: "var(--gold-dim)", textTransform: "uppercase",
          }
        }, "Working · " + (record.sol_number || "") + " · " + (record.item_name || "")),
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

        dtab === "supplier" &&
          hP(
            PFrag,
            null,
            hP(
              "div",
              {
                className: "drawer-section-title",
                style: {
                  color: "var(--accent-blue)",
                  borderColor: "rgba(126,184,247,.25)",
                  fontSize: "13px",
                },
              },
              "Supplier Intelligence",
            ),
            hP(
              "div",
              { className: "drawer-grid" },
              inp("supplier_website", "Website"),
              inp("supplier_phone", "Phone"),
              inp("supplier_email", "Email"),
              inp("supplier_poc", "Point of Contact"),
              inp("supplier_quote_price", "Quote Price/ea ($)"),
              inp("supplier_quote_date", "Quote Date (MM/DD/YY)"),
              inp("supplier_quote_expires", "Quote Expires (MM/DD/YY)"),
              inp("supplier_lead_time", "Lead Time (days)"),
              inp("supplier_moq", "MOQ"),
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
          hP(
            PFrag,
            null,
            hP(
              "div",
              {
                className: "drawer-section-title",
                style: {
                  color: "var(--accent-pink)",
                  borderColor: "rgba(232,143,203,.25)",
                  fontSize: "13px",
                },
              },
              "NSN Intel — " +
                (record.nsn || "—") +
                " · FSC " +
                (record.fsc || "—"),
            ),
            hP(
              "div",
              { className: "drawer-grid" },
              inp("nsn_win_count", "Times Won This NSN"),
              inp("nsn_loss_count", "Times Lost This NSN"),
              inp("nsn_avg_win_margin", "Avg Winning Margin % on This NSN"),
            ),
            hP(
              "div",
              { className: "drawer-field", style: { marginTop: "8px" } },
              hP(
                "label",
                {
                  style: { fontSize: "11.5px", color: "var(--body-mono)" },
                },
                "NSN Notes — pricing patterns, supplier behavior, shelf life flags",
              ),
              hP("textarea", {
                className: "drawer-input",
                value: form.nsn_notes || "",
                placeholder:
                  "Cardinal Health always wins at ~22% margin on this NSN\nShelf life: 60 months, watch lot dates",
                onChange: (e) => set("nsn_notes", e.target.value),
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
    ),
    );
  }

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.Drawer = Drawer;
})();
