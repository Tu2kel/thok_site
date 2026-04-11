(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — PIPELINE TAB + DRAWER + VENDOR INTEL PANEL
  //  Pre-compiled React · No Babel · No JSX
  // ═══════════════════════════════════════════════════════════════════════

  const {
    createElement: hP,
    useState: usePState,
    useEffect: usePEffect,
    Fragment: PFrag,
  } = React;

  const VI_STATUSES = ["confirmed", "quoted", "pending", "no_stock"];

  // ── VENDOR INTEL PANEL ───────────────────────────────────────────────
  function VendorIntelPanel({ record, showToast }) {
    const { DISTRIBUTORS, FSC_LANES_MAP, getDistsByFSC } = window.SCC_DIST;
    const { viSave, viGetByNSN, viDelete } = window.SCC_DB;
    const { VI_STATUS_STYLE } = window.SCC_TABS;

    const nsn = record.nsn || "";
    const fsc = record.fsc || "";
    const [entries, setEntries] = usePState([]);
    const [form, setFormVI] = usePState({
      vendor_name: "",
      vendor_id: "",
      part_number: "",
      unit_price: "",
      lead_time: "",
      moq: "",
      notes: "",
      status: "quoted",
    });
    const [loading, setLoading] = usePState(true);
    const set = (k, v) => setFormVI((f) => ({ ...f, [k]: v }));

    usePEffect(() => {
      if (!nsn) {
        setLoading(false);
        return;
      }
      viGetByNSN(nsn).then((e) => {
        setEntries(e);
        setLoading(false);
      });
    }, [nsn]);

    usePEffect(() => {
      if (form.vendor_id) {
        const d = DISTRIBUTORS.find((d) => d.id === form.vendor_id);
        if (d) setFormVI((f) => ({ ...f, vendor_name: d.name }));
      }
    }, [form.vendor_id]);

    const handleAdd = async () => {
      if (!form.vendor_name && !form.vendor_id) {
        showToast("Vendor name required", true);
        return;
      }
      const vname =
        form.vendor_name ||
        DISTRIBUTORS.find((d) => d.id === form.vendor_id)?.name ||
        form.vendor_id;
      const vid = form.vendor_id || vname.toLowerCase().replace(/\s+/g, "_");
      const rec = {
        id: nsn + "::" + vid + "::" + Date.now(),
        nsn,
        fsc,
        vendor_id: vid,
        vendor_name: vname,
        part_number: form.part_number,
        unit_price: form.unit_price ? parseFloat(form.unit_price) : null,
        lead_time: form.lead_time,
        moq: form.moq,
        notes: form.notes,
        status: form.status,
        sol_number: record.sol_number,
        last_updated: new Date().toLocaleDateString(),
      };
      await viSave(rec);
      const updated = await viGetByNSN(nsn);
      setEntries(updated);
      setFormVI({
        vendor_name: "",
        vendor_id: "",
        part_number: "",
        unit_price: "",
        lead_time: "",
        moq: "",
        notes: "",
        status: "quoted",
      });
      showToast(vname + " logged for NSN " + nsn);
    };

    const handleDelete = async (id) => {
      await viDelete(id);
      setEntries((e) => e.filter((r) => r.id !== id));
    };
    const handleStatusChange = async (entry, newStatus) => {
      const updated = {
        ...entry,
        status: newStatus,
        last_updated: new Date().toLocaleDateString(),
      };
      await viSave(updated);
      setEntries((e) => e.map((r) => (r.id === entry.id ? updated : r)));
    };

    const viInp = (k, lbl, type = "text", placeholder = "") =>
      hP(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "4px" } },
        hP(
          "label",
          {
            style: {
              fontFamily: "JetBrains Mono,monospace",
              fontSize: "11.5px",
              color: "var(--gold-mid)",
              textTransform: "uppercase",
              letterSpacing: ".08em",
            },
          },
          lbl,
        ),
        hP("input", {
          type,
          step: type === "number" ? "0.01" : undefined,
          value: form[k],
          placeholder,
          onChange: (e) => set(k, e.target.value),
          style: {
            padding: "7px 10px",
            background: "var(--inset-bg)",
            border: "1px solid rgba(201,168,76,.2)",
            color: "var(--alabaster)",
            fontFamily: "JetBrains Mono,monospace",
            fontSize: "14.5px",
            outline: "none",
            width: "100%",
          },
        }),
      );

    return hP(
      "div",
      null,
      !loading &&
        entries.length > 0 &&
        hP(
          "div",
          { style: { marginBottom: "20px" } },
          hP(
            "div",
            {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: "9px",
                letterSpacing: ".18em",
                textTransform: "uppercase",
                color: "var(--gold-dim)",
                marginBottom: "10px",
                display: "flex",
                alignItems: "center",
                gap: "10px",
              },
            },
            hP("span", null, "Vendor Intel — NSN " + nsn),
            hP(
              "span",
              {
                style: {
                  padding: "2px 8px",
                  borderRadius: "99px",
                  background: "rgba(201,168,76,.1)",
                  border: "1px solid rgba(201,168,76,.2)",
                  fontSize: "9px",
                },
              },
              entries.length + " vendor" + (entries.length !== 1 ? "s" : ""),
            ),
          ),
          hP(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: "8px" } },
            ...entries.map((e, i) => {
              const ss = (VI_STATUS_STYLE || {})[e.status] ||
                (VI_STATUS_STYLE || {}).pending || {
                  bg: "transparent",
                  border: "rgba(201,168,76,.3)",
                  color: "var(--gold-solid)",
                };
              return hP(
                "div",
                {
                  key: e.id,
                  style: {
                    background: "var(--surface-sheen)",
                    border: "1px solid rgba(201,168,76,.15)",
                    borderLeft:
                      "3px solid " +
                      (i === 0 ? "#3dd68c" : "rgba(201,168,76,.3)"),
                    padding: "12px 14px",
                    position: "relative",
                  },
                },
                i === 0 &&
                  hP(
                    "div",
                    {
                      style: {
                        position: "absolute",
                        top: "8px",
                        right: "10px",
                        fontFamily: "Cinzel,serif",
                        fontSize: "7px",
                        letterSpacing: ".1em",
                        color: "var(--accent-green)",
                        textTransform: "uppercase",
                      },
                    },
                    "★ Primary",
                  ),
                hP(
                  "div",
                  {
                    style: {
                      display: "flex",
                      alignItems: "baseline",
                      gap: "10px",
                      marginBottom: "6px",
                      flexWrap: "wrap",
                    },
                  },
                  hP(
                    "span",
                    {
                      style: {
                        fontFamily: "Cinzel,serif",
                        fontSize: "14px",
                        color: "var(--gold-solid)",
                        letterSpacing: ".06em",
                      },
                    },
                    e.vendor_name,
                  ),
                  e.part_number &&
                    hP(
                      "span",
                      {
                        style: {
                          fontFamily: "JetBrains Mono,monospace",
                          fontSize: "12px",
                          color: "var(--accent-green-bright)",
                        },
                      },
                      "P/N " + e.part_number,
                    ),
                  e.unit_price != null &&
                    hP(
                      "span",
                      {
                        style: {
                          fontFamily: "JetBrains Mono,monospace",
                          fontSize: "13px",
                          fontWeight: "700",
                          background:
                            "linear-gradient(to bottom,#cf972d,#f9f295,#e0aa3e)",
                          WebkitBackgroundClip: "text",
                          WebkitTextFillColor: "transparent",
                        },
                      },
                      "$" + parseFloat(e.unit_price).toFixed(2) + "/ea",
                    ),
                ),
                hP(
                  "div",
                  {
                    style: {
                      display: "flex",
                      gap: "8px",
                      flexWrap: "wrap",
                      alignItems: "center",
                    },
                  },
                  hP(
                    "select",
                    {
                      value: e.status,
                      onChange: (ev) => handleStatusChange(e, ev.target.value),
                      style: {
                        background: ss.bg,
                        border: "1px solid " + ss.border,
                        color: ss.color,
                        fontFamily: "Cinzel,serif",
                        fontSize: "8px",
                        letterSpacing: ".08em",
                        padding: "3px 8px",
                        cursor: "pointer",
                        outline: "none",
                        textTransform: "uppercase",
                      },
                    },
                    ...VI_STATUSES.map((s) =>
                      hP(
                        "option",
                        {
                          key: s,
                          value: s,
                          style: {
                            background: "var(--surface-inset)",
                            color: "var(--alabaster)",
                          },
                        },
                        s,
                      ),
                    ),
                  ),
                  e.lead_time &&
                    hP(
                      "span",
                      {
                        style: {
                          fontFamily: "JetBrains Mono,monospace",
                          fontSize: "10px",
                          color: "var(--body-dim)",
                        },
                      },
                      "Lead: " + e.lead_time,
                    ),
                  e.moq &&
                    hP(
                      "span",
                      {
                        style: {
                          fontFamily: "JetBrains Mono,monospace",
                          fontSize: "10px",
                          color: "var(--body-dim)",
                        },
                      },
                      "MOQ: " + e.moq,
                    ),
                  e.notes &&
                    hP(
                      "span",
                      {
                        style: {
                          fontFamily: "Cormorant Garamond,serif",
                          fontSize: "12px",
                          fontStyle: "italic",
                          color: "var(--body-faint)",
                        },
                      },
                      e.notes,
                    ),
                  hP(
                    "button",
                    {
                      onClick: () => handleDelete(e.id),
                      style: {
                        marginLeft: "auto",
                        background: "transparent",
                        border: "none",
                        color: "var(--accent-red-dim)",
                        cursor: "pointer",
                        fontSize: "12px",
                      },
                    },
                    "✕",
                  ),
                ),
              );
            }),
          ),
        ),

      loading &&
        hP(
          "div",
          {
            style: {
              padding: "20px",
              fontFamily: "Cinzel,serif",
              fontSize: "10px",
              color: "var(--gold-dim)",
              letterSpacing: ".1em",
            },
          },
          "Loading vendor intel…",
        ),
      !loading &&
        entries.length === 0 &&
        nsn &&
        hP(
          "div",
          {
            style: {
              padding: "14px",
              marginBottom: "16px",
              border: "1px solid rgba(201,168,76,.1)",
              background: "rgba(201,168,76,.03)",
              fontFamily: "Cormorant Garamond,serif",
              fontSize: "14px",
              fontStyle: "italic",
              color: "var(--body-faint)",
            },
          },
          "No vendors logged for NSN " +
            nsn +
            " yet — add the first one below.",
        ),

      hP(
        "div",
        {
          style: {
            borderTop: "1px solid rgba(201,168,76,.1)",
            paddingTop: "16px",
          },
        },
        hP(
          "div",
          {
            style: {
              fontFamily: "Cinzel,serif",
              fontSize: "9px",
              letterSpacing: ".18em",
              textTransform: "uppercase",
              color: "var(--gold-dim)",
              marginBottom: "12px",
            },
          },
          "◆ Log Vendor — writes to global NSN intel table",
        ),
        hP(
          "div",
          { style: { marginBottom: "12px" } },
          hP(
            "div",
            {
              style: {
                fontFamily: "JetBrains Mono,monospace",
                fontSize: "10px",
                color: "var(--gold-dim)",
                textTransform: "uppercase",
                letterSpacing: ".08em",
                marginBottom: "6px",
              },
            },
            "Quick Select Distributor",
          ),
          hP(
            "select",
            {
              value: form.vendor_id,
              onChange: (e) => set("vendor_id", e.target.value),
              style: {
                width: "100%",
                padding: "8px 10px",
                background: "var(--inset-bg)",
                border: "1px solid rgba(201,168,76,.2)",
                color: "var(--alabaster)",
                fontFamily: "JetBrains Mono,monospace",
                fontSize: "13px",
                outline: "none",
              },
            },
            hP("option", { value: "" }, "— select or type below —"),
            ...(fsc && getDistsByFSC(fsc).length
              ? getDistsByFSC(fsc)
              : DISTRIBUTORS.slice(0, 30)
            ).map((d) =>
              hP(
                "option",
                {
                  key: d.id,
                  value: d.id,
                  style: { background: "var(--surface-inset)" },
                },
                d.name + " · T" + d.tier + " · " + d.friction,
              ),
            ),
            hP(
              "optgroup",
              {
                label: "──── All 120 Distributors ────",
                style: { color: "var(--gold-dim)" },
              },
              ...DISTRIBUTORS.map((d) =>
                hP(
                  "option",
                  {
                    key: d.id + "_all",
                    value: d.id,
                    style: { background: "var(--surface-inset)" },
                  },
                  d.name,
                ),
              ),
            ),
          ),
        ),
        hP(
          "div",
          {
            style: {
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "10px",
              marginBottom: "10px",
            },
          },
          viInp(
            "vendor_name",
            "Vendor Name (if not in list)",
            "text",
            "e.g. Cardinal Health",
          ),
          viInp("part_number", "Part Number", "text", "e.g. MDS093945"),
          viInp("unit_price", "Unit Price / ea ($)", "number", "0.00"),
          viInp("lead_time", "Lead Time", "text", "e.g. 5 days ARO"),
          viInp("moq", "MOQ", "text", "e.g. 10 EA"),
          hP(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: "4px" } },
            hP(
              "label",
              {
                style: {
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "10px",
                  color: "var(--gold-dim)",
                  textTransform: "uppercase",
                  letterSpacing: ".08em",
                },
              },
              "Status",
            ),
            hP(
              "select",
              {
                value: form.status,
                onChange: (e) => set("status", e.target.value),
                style: {
                  padding: "7px 10px",
                  background: "var(--inset-bg)",
                  border: "1px solid rgba(201,168,76,.2)",
                  color: "var(--alabaster)",
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "13px",
                  outline: "none",
                },
              },
              ...VI_STATUSES.map((s) =>
                hP(
                  "option",
                  {
                    key: s,
                    value: s,
                    style: {
                      background: "var(--surface-inset)",
                      textTransform: "capitalize",
                    },
                  },
                  s,
                ),
              ),
            ),
          ),
        ),
        hP(
          "div",
          { style: { marginBottom: "12px" } },
          hP(
            "label",
            {
              style: {
                fontFamily: "JetBrains Mono,monospace",
                fontSize: "10px",
                color: "var(--gold-dim)",
                textTransform: "uppercase",
                letterSpacing: ".08em",
                display: "block",
                marginBottom: "4px",
              },
            },
            "Notes",
          ),
          hP("input", {
            value: form.notes,
            onChange: (e) => set("notes", e.target.value),
            placeholder:
              "e.g. confirmed stock, net 30, preferred contact: Jane",
            style: {
              width: "100%",
              padding: "7px 10px",
              background: "var(--inset-bg)",
              border: "1px solid rgba(201,168,76,.2)",
              color: "var(--alabaster)",
              fontFamily: "JetBrains Mono,monospace",
              fontSize: "13px",
              outline: "none",
            },
          }),
        ),
        hP(
          "button",
          {
            className: "btn btn-primary",
            onClick: handleAdd,
            style: { fontSize: "11px", padding: "10px 24px" },
          },
          hP("span", { className: "glint" }),
          "◆ Log Vendor to Global Intel",
        ),
      ),
    );
  }

  // ── DRAWER ───────────────────────────────────────────────────────────
  function Drawer({ record, onSave, showToast }) {
    const { DrawerSourcePanel } = window.SCC_TABS;
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

    // ── CHANGE 1: Added ["awards_intel", "◇ Awards Intel"] to DRAWER_TABS ──
    const DRAWER_TABS = [
      ["supplier", "Supplier Intel"],
      ["vendor_intel", "◆ Vendor Intel"],
      ["bid", "Bid & Outcome"],
      ["quotes", "Quote History"],
      ["nsn", "NSN Intel"],
      ["awards_intel", "◇ Awards Intel"],
      ["source", "◆ Source"],
      ["email", "Email"],
    ];

    return hP(
      "div",
      { className: "drawer-inner" },
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
            hP(VendorIntelPanel, {
              record,
              showToast: showToast || (() => {}),
            }),
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

        // ── CHANGE 2: Awards Intel drawer tab render branch ──
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
                  borderColor: "rgba(201,168,76,.25)",
                  fontSize: "13px",
                },
              },
              "◇ Awards Intel — " +
                (record.nsn || "No NSN") +
                " · FSC " +
                (record.fsc || "—"),
            ),
            hP(window.SCC_TABS.AwardsIntelPanel, { record }),
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
            hP(DrawerSourcePanel, { record }),
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
    );
  }

  // ── PIPELINE TAB ─────────────────────────────────────────────────────
  const BID_BANDS = {
    All: [0, Infinity],
    "<10K": [0, 9999.99],
    "10K–50K": [10000, 49999.99],
    "50K–100K": [50000, 99999.99],
    "100K+": [100000, Infinity],
  };
  const BAND_COLORS = {
    "<10K": "rgba(154,184,255,.8)",
    "10K–50K": "rgba(201,168,76,.9)",
    "50K–100K": "rgba(61,214,140,.85)",
    "100K+": "rgba(249,242,149,.95)",
    All: "var(--gold-solid)",
  };

  // ── QUOTE INGEST OVERLAY ─────────────────────────────────────────────
  function QuoteIngestOverlay({ rows, onClose, showToast }) {
    const { viSave, dbSave, dbGetAll } = window.SCC_DB;

    const STEPS = {
      SOL: "sol",
      DROP: "drop",
      PARSING: "parsing",
      PREVIEW: "preview",
      DONE: "done",
    };
    const [step, setStep] = usePState(STEPS.SOL);
    const [solInput, setSolInput] = usePState("");
    const [solRecord, setSolRecord] = usePState(null);
    const [dragging, setDragging] = usePState(false);
    const [parsed, setParsed] = usePState(null);
    const [saving, setSaving] = usePState(false);
    const [error, setError] = usePState("");

    const suggestions =
      solInput.length >= 3
        ? rows
            .filter((r) =>
              r.sol_number.toLowerCase().includes(solInput.toLowerCase()),
            )
            .slice(0, 6)
        : [];

    const confirmSol = (sol) => {
      const rec = rows.find((r) => r.sol_number === sol);
      if (!rec) {
        setError("Sol number not found in active pipeline.");
        return;
      }
      setSolRecord(rec);
      setSolInput(rec.sol_number);
      setError("");
      setStep(STEPS.DROP);
    };

    const readFileAsBase64 = (file) =>
      new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result.split(",")[1]);
        r.onerror = () => rej(new Error("Read failed"));
        r.readAsDataURL(file);
      });

    const parseQuote = async (file) => {
      setStep(STEPS.PARSING);
      setError("");
      try {
        const b64 = await readFileAsBase64(file);
        const prompt = `You are parsing a vendor quote PDF for a government procurement company.
Extract the following fields and return ONLY valid JSON, no markdown, no explanation:
{
  "vendor_name": "",
  "vendor_website": "",
  "vendor_phone": "",
  "vendor_email": "",
  "vendor_poc": "",
  "part_number": "",
  "unit_price": null,
  "quantity": null,
  "unit_of_issue": "",
  "quote_date": "",
  "quote_expires": "",
  "lead_time": "",
  "moq": "",
  "shipping_notes": "",
  "notes": ""
}

Sol context:
- Sol Number: ${solRecord.sol_number}
- Item: ${solRecord.item_name || ""}
- NSN: ${solRecord.nsn || ""}
- Gov Qty: ${solRecord.quantity || ""}

Rules:
- unit_price must be a number (no $ signs)
- quantity must be a number
- quote_date and quote_expires as MM/DD/YYYY
- lead_time as plain string e.g. "5 days ARO"
- If a field is not found, use null or empty string
- shipping_notes: capture any shipping cost, method, liftgate requirements
- notes: any other relevant vendor notes`;

        const resp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 1000,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "document",
                    source: {
                      type: "base64",
                      media_type: "application/pdf",
                      data: b64,
                    },
                  },
                  { type: "text", text: prompt },
                ],
              },
            ],
          }),
        });
        const data = await resp.json();
        const text = (data.content || []).map((c) => c.text || "").join("");
        const clean = text.replace(/```json|```/g, "").trim();
        const result = JSON.parse(clean);
        setParsed(result);
        setStep(STEPS.PREVIEW);
      } catch (e) {
        setError("Parse failed: " + e.message);
        setStep(STEPS.DROP);
      }
    };

    const handleDrop = (e) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (!file || file.type !== "application/pdf") {
        setError("Drop a PDF file.");
        return;
      }
      parseQuote(file);
    };

    const handleFileInput = (e) => {
      const file = e.target.files[0];
      if (file) parseQuote(file);
    };

    const updateParsed = (k, v) => setParsed((p) => ({ ...p, [k]: v }));

    const handleConfirm = async () => {
      setSaving(true);
      try {
        const allSols = await dbGetAll();
        const existing =
          allSols.find((x) => x.sol_number === solRecord.sol_number) ||
          solRecord;
        const updatedSol = {
          ...existing,
          supplier_website: parsed.vendor_website || existing.supplier_website,
          supplier_phone: parsed.vendor_phone || existing.supplier_phone,
          supplier_email: parsed.vendor_email || existing.supplier_email,
          supplier_poc: parsed.vendor_poc || existing.supplier_poc,
          supplier_quote_price:
            parsed.unit_price != null
              ? String(parsed.unit_price)
              : existing.supplier_quote_price,
          supplier_quote_date:
            parsed.quote_date || existing.supplier_quote_date,
          supplier_quote_expires:
            parsed.quote_expires || existing.supplier_quote_expires,
          supplier_lead_time: parsed.lead_time || existing.supplier_lead_time,
          supplier_moq: parsed.moq || existing.supplier_moq,
          notes:
            [existing.notes, parsed.shipping_notes, parsed.notes]
              .filter(Boolean)
              .join(" | ") || existing.notes,
        };
        await dbSave(updatedSol);

        if (solRecord.nsn && parsed.vendor_name) {
          const pn = (parsed.part_number || "NOPART")
            .toUpperCase()
            .replace(/\s+/g, "_");
          const vid = (parsed.vendor_name || "unknown")
            .toLowerCase()
            .replace(/\s+/g, "_");
          const viRec = {
            id: solRecord.nsn + "::" + pn + "::" + vid + "::" + Date.now(),
            nsn: solRecord.nsn,
            fsc: solRecord.fsc || "",
            vendor_id: vid,
            vendor_name: parsed.vendor_name,
            part_number: parsed.part_number || "",
            unit_price: parsed.unit_price,
            lead_time: parsed.lead_time || "",
            moq: parsed.moq || "",
            notes: [parsed.shipping_notes, parsed.notes]
              .filter(Boolean)
              .join(" · "),
            status: "quoted",
            sol_number: solRecord.sol_number,
            last_updated: new Date().toLocaleDateString(),
          };
          await viSave(viRec);
        }

        showToast(
          "Quote ingested — " +
            (parsed.vendor_name || "vendor") +
            " saved to " +
            solRecord.sol_number,
        );
        setStep(STEPS.DONE);
        setTimeout(() => onClose(), 1200);
      } catch (e) {
        setError("Save failed: " + e.message);
        setSaving(false);
      }
    };

    const overlay = {
      position: "fixed",
      inset: 0,
      zIndex: 9999,
      background: "var(--surface-inset)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      backdropFilter: "blur(6px)",
      animation: "fadeUp .25s ease both",
    };
    const card = {
      background: "var(--surface-sheen)",
      border: "1px solid rgba(201,168,76,.25)",
      width: "620px",
      maxWidth: "95vw",
      maxHeight: "90vh",
      overflowY: "auto",
      padding: "36px 40px",
      position: "relative",
      boxShadow: "0 32px 80px rgba(0,0,0,.7)",
    };
    const goldTxt = {
      fontFamily: "Cinzel,serif",
      background:
        "linear-gradient(to bottom,#cf972d 22%,#f9f295 45%,#e0aa3e 50%,#b8860b 55%,#f9f295 78%)",
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent",
    };
    const inp = {
      width: "100%",
      padding: "11px 14px",
      background: "var(--inset-bg)",
      border: "1px solid rgba(201,168,76,.25)",
      color: "var(--alabaster)",
      fontFamily: "JetBrains Mono,monospace",
      fontSize: "14px",
      outline: "none",
      boxSizing: "border-box",
      letterSpacing: ".03em",
    };
    const lbl = {
      fontFamily: "Cinzel,serif",
      fontSize: "10px",
      letterSpacing: ".16em",
      color: "var(--gold-mid)",
      textTransform: "uppercase",
      display: "block",
      marginBottom: "6px",
    };
    const fieldRow = (label, key, type = "text") =>
      hP(
        "div",
        { style: { marginBottom: "14px" } },
        hP("label", { style: lbl }, label),
        hP("input", {
          type,
          value: parsed[key] || "",
          onChange: (e) => updateParsed(key, e.target.value),
          style: inp,
        }),
      );

    return hP(
      "div",
      {
        style: overlay,
        onClick: (e) => {
          if (e.target === e.currentTarget) onClose();
        },
      },
      hP(
        "div",
        { style: card },
        hP(
          "button",
          {
            onClick: onClose,
            style: {
              position: "absolute",
              top: "16px",
              right: "20px",
              background: "transparent",
              border: "none",
              color: "var(--body-faint)",
              fontSize: "20px",
              cursor: "pointer",
              lineHeight: "1",
            },
          },
          "✕",
        ),
        hP(
          "div",
          { style: { marginBottom: "28px" } },
          hP(
            "div",
            {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: "11px",
                letterSpacing: ".22em",
                color: "var(--gold-dim)",
                textTransform: "uppercase",
                marginBottom: "6px",
              },
            },
            "◆ Quote Ingestion",
          ),
          hP(
            "div",
            {
              style: {
                ...goldTxt,
                fontSize: "22px",
                letterSpacing: ".1em",
                fontFamily: "Cinzel,serif",
              },
            },
            step === STEPS.SOL
              ? "Enter Sol Number"
              : step === STEPS.DROP
                ? "Drop Vendor Quote PDF"
                : step === STEPS.PARSING
                  ? "Reading Quote…"
                  : step === STEPS.PREVIEW
                    ? "Confirm Extracted Fields"
                    : "✓ Quote Saved",
          ),
          solRecord &&
            step !== STEPS.SOL &&
            hP(
              "div",
              {
                style: {
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "12px",
                  color: "var(--body-dim)",
                  marginTop: "6px",
                },
              },
              solRecord.sol_number +
                " · " +
                (solRecord.item_name || "") +
                (solRecord.nsn ? " · NSN " + solRecord.nsn : ""),
            ),
        ),

        step === STEPS.SOL &&
          hP(
            "div",
            null,
            hP("label", { style: lbl }, "Sol Number"),
            hP(
              "div",
              { style: { position: "relative" } },
              hP("input", {
                value: solInput,
                onChange: (e) => {
                  setSolInput(e.target.value);
                  setError("");
                },
                onKeyDown: (e) => {
                  if (e.key === "Enter" && solInput)
                    confirmSol(solInput.trim());
                },
                placeholder: "e.g. SPE2DS26T6723",
                autoFocus: true,
                style: { ...inp, letterSpacing: ".06em" },
              }),
              suggestions.length > 0 &&
                hP(
                  "div",
                  {
                    style: {
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      right: 0,
                      zIndex: 10,
                      background: "var(--surface-inset)",
                      border: "1px solid rgba(201,168,76,.2)",
                      borderTop: "none",
                    },
                  },
                  ...suggestions.map((r) =>
                    hP(
                      "div",
                      {
                        key: r.sol_number,
                        onClick: () => confirmSol(r.sol_number),
                        style: {
                          padding: "10px 14px",
                          cursor: "pointer",
                          fontFamily: "JetBrains Mono,monospace",
                          fontSize: "12px",
                          color: "var(--alabaster)",
                          borderBottom: "1px solid rgba(201,168,76,.08)",
                        },
                        onMouseEnter: (e) =>
                          (e.target.style.background = "rgba(201,168,76,.08)"),
                        onMouseLeave: (e) =>
                          (e.target.style.background = "transparent"),
                      },
                      r.sol_number + " — " + (r.item_name || "").slice(0, 40),
                    ),
                  ),
                ),
            ),
            error &&
              hP(
                "div",
                {
                  style: {
                    color: "var(--red)",
                    fontFamily: "JetBrains Mono,monospace",
                    fontSize: "12px",
                    marginTop: "8px",
                  },
                },
                error,
              ),
            hP(
              "div",
              { style: { marginTop: "20px", display: "flex", gap: "12px" } },
              hP(
                "button",
                {
                  className: "btn btn-primary",
                  onClick: () => confirmSol(solInput.trim()),
                  style: { fontSize: "12px", padding: "10px 28px" },
                },
                hP("span", { className: "glint" }),
                "Confirm Sol →",
              ),
            ),
          ),

        step === STEPS.DROP &&
          hP(
            "div",
            null,
            hP(
              "div",
              {
                onDragOver: (e) => {
                  e.preventDefault();
                  setDragging(true);
                },
                onDragLeave: () => setDragging(false),
                onDrop: handleDrop,
                style: {
                  border:
                    "2px dashed " +
                    (dragging ? "rgba(201,168,76,.8)" : "rgba(201,168,76,.25)"),
                  borderRadius: "4px",
                  padding: "60px 40px",
                  textAlign: "center",
                  background: dragging ? "rgba(201,168,76,.05)" : "transparent",
                  transition: "all .2s",
                  cursor: "pointer",
                },
              },
              hP(
                "div",
                {
                  style: {
                    fontSize: "40px",
                    marginBottom: "16px",
                    opacity: ".5",
                  },
                },
                "📄",
              ),
              hP(
                "div",
                {
                  style: {
                    fontFamily: "Cinzel,serif",
                    fontSize: "14px",
                    letterSpacing: ".12em",
                    color: "var(--body-muted)",
                    marginBottom: "8px",
                  },
                },
                "Drop vendor quote PDF here",
              ),
              hP(
                "div",
                {
                  style: {
                    fontFamily: "JetBrains Mono,monospace",
                    fontSize: "11px",
                    color: "var(--body-faint)",
                    marginBottom: "20px",
                  },
                },
                "or click to browse",
              ),
              hP(
                "label",
                { style: { cursor: "pointer" } },
                hP("input", {
                  type: "file",
                  accept: ".pdf",
                  onChange: handleFileInput,
                  style: { display: "none" },
                }),
                hP(
                  "span",
                  {
                    className: "btn btn-secondary",
                    style: {
                      fontSize: "11px",
                      padding: "8px 20px",
                      display: "inline-block",
                    },
                  },
                  hP("span", { className: "glint" }),
                  "Browse PDF",
                ),
              ),
            ),
            error &&
              hP(
                "div",
                {
                  style: {
                    color: "var(--red)",
                    fontFamily: "JetBrains Mono,monospace",
                    fontSize: "12px",
                    marginTop: "12px",
                  },
                },
                error,
              ),
            hP(
              "button",
              {
                onClick: () => setStep(STEPS.SOL),
                style: {
                  background: "transparent",
                  border: "none",
                  color: "var(--body-faint)",
                  fontFamily: "Cinzel,serif",
                  fontSize: "10px",
                  letterSpacing: ".1em",
                  cursor: "pointer",
                  marginTop: "16px",
                },
              },
              "← Change Sol",
            ),
          ),

        step === STEPS.PARSING &&
          hP(
            "div",
            { style: { textAlign: "center", padding: "40px 0" } },
            hP(
              "div",
              {
                style: {
                  fontFamily: "Cinzel,serif",
                  fontSize: "13px",
                  letterSpacing: ".18em",
                  color: "var(--gold-mid)",
                  animation: "fadeUp .5s ease infinite alternate",
                },
              },
              "◆  Reading quote with Claude AI…",
            ),
            hP(
              "div",
              {
                style: {
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "11px",
                  color: "var(--body-faint)",
                  marginTop: "12px",
                },
              },
              "Extracting vendor, pricing, lead time, expiration…",
            ),
          ),

        step === STEPS.PREVIEW &&
          parsed &&
          hP(
            "div",
            null,
            hP(
              "div",
              {
                style: {
                  background: "rgba(61,214,140,.04)",
                  border: "1px solid rgba(61,214,140,.15)",
                  padding: "12px 16px",
                  marginBottom: "24px",
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "11px",
                  color: "var(--accent-green)",
                },
              },
              "✓ Extraction complete — review and edit any fields before confirming.",
            ),
            hP(
              "div",
              {
                style: {
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "0 20px",
                },
              },
              fieldRow("Vendor Name", "vendor_name"),
              fieldRow("Website", "vendor_website"),
              fieldRow("Phone", "vendor_phone"),
              fieldRow("Email", "vendor_email"),
              fieldRow("Point of Contact", "vendor_poc"),
              fieldRow("Part Number", "part_number"),
            ),
            hP(
              "div",
              {
                style: {
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: "0 20px",
                },
              },
              fieldRow("Unit Price / ea ($)", "unit_price", "number"),
              fieldRow("Quote Date", "quote_date"),
              fieldRow("Quote Expires", "quote_expires"),
              fieldRow("Lead Time", "lead_time"),
              fieldRow("MOQ", "moq"),
            ),
            hP(
              "div",
              { style: { marginBottom: "14px" } },
              hP("label", { style: lbl }, "Shipping Notes"),
              hP("input", {
                value: parsed.shipping_notes || "",
                onChange: (e) => updateParsed("shipping_notes", e.target.value),
                style: inp,
              }),
            ),
            hP(
              "div",
              { style: { marginBottom: "24px" } },
              hP("label", { style: lbl }, "Additional Notes"),
              hP("input", {
                value: parsed.notes || "",
                onChange: (e) => updateParsed("notes", e.target.value),
                style: inp,
              }),
            ),
            hP(
              "div",
              {
                style: {
                  background: "rgba(201,168,76,.04)",
                  border: "1px solid rgba(201,168,76,.12)",
                  padding: "12px 16px",
                  marginBottom: "24px",
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "11px",
                  color: "var(--gold-dim)",
                  lineHeight: "1.7",
                },
              },
              "◆ Will save to:",
              hP("br", null),
              "· Supplier Intel on sol " + solRecord.sol_number,
              hP("br", null),
              solRecord.nsn
                ? "· Vendor Intel — NSN " + solRecord.nsn + " (permanent)"
                : "· Vendor Intel skipped (no NSN on record)",
            ),
            error &&
              hP(
                "div",
                {
                  style: {
                    color: "var(--red)",
                    fontFamily: "JetBrains Mono,monospace",
                    fontSize: "12px",
                    marginBottom: "12px",
                  },
                },
                error,
              ),
            hP(
              "div",
              { style: { display: "flex", gap: "12px", alignItems: "center" } },
              hP(
                "button",
                {
                  className: "btn btn-primary",
                  onClick: handleConfirm,
                  disabled: saving,
                  style: {
                    fontSize: "12px",
                    padding: "11px 32px",
                    opacity: saving ? 0.6 : 1,
                  },
                },
                hP("span", { className: "glint" }),
                saving ? "Saving…" : "◆ Confirm & Save",
              ),
              hP(
                "button",
                {
                  onClick: () => setStep(STEPS.DROP),
                  style: {
                    background: "transparent",
                    border: "1px solid var(--border-subtle)",
                    color: "var(--body-dim)",
                    fontFamily: "Cinzel,serif",
                    fontSize: "10px",
                    letterSpacing: ".1em",
                    padding: "11px 20px",
                    cursor: "pointer",
                  },
                },
                "Re-drop PDF",
              ),
            ),
          ),

        step === STEPS.DONE &&
          hP(
            "div",
            { style: { textAlign: "center", padding: "30px 0" } },
            hP(
              "div",
              { style: { fontSize: "32px", marginBottom: "12px" } },
              "✓",
            ),
            hP(
              "div",
              {
                style: {
                  fontFamily: "Cinzel,serif",
                  fontSize: "14px",
                  letterSpacing: ".14em",
                  ...goldTxt,
                },
              },
              "Quote Saved Successfully",
            ),
          ),
      ),
    );
  }

  function PipelineTab({
    rows,
    setRows,
    filter,
    setFilter,
    openDrawer,
    setOpenDrawer,
    oopSet,
    toggleOop,
    goSource,
    goAward,
    goFU,
    showToast,
    loadPipeline,
  }) {
    const { fmt, TIER_MARGINS, STATUSES, tierClass, calcBidMath } =
      window.SCC_MATH;
    const { dbSave, dbDelete, dbArchive } = window.SCC_DB;

    const [bidBand, setBidBand] = usePState("All");
    const [search, setSearch] = usePState("");
    const [showIngest, setShowIngest] = usePState(false);

    const [sortCol, setSortCol] = usePState(null);
    const [sortDir, setSortDir] = usePState("asc");

    const cycleSort = (col) => {
      if (sortCol !== col) {
        setSortCol(col);
        setSortDir("asc");
      } else if (sortDir === "asc") {
        setSortDir("desc");
      } else {
        setSortCol(null);
        setSortDir("asc");
      }
    };

    const parseDateMs = (s) => {
      if (!s) return Infinity;
      if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) {
        const [m, d, y] = s.split("/");
        return new Date(
          parseInt(y) < 100 ? 2000 + parseInt(y) : parseInt(y),
          m - 1,
          d,
        ).getTime();
      }
      const t = new Date(s).getTime();
      return isNaN(t) ? Infinity : t;
    };

    const getBidTotal = (r) => {
      const qty = parseFloat(r.quantity) || 1;
      const govUnit = parseFloat(r.unit_price) || 0;
      return govUnit * qty;
    };

    const [bandMin, bandMax] = BID_BANDS[bidBand] || [0, Infinity];

    const visible = rows
      .filter((r) => filter === "All" || r.status === filter)
      .filter((r) => {
        const b = getBidTotal(r);
        return b >= bandMin && b <= bandMax;
      })
      .filter((r) => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return (
          (r.nsn || "").includes(q) ||
          (r.sol_number || "").toLowerCase().includes(q) ||
          (r.item_name || "").toLowerCase().includes(q) ||
          (r.fsc || "").includes(q) ||
          (r.ref_part_number || "").toLowerCase().includes(q)
        );
      })
      .slice()
      .sort((a, b) => {
        if (!sortCol) return 0;
        const aMs =
          sortCol === "due"
            ? parseDateMs(a.quote_due)
            : parseDateMs(a.date_added);
        const bMs =
          sortCol === "due"
            ? parseDateMs(b.quote_due)
            : parseDateMs(b.date_added);
        return sortDir === "asc" ? aMs - bMs : bMs - aMs;
      });

    const goPO = (r) => {
      const params = new URLSearchParams({
        sol: r.sol_number || "",
        nsn: r.nsn || "",
        item: r.item_name || "",
        part: r.ref_part_number || "",
        qty: r.quantity || "",
        unit: r.unit_of_issue || "EA",
        price: r.supplier_quote_price || r.ref_unit_price || "",
        clin: r.clin || "0001",
        delivery: r.delivery_days ? r.delivery_days + " days ARO" : "",
        vendor: r.supplier_poc || r.ref_supplier || "",
        vendorEmail: r.supplier_email || "",
        vendorPhone: r.supplier_phone || "",
        shipto: r.ship_to || "",
        fob: r.fob || "Destination",
      });
      window.open(
        "/scc/supplier-po-template.html?" + params.toString(),
        "_blank",
      );
    };

    const handleStatus = async (sol_number, status) => {
      const updated = rows.map((r) =>
        r.sol_number === sol_number ? { ...r, status } : r,
      );
      setRows(updated);
      await dbSave(updated.find((r) => r.sol_number === sol_number));
      showToast(sol_number + " → " + status);
    };
    const handleDelete = async (sol_number) => {
      if (!confirm("Delete " + sol_number + "?")) return;
      await dbDelete(sol_number);
      setRows(rows.filter((r) => r.sol_number !== sol_number));
      showToast(sol_number + " deleted");
    };
    const handleArchive = async (sol_number) => {
      if (typeof dbArchive !== "function") {
        showToast("Archive not available", true);
        return;
      }
      if (
        !confirm(
          "Archive " +
            sol_number +
            "? It will be removed from the active pipeline.",
        )
      )
        return;
      await dbArchive(sol_number);
      setRows(rows.filter((r) => r.sol_number !== sol_number));
      showToast(sol_number + " archived");
    };

    const fmtDateAdded = (raw) => {
      if (!raw) return null;
      const d = new Date(raw);
      if (isNaN(d)) return raw;
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const yy = String(d.getFullYear()).slice(2);
      return mm + "/" + dd + "/" + yy;
    };

    return hP(
      "div",
      { style: { animation: "fadeUp .5s ease both" } },
      showIngest &&
        hP(QuoteIngestOverlay, {
          rows,
          onClose: () => setShowIngest(false),
          showToast,
        }),
      hP(
        "div",
        { className: "pipe-header" },
        hP(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: "6px" } },
          hP(
            "div",
            {
              className: "pipe-title",
              onClick: () => setShowIngest(true),
              title: "Click to ingest a vendor quote PDF",
              style: {
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "10px",
              },
            },
            "Active Pipeline",
            hP(
              "span",
              {
                style: {
                  fontFamily: "Cinzel,serif",
                  fontSize: "10px",
                  letterSpacing: ".14em",
                  color: "var(--gold-dim)",
                  border: "1px solid rgba(201,168,76,.2)",
                  padding: "3px 10px",
                  verticalAlign: "middle",
                  transition: "all .2s",
                },
                onMouseEnter: (e) => {
                  e.target.style.color = "#f9f295";
                  e.target.style.borderColor = "rgba(201,168,76,.5)";
                },
                onMouseLeave: (e) => {
                  e.target.style.color = "rgba(201,168,76,.4)";
                  e.target.style.borderColor = "rgba(201,168,76,.2)";
                },
              },
              "◆ Ingest Quote",
            ),
          ),
          hP("input", {
            value: search,
            onChange: (e) => setSearch(e.target.value),
            placeholder: "Search NSN, sol #, item, FSC, part #…",
            style: {
              padding: "7px 14px",
              background: "var(--inset-bg)",
              border: "1px solid rgba(201,168,76,.2)",
              color: "var(--alabaster)",
              fontFamily: "JetBrains Mono,monospace",
              fontSize: "12px",
              outline: "none",
              width: "300px",
              letterSpacing: ".04em",
            },
          }),
        ),
        hP(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              alignItems: "flex-end",
            },
          },
          hP(
            "div",
            { className: "filter-bar" },
            ...["All", ...STATUSES].map((s) =>
              hP(
                "button",
                {
                  key: s,
                  className: "fbtn" + (filter === s ? " active" : ""),
                  onClick: () => setFilter(s),
                },
                s,
              ),
            ),
          ),
          hP(
            "div",
            {
              style: {
                display: "flex",
                gap: "0",
                border: "1px solid rgba(201,168,76,.2)",
                borderRadius: "3px",
                overflow: "hidden",
              },
            },
            ...["All", "<10K", "10K–50K", "50K–100K", "100K+"].map((b, i) => {
              const active = bidBand === b;
              const accentColor = BAND_COLORS[b] || "var(--gold-solid)";
              return hP(
                "button",
                {
                  key: b,
                  onClick: () => setBidBand(b),
                  style: {
                    fontFamily: "Cinzel,serif",
                    fontSize: "10px",
                    letterSpacing: ".1em",
                    padding: "7px 14px",
                    cursor: "pointer",
                    transition: "all .2s",
                    textTransform: "uppercase",
                    whiteSpace: "nowrap",
                    borderRight:
                      i < 4 ? "1px solid rgba(201,168,76,.15)" : "none",
                    background: active ? "rgba(201,168,76,.1)" : "transparent",
                    color: active ? accentColor : "rgba(201,168,76,.4)",
                    borderTop: active
                      ? "2px solid " + accentColor
                      : "2px solid transparent",
                    borderBottom: "none",
                    borderLeft: "none",
                  },
                },
                b,
              );
            }),
          ),
        ),
      ),

      rows.length === 0
        ? hP(
            "div",
            { className: "empty" },
            "No solicitations yet — paste one in the Intake tab to begin.",
          )
        : hP(
            "div",
            { className: "tbl-wrap" },
            hP(
              "table",
              null,
              hP(
                "thead",
                null,
                hP(
                  "tr",
                  null,
                  hP("th", null, "Sol Number"),
                  hP("th", null, "Item"),
                  hP("th", null, "NSN"),
                  hP("th", null, "Qty"),
                  hP("th", null, "Gov $ / Ext"),
                  hP(
                    "th",
                    {
                      title:
                        "STD=Standard 30% · FAST=Fast Award 40% · LHF=Low Hanging Fruit 42.5% · SB=Small Business Set-Aside 35%  |  Comp: 20% & 25% bid scenarios vs SouthStar 21% min",
                      style: { cursor: "help" },
                    },
                    "Bid Type ⓘ",
                  ),
                  hP("th", null, "Bid $/ea"),
                  hP("th", null, "Margin"),
                  hP("th", null, "Net $"),
                  hP(
                    "th",
                    {
                      style: {
                        cursor: "pointer",
                        userSelect: "none",
                        whiteSpace: "nowrap",
                      },
                      onClick: () => cycleSort("due"),
                      title: "Sort by Quote Due date",
                    },
                    hP(
                      "div",
                      {
                        style: {
                          display: "flex",
                          flexDirection: "column",
                          gap: "3px",
                        },
                      },
                      hP(
                        "div",
                        {
                          style: {
                            display: "flex",
                            alignItems: "center",
                            gap: "5px",
                          },
                        },
                        hP(
                          "span",
                          {
                            style: {
                              color: sortCol === "due" ? "#f9f295" : "inherit",
                            },
                          },
                          "Due",
                        ),
                        hP(
                          "span",
                          {
                            style: {
                              fontSize: "9px",
                              color:
                                sortCol === "due"
                                  ? "#f9f295"
                                  : "rgba(201,168,76,.35)",
                              fontWeight: "700",
                              letterSpacing: ".05em",
                            },
                          },
                          sortCol === "due"
                            ? sortDir === "asc"
                              ? "▲"
                              : "▽"
                            : "⇅",
                        ),
                      ),
                      hP(
                        "div",
                        {
                          style: {
                            display: "flex",
                            alignItems: "center",
                            gap: "5px",
                            cursor: "pointer",
                            paddingTop: "2px",
                            borderTop: "1px solid rgba(201,168,76,.1)",
                          },
                          onClick: (e) => {
                            e.stopPropagation();
                            cycleSort("entered");
                          },
                        },
                        hP(
                          "span",
                          {
                            style: {
                              fontFamily: "Cinzel,serif",
                              fontSize: "9px",
                              letterSpacing: ".1em",
                              color:
                                sortCol === "entered"
                                  ? "rgba(201,168,76,.9)"
                                  : "rgba(201,168,76,.4)",
                              textTransform: "uppercase",
                            },
                          },
                          "Entered",
                        ),
                        hP(
                          "span",
                          {
                            style: {
                              fontSize: "9px",
                              color:
                                sortCol === "entered"
                                  ? "rgba(201,168,76,.9)"
                                  : "rgba(201,168,76,.25)",
                              fontWeight: "700",
                            },
                          },
                          sortCol === "entered"
                            ? sortDir === "asc"
                              ? "▲"
                              : "▽"
                            : "⇅",
                        ),
                      ),
                    ),
                  ),
                  hP("th", null, "Status"),
                  hP("th", null, "Actions"),
                ),
              ),
              hP(
                "tbody",
                null,
                visible.length === 0 &&
                  hP(
                    "tr",
                    null,
                    hP(
                      "td",
                      { colSpan: "12", className: "empty" },
                      bidBand !== "All"
                        ? "No bids in the " + bidBand + " range."
                        : "No solicitations match this filter.",
                    ),
                  ),
                ...visible.map((r) => {
                  const qty = parseFloat(r.quantity) || 1;
                  const govUnit = parseFloat(r.unit_price) || 0;
                  const tier = r.tier || "Standard";
                  const tierMargin = TIER_MARGINS[tier] || 0.3;
                  const costUnit = r.supplier_quote_price
                    ? parseFloat(r.supplier_quote_price)
                    : govUnit * 0.7;
                  const m = calcBidMath(costUnit, qty, tierMargin, 0, 0, 0);
                  const meetsM = m.gpPct >= tierMargin * 100 - 0.5;
                  const mcls = meetsM
                    ? "var(--green)"
                    : m.gpPct >= 21
                      ? "var(--amber)"
                      : "var(--red)";
                  const TIER_ABBR = {
                    Standard: "STD",
                    "Fast Award": "FAST",
                    "Low Hanging Fruit": "LHF",
                    "Small Business Set-Aside": "SB",
                  };
                  const abbr = TIER_ABBR[tier] || "STD";
                  const m20 = calcBidMath(costUnit, qty, 0.2, 0, 0, 0);
                  const m25 = calcBidMath(costUnit, qty, 0.25, 0, 0, 0);

                  const isBlocked = window.SCC_TABS.isBlocked;
                  const blockedHit = isBlocked
                    ? isBlocked(r.ref_supplier)
                    : null;

                  return hP(
                    React.Fragment,
                    { key: r.sol_number },
                    hP(
                      "tr",
                      {
                        onClick: () =>
                          setOpenDrawer(
                            openDrawer === r.sol_number ? null : r.sol_number,
                          ),
                        style: {
                          cursor: "pointer",
                          outline: blockedHit
                            ? "1px solid rgba(231,76,60,.35)"
                            : "none",
                          outlineOffset: "-1px",
                        },
                      },
                      hP(
                        "td",
                        null,
                        hP(
                          "span",
                          { className: "sol-link" },
                          r.sol_number || "—",
                        ),
                        blockedHit &&
                          hP(
                            "div",
                            {
                              title:
                                "Blocked Manufacturer: " +
                                (blockedHit.reason || blockedHit.name) +
                                " — do not contact direct",
                              style: {
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                                marginLeft: "6px",
                                padding: "2px 7px",
                                background: "rgba(231,76,60,.12)",
                                border: "1px solid rgba(231,76,60,.45)",
                                borderRadius: "2px",
                                cursor: "help",
                                verticalAlign: "middle",
                              },
                            },
                            hP("span", { style: { fontSize: "9px" } }, "⚠"),
                            hP(
                              "span",
                              {
                                style: {
                                  fontFamily: "Cinzel,serif",
                                  fontSize: "8px",
                                  letterSpacing: ".1em",
                                  textTransform: "uppercase",
                                  color: "var(--accent-red-soft)",
                                  fontWeight: "700",
                                },
                              },
                              "BLOCKED MFR",
                            ),
                          ),
                      ),
                      hP(
                        "td",
                        { className: "iname" },
                        r.item_name || r.item_name_ai || "—",
                      ),
                      hP("td", null, r.nsn || "—"),
                      hP(
                        "td",
                        null,
                        (r.quantity || "—") +
                          (r.unit_of_issue ? " " + r.unit_of_issue : ""),
                      ),
                      hP(
                        "td",
                        null,
                        hP(
                          "div",
                          {
                            style: {
                              fontFamily: "JetBrains Mono,monospace",
                              fontSize: "12px",
                              color: "var(--accent-cyan)",
                            },
                          },
                          "$" + (govUnit || 0).toFixed(2),
                          r.price_is_hist &&
                            hP(
                              "span",
                              {
                                style: {
                                  fontSize: "9px",
                                  color: "var(--body-faint)",
                                  marginLeft: "3px",
                                },
                              },
                              "hist",
                            ),
                        ),
                        hP(
                          "div",
                          {
                            style: {
                              fontFamily: "JetBrains Mono,monospace",
                              fontSize: "14px",
                              fontWeight: "600",
                              color: "var(--accent-purple)",
                              textDecoration: "overline",
                              marginTop: "2px",
                            },
                          },
                          fmt(govUnit * qty),
                        ),
                      ),
                      hP(
                        "td",
                        { onClick: (e) => e.stopPropagation() },
                        hP(
                          "div",
                          {
                            style: {
                              display: "flex",
                              flexDirection: "column",
                              gap: "3px",
                            },
                          },
                          hP(
                            "select",
                            {
                              value: r.tier || "Standard",
                              onClick: (e) => e.stopPropagation(),
                              onChange: (e) => {
                                const updated = rows.map((x) =>
                                  x.sol_number === r.sol_number
                                    ? { ...x, tier: e.target.value }
                                    : x,
                                );
                                setRows(updated);
                                dbSave(
                                  updated.find(
                                    (x) => x.sol_number === r.sol_number,
                                  ),
                                );
                              },
                              style: {
                                background: "var(--surface-inset)",
                                border: "1px solid rgba(201,168,76,.2)",
                                color: "var(--gold-solid)",
                                fontFamily: "Cinzel,serif",
                                fontSize: "12px",
                                letterSpacing: ".08em",
                                padding: "4px 6px",
                                cursor: "pointer",
                                outline: "none",
                                width: "100%",
                                fontWeight: "700",
                              },
                            },
                            hP(
                              "option",
                              {
                                value: "Standard",
                                style: { background: "var(--surface-inset)" },
                              },
                              "STD — 30%",
                            ),
                            hP(
                              "option",
                              {
                                value: "Fast Award",
                                style: { background: "var(--surface-inset)" },
                              },
                              "FAST — 40%",
                            ),
                            hP(
                              "option",
                              {
                                value: "Low Hanging Fruit",
                                style: { background: "var(--surface-inset)" },
                              },
                              "LHF — 42.5%",
                            ),
                            hP(
                              "option",
                              {
                                value: "Small Business Set-Aside",
                                style: { background: "var(--surface-inset)" },
                              },
                              "SB — 35%",
                            ),
                          ),
                          hP(
                            "div",
                            {
                              style: {
                                fontFamily: "JetBrains Mono,monospace",
                                fontSize: "10px",
                                color: "var(--accent-blue)",
                                paddingLeft: "2px",
                              },
                            },
                            fmt(m20.bidUnit) + " @ 20%  →  " + fmt(m20.net),
                          ),
                          hP(
                            "div",
                            {
                              style: {
                                fontFamily: "JetBrains Mono,monospace",
                                fontSize: "10px",
                                color: "var(--accent-green)",
                                paddingLeft: "2px",
                              },
                            },
                            fmt(m25.bidUnit) + " @ 25%  →  " + fmt(m25.net),
                          ),
                        ),
                      ),
                      hP(
                        "td",
                        {
                          className: "imperio-gold-text",
                          style: {
                            color: "var(--accent-pink-deep)",
                            fontSize: "17px",
                            fontWeight: "700",
                          },
                        },
                        fmt(m.bidUnit),
                      ),
                      hP(
                        "td",
                        { style: { color: mcls, fontWeight: "700" } },
                        m.gpPct.toFixed(1) + "%",
                        hP(
                          "span",
                          {
                            style: {
                              fontSize: "10px",
                              display: "block",
                              color: meetsM
                                ? "var(--body-faint)"
                                : m.gpPct >= 21
                                  ? "rgba(243,156,18,.5)"
                                  : "var(--red)",
                            },
                          },
                          (r.supplier_quote_price ? "" : "est") +
                            " · " +
                            (tierMargin * 100).toFixed(0) +
                            "% min",
                        ),
                      ),
                      hP(
                        "td",
                        {
                          style: {
                            color: m.net >= 0 ? "var(--green)" : "var(--red)",
                            fontWeight: "700",
                            fontSize: "16px",
                          },
                        },
                        fmt(m.net),
                      ),

                      hP(
                        "td",
                        null,
                        (() => {
                          if (!r.quote_due) return hP("span", null, "—");
                          const today_ = new Date();
                          today_.setHours(0, 0, 0, 0);
                          const [mm, dd, yy] = r.quote_due.split("/");
                          const due_ = new Date(
                            2000 + parseInt(yy),
                            mm - 1,
                            dd,
                          );
                          const diff = Math.round((due_ - today_) / 86400000);
                          const clr =
                            diff < 0
                              ? "var(--red)"
                              : diff === 0
                                ? "var(--red)"
                                : diff <= 2
                                  ? "var(--amber)"
                                  : "var(--body-mono)";
                          const label =
                            diff < 0
                              ? Math.abs(diff) + "d overdue"
                              : diff === 0
                                ? "TODAY"
                                : diff === 1
                                  ? "TOMORROW"
                                  : diff + "d left";

                          const enteredFmt = fmtDateAdded(r.date_added);
                          const enteredLine = enteredFmt
                            ? hP(
                                "div",
                                {
                                  style: {
                                    fontFamily: "JetBrains Mono,monospace",
                                    fontSize: "9px",
                                    color: "var(--gold-mid)",
                                    marginTop: "3px",
                                    letterSpacing: ".04em",
                                  },
                                },
                                "Entered: " + enteredFmt,
                              )
                            : null;

                          const addedLine = (() => {
                            if (!r.date_added) return null;
                            const a = new Date(r.date_added);
                            a.setHours(0, 0, 0, 0);
                            const daysAgo = Math.round((today_ - a) / 86400000);
                            const aLabel =
                              daysAgo === 0
                                ? "today"
                                : daysAgo === 1
                                  ? "yesterday"
                                  : daysAgo + "d ago";
                            const aClr =
                              daysAgo === 0
                                ? "rgba(201,168,76,.95)"
                                : daysAgo <= 2
                                  ? "rgba(201,168,76,.75)"
                                  : "var(--body-muted)";
                            return hP(
                              "div",
                              {
                                style: {
                                  fontFamily: "JetBrains Mono,monospace",
                                  fontSize: "9px",
                                  color: aClr,
                                  marginTop: "2px",
                                  letterSpacing: ".04em",
                                },
                              },
                              "+ " + aLabel,
                            );
                          })();

                          return hP(
                            PFrag,
                            null,
                            hP(
                              "div",
                              {
                                style: {
                                  fontFamily: "JetBrains Mono,monospace",
                                  fontSize: "13px",
                                },
                              },
                              r.quote_due,
                            ),
                            hP(
                              "div",
                              {
                                style: {
                                  fontFamily: "JetBrains Mono,monospace",
                                  fontSize: "10px",
                                  color: clr,
                                  marginTop: "2px",
                                  fontWeight: diff <= 2 ? "700" : "400",
                                },
                              },
                              label,
                            ),
                            enteredLine,
                            addedLine,
                          );
                        })(),
                      ),

                      hP(
                        "td",
                        { onClick: (e) => e.stopPropagation() },
                        hP(
                          "select",
                          {
                            className: "status-sel",
                            value: r.status || "New",
                            onChange: (e) =>
                              handleStatus(r.sol_number, e.target.value),
                          },
                          ...STATUSES.map((s) =>
                            hP("option", { key: s, value: s }, s),
                          ),
                        ),
                      ),
                      hP(
                        "td",
                        { onClick: (e) => e.stopPropagation() },
                        hP(
                          "div",
                          {
                            style: {
                              display: "flex",
                              gap: "6px",
                              alignItems: "center",
                            },
                          },
                          hP(
                            "button",
                            {
                              onClick: () => goSource(r),
                              title: "Send to Source tab",
                              style: {
                                background:
                                  "linear-gradient(to bottom,#cf972d 22%,#f9f295 45%,#e0aa3e 50%,#b8860b 55%,#f9f295 78%)",
                                border: "none",
                                color: "var(--body-color)",
                                fontFamily: "Cinzel,serif",
                                fontSize: "14.5px",
                                fontWeight: "700",
                                padding: "5px 10px",
                                cursor: "pointer",
                                transition: "all .15s",
                              },
                              onMouseEnter: (e) =>
                                (e.target.style.opacity = ".8"),
                              onMouseLeave: (e) =>
                                (e.target.style.opacity = "1"),
                            },
                            "◆",
                          ),
                          hP(
                            "button",
                            {
                              onClick: () => {
                                handleStatus(r.sol_number, "Awarded");
                                if (goAward) goAward(r);
                              },
                              title: "Mark Awarded — opens Award processing",
                              style: {
                                background:
                                  r.status === "Awarded"
                                    ? "rgba(61,214,140,.15)"
                                    : "transparent",
                                border:
                                  "1px solid " +
                                  (r.status === "Awarded"
                                    ? "rgba(61,214,140,.6)"
                                    : "rgba(61,214,140,.3)"),
                                color:
                                  r.status === "Awarded"
                                    ? "var(--accent-green)"
                                    : "rgba(61,214,140,.6)",
                                fontFamily: "Cinzel,serif",
                                fontSize: "10px",
                                letterSpacing: ".06em",
                                padding: "4px 8px",
                                cursor: "pointer",
                                transition: "all .2s",
                                whiteSpace: "nowrap",
                              },
                              onMouseEnter: (e) => {
                                e.target.style.background =
                                  "rgba(61,214,140,.12)";
                                e.target.style.color = "var(--accent-green)";
                              },
                              onMouseLeave: (e) => {
                                if (r.status !== "Awarded") {
                                  e.target.style.background = "transparent";
                                  e.target.style.color = "rgba(61,214,140,.6)";
                                }
                              },
                            },
                            "★ Award",
                          ),
                          hP(
                            "button",
                            {
                              onClick: () => goFU && goFU(r),
                              title:
                                "Send to FU Engine — pre-fills solicitation inquiry",
                              style: {
                                background: "transparent",
                                border: "1px solid rgba(135,206,235,.3)",
                                color: "rgba(135,206,235,.7)",
                                fontFamily: "Cinzel,serif",
                                fontSize: "10px",
                                letterSpacing: ".06em",
                                padding: "4px 8px",
                                cursor: "pointer",
                                transition: "all .2s",
                                whiteSpace: "nowrap",
                              },
                              onMouseEnter: (e) => {
                                e.target.style.background =
                                  "rgba(135,206,235,.1)";
                                e.target.style.color = "#87ceeb";
                                e.target.style.borderColor =
                                  "rgba(135,206,235,.6)";
                              },
                              onMouseLeave: (e) => {
                                e.target.style.background = "transparent";
                                e.target.style.color = "rgba(135,206,235,.7)";
                                e.target.style.borderColor =
                                  "rgba(135,206,235,.3)";
                              },
                            },
                            "✉ FU",
                          ),
                          hP(
                            "button",
                            {
                              onClick: () => goPO(r),
                              title: "Generate Supplier PO",
                              style: {
                                background: "transparent",
                                border: "1px solid rgba(201,168,76,.3)",
                                color: "var(--gold-mid)",
                                fontFamily: "Cinzel,serif",
                                fontSize: "10px",
                                letterSpacing: ".06em",
                                padding: "4px 8px",
                                cursor: "pointer",
                                transition: "all .2s",
                                whiteSpace: "nowrap",
                              },
                              onMouseEnter: (e) => {
                                e.target.style.background =
                                  "rgba(201,168,76,.1)";
                                e.target.style.color = "#f9f295";
                              },
                              onMouseLeave: (e) => {
                                e.target.style.background = "transparent";
                                e.target.style.color = "rgba(201,168,76,.7)";
                              },
                            },
                            "PO",
                          ),
                          hP(
                            "button",
                            {
                              onClick: () => handleArchive(r.sol_number),
                              title: "Archive — preserves all intel",
                              style: {
                                background: "transparent",
                                border: "1px solid rgba(201,168,76,.3)",
                                color: "var(--gold-mid)",
                                fontFamily: "Cinzel,serif",
                                fontSize: "10px",
                                letterSpacing: ".06em",
                                padding: "4px 8px",
                                cursor: "pointer",
                                transition: "all .2s",
                                whiteSpace: "nowrap",
                              },
                              onMouseEnter: (e) => {
                                e.target.style.background =
                                  "rgba(201,168,76,.1)";
                                e.target.style.color = "#f9f295";
                              },
                              onMouseLeave: (e) => {
                                e.target.style.background = "transparent";
                                e.target.style.color = "rgba(201,168,76,.7)";
                              },
                            },
                            "⬇ Arc",
                          ),
                          hP(
                            "button",
                            {
                              className: "del-btn",
                              onClick: () => handleDelete(r.sol_number),
                              title: "Permanently delete — cannot be undone",
                            },
                            "✕",
                          ),
                        ),
                      ),
                    ),
                    openDrawer === r.sol_number &&
                      hP(
                        "tr",
                        { className: "drawer-row" },
                        hP(
                          "td",
                          { colSpan: "12" },
                          hP(Drawer, {
                            record: r,
                            onSave: async (updates) => {
                              const updated = { ...r, ...updates };
                              await dbSave(updated);
                              setRows(
                                rows.map((x) =>
                                  x.sol_number === r.sol_number ? updated : x,
                                ),
                              );
                              showToast(r.sol_number + " updated");
                            },
                            showToast,
                          }),
                        ),
                      ),
                  );
                }),
              ),
              hP(
                "tfoot",
                null,
                hP(
                  "tr",
                  {
                    style: {
                      borderTop: "2px solid rgba(201,168,76,.4)",
                      background:
                        "linear-gradient(160deg,#2e2b32 0%,#1a1820 40%,#111012 100%)",
                    },
                  },
                  hP(
                    "td",
                    {
                      colSpan: "6",
                      style: {
                        padding: "16px 14px",
                        fontFamily: "Cinzel,serif",
                        fontSize: "12px",
                        letterSpacing: ".18em",
                        color: "var(--gold-dim)",
                        textTransform: "uppercase",
                      },
                    },
                    "Pipeline Total — " +
                      visible.length +
                      " solicitation" +
                      (visible.length !== 1 ? "s" : "") +
                      (filter !== "All" ? " · " + filter : "") +
                      (bidBand !== "All" ? " · " + bidBand : ""),
                  ),
                  hP(
                    "td",
                    {
                      colSpan: "6",
                      style: { padding: "16px 14px", textAlign: "right" },
                    },
                    (() => {
                      let total = 0,
                        oopTotal = 0;
                      visible.forEach((r) => {
                        const qty = parseFloat(r.quantity) || 1;
                        const govUnit = parseFloat(r.unit_price) || 0;
                        const tier = r.tier || "Standard";
                        const costUnit = r.supplier_quote_price
                          ? parseFloat(r.supplier_quote_price)
                          : govUnit * 0.7;
                        const m = calcBidMath(
                          costUnit,
                          qty,
                          TIER_MARGINS[tier] || 0.3,
                          0,
                          0,
                          0,
                        );
                        total += m.net;
                        if (oopSet.has(r.sol_number)) oopTotal += m.cogs;
                      });
                      const oopCount = visible.filter((r) =>
                        oopSet.has(r.sol_number),
                      ).length;
                      return hP(
                        "div",
                        {
                          style: {
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "flex-end",
                            gap: "32px",
                            flexWrap: "wrap",
                          },
                        },
                        bidBand === "<10K" &&
                          oopCount > 0 &&
                          hP(
                            "div",
                            { style: { textAlign: "right" } },
                            hP(
                              "span",
                              {
                                style: {
                                  fontFamily: "JetBrains Mono,monospace",
                                  fontSize: "22px",
                                  fontWeight: "700",
                                  color: "var(--red)",
                                },
                              },
                              fmt(oopTotal),
                            ),
                            hP(
                              "span",
                              {
                                style: {
                                  fontFamily: "JetBrains Mono,monospace",
                                  fontSize: "11px",
                                  display: "block",
                                  color: "var(--accent-red-dim)",
                                  letterSpacing: ".06em",
                                },
                              },
                              "out of pocket · " +
                                oopCount +
                                " bid" +
                                (oopCount !== 1 ? "s" : ""),
                            ),
                          ),
                        hP(
                          "div",
                          { style: { textAlign: "right" } },
                          hP(
                            "span",
                            {
                              style: {
                                fontFamily: "JetBrains Mono,monospace",
                                fontSize: "26px",
                                fontWeight: "700",
                                background:
                                  "linear-gradient(90deg,#a8f0c6,#3ddc84,#1a9e52)",
                                WebkitBackgroundClip: "text",
                                WebkitTextFillColor: "transparent",
                              },
                            },
                            fmt(total),
                          ),
                          hP(
                            "span",
                            {
                              style: {
                                fontFamily: "JetBrains Mono,monospace",
                                fontSize: "11px",
                                display: "block",
                                color: "var(--body-faint)",
                                letterSpacing: ".06em",
                              },
                            },
                            "est. net take home" +
                              (visible.every((r) => r.supplier_quote_price)
                                ? ""
                                : " (est)"),
                          ),
                        ),
                      );
                    })(),
                  ),
                ),
              ),
            ),
          ),
    );
  }

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.VendorIntelPanel = VendorIntelPanel;
  window.SCC_TABS.Drawer = Drawer;
  window.SCC_TABS.PipelineTab = PipelineTab;
})();
