(function () {
  const {
    createElement: hW,
    useState: useWState,
    useEffect: useWEffect,
    Fragment: WFrag,
  } = React;

  const ENTITY_DEFAULT = "IMP";

  const gold = {
    background:
      "linear-gradient(to bottom,#cf972d 22%,#f9f295 45%,#e0aa3e 50%,#b8860b 55%,#f9f295 78%)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
  };
  const mono = { fontFamily: "JetBrains Mono,monospace" };
  const cinzel = { fontFamily: "Cinzel,serif" };
  const section = (label) =>
    hW(
      "div",
      {
        style: {
          ...cinzel,
          fontSize: "9px",
          letterSpacing: ".22em",
          textTransform: "uppercase",
          color: "var(--gold-dim)",
          marginBottom: "12px",
          marginTop: "24px",
          paddingBottom: "6px",
          borderBottom: "1px solid rgba(201,168,76,.12)",
        },
      },
      "◆ " + label,
    );

  const fieldStyle = {
    width: "100%",
    padding: "9px 12px",
    background: "var(--inset-bg)",
    border: "1px solid rgba(201,168,76,.2)",
    color: "var(--alabaster)",
    fontFamily: "JetBrains Mono,monospace",
    fontSize: "13px",
    outline: "none",
    boxSizing: "border-box",
  };
  const labelStyle = {
    fontFamily: "Cinzel,serif",
    fontSize: "9px",
    letterSpacing: ".14em",
    textTransform: "uppercase",
    color: "var(--gold-dim)",
    display: "block",
    marginBottom: "5px",
  };

  function Field({ label, value, onChange, readOnly, type, placeholder }) {
    return hW(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: "4px" } },
      hW("label", { style: labelStyle }, label),
      hW("input", {
        type: type || "text",
        value: value || "",
        readOnly: readOnly || false,
        placeholder: placeholder || "",
        onChange: onChange ? (e) => onChange(e.target.value) : undefined,
        style: {
          ...fieldStyle,
          opacity: readOnly ? 0.65 : 1,
          cursor: readOnly ? "default" : "text",
        },
      }),
    );
  }

  function SelectField({ label, value, onChange, options }) {
    return hW(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: "4px" } },
      hW("label", { style: labelStyle }, label),
      hW(
        "select",
        {
          value: value || "",
          onChange: onChange ? (e) => onChange(e.target.value) : undefined,
          style: {
            ...fieldStyle,
            cursor: "pointer",
            appearance: "none",
            WebkitAppearance: "none",
          },
        },
        ...options.map(([val, lbl]) =>
          hW("option", { key: val, value: val }, lbl),
        ),
      ),
    );
  }

  function CopyCell({ label, value }) {
    const [copied, setCopied] = useWState(false);
    const copy = () => {
      if (!value) return;
      navigator.clipboard.writeText(value).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    };
    return hW(
      "div",
      {
        style: {
          background: "var(--surface-sheen)",
          border: "1px solid rgba(201,168,76,.15)",
          padding: "10px 14px",
          cursor: value ? "pointer" : "default",
          transition: "border-color .15s",
          borderRadius: "2px",
          position: "relative",
        },
        onClick: copy,
        title: value ? "Click to copy" : "",
        onMouseEnter: (e) => {
          if (value) e.currentTarget.style.borderColor = "rgba(201,168,76,.45)";
        },
        onMouseLeave: (e) => {
          e.currentTarget.style.borderColor = "rgba(201,168,76,.15)";
        },
      },
      hW(
        "div",
        {
          style: {
            ...cinzel,
            fontSize: "8px",
            letterSpacing: ".14em",
            textTransform: "uppercase",
            color: "var(--gold-dim)",
            marginBottom: "4px",
          },
        },
        label,
      ),
      hW(
        "div",
        {
          style: {
            ...mono,
            fontSize: "14px",
            color: copied ? "var(--accent-green)" : "var(--alabaster)",
            transition: "color .15s",
          },
        },
        value ||
          hW(
            "span",
            {
              style: {
                color: "var(--body-faint)",
                fontStyle: "italic",
                fontSize: "12px",
              },
            },
            "—",
          ),
      ),
      copied &&
        hW(
          "div",
          {
            style: {
              position: "absolute",
              top: "6px",
              right: "10px",
              ...cinzel,
              fontSize: "8px",
              letterSpacing: ".08em",
              color: "var(--accent-green)",
            },
          },
          "✓ copied",
        ),
    );
  }

  // ── PAYMENT STATUS COLORS ────────────────────────────────────────────
  const payStatusColors = {
    unpaid: "var(--red)",
    partial: "var(--amber)",
    paid: "var(--accent-green)",
    overdue: "rgba(231,76,60,.9)",
  };

  // ── AWARD FORM ───────────────────────────────────────────────────────
  function AwardForm({ prefill, onSave, onCancel, showToast }) {
    const { awardSave, awardGetBySol, nextDocNumber, peekDocNumber } =
      window.SCC_DB;
    const { fmt } = window.SCC_MATH;

    const today = new Date().toLocaleDateString();

    const initial = {
      sol_number: prefill?.sol_number || "",
      nsn: prefill?.nsn || "",
      fsc: prefill?.fsc || "",
      clin: prefill?.clin || "",
      item_name: prefill?.item_name || "",
      quantity: String(prefill?.quantity || ""),
      unit_of_issue: prefill?.unit_of_issue || "EA",
      unit_price: String(prefill?.bid_price || prefill?.unit_price || ""),
      delivery_days: String(prefill?.delivery_days || ""),
      ship_to: prefill?.ship_to || "",
      fob: prefill?.fob || "",
      set_aside: prefill?.set_aside || "",
      ref_part_number: prefill?.ref_part_number || "",
      cage_supplier: prefill?.cage || "",
      award_date: today,
      funding_path: prefill?.funding_path || "self",
      supplier_name: prefill?.supplier_poc || "",
      supplier_quote_price: String(prefill?.supplier_quote_price || ""),
      actual_cost: String(prefill?.actual_cost || ""),
      shipping_cost: "0",
      payment_terms: "Net 30",
      invoice_date: today,
      dodaac: prefill?.dodaac || "",
      contracting_office: prefill?.contracting_office || "",
      entity: ENTITY_DEFAULT,
      payment_status: prefill?.payment_status || "unpaid",
      date_paid: prefill?.date_paid || "",
    };

    const [form, setForm] = useWState(initial);
    const [docNums, setDocNums] = useWState(null);
    const [saving, setSaving] = useWState(false);

    const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

    const qty = parseFloat(form.quantity) || 0;
    const unitBid = parseFloat(form.unit_price) || 0;
    const cogs = parseFloat(form.actual_cost || form.supplier_quote_price) || 0;
    const shipping = parseFloat(form.shipping_cost) || 0;
    const bidTotal = +(unitBid * qty).toFixed(2);
    const cogsTotal = +(cogs * qty + shipping).toFixed(2);
    const gp = +(bidTotal - cogsTotal).toFixed(2);
    const gpPct = bidTotal > 0 ? ((gp / bidTotal) * 100).toFixed(1) : "0.0";
    const sscFee =
      form.funding_path === "ssc" ? +(bidTotal * 0.06).toFixed(2) : 0;
    const netTake = +(gp - sscFee).toFixed(2);

    const cogsSource = form.actual_cost
      ? "confirmed"
      : form.supplier_quote_price
        ? "quoted"
        : "manual";

    const previewNums = () => {
      const entity = form.entity || ENTITY_DEFAULT;
      const base = peekDocNumber("PO", entity);
      const seqNum = base.split("-").pop();
      const year = new Date().getFullYear();
      return {
        po: "PO-" + entity + "-" + year + "-" + seqNum,
        so: "SO-" + entity + "-" + year + "-" + seqNum,
        inv: "INV-" + entity + "-" + year + "-" + seqNum,
      };
    };

    const [preview, setPreview] = useWState(() => previewNums());
    useWEffect(() => {
      setPreview(previewNums());
    }, [form.entity]);

    const handleConfirm = async () => {
      if (!form.sol_number) {
        showToast("Sol number required", true);
        return;
      }
      if (!form.nsn) {
        showToast("NSN required", true);
        return;
      }
      if (!form.quantity || !form.unit_price) {
        showToast("Qty and unit price required", true);
        return;
      }
      setSaving(true);

      const existing = await awardGetBySol(form.sol_number);
      let po_number, so_number, inv_number;
      if (existing) {
        po_number = existing.po_number;
        so_number = existing.so_number;
        inv_number = existing.inv_number;
      } else {
        po_number = nextDocNumber("PO", form.entity || ENTITY_DEFAULT);
        so_number = nextDocNumber("SO", form.entity || ENTITY_DEFAULT);
        inv_number = nextDocNumber("INV", form.entity || ENTITY_DEFAULT);
      }

      const record = {
        award_id: existing?.award_id || "AWD-" + Date.now(),
        sol_number: form.sol_number,
        po_number,
        so_number,
        inv_number,
        nsn: form.nsn,
        fsc: form.fsc,
        clin: form.clin,
        item_name: form.item_name,
        quantity: form.quantity,
        unit_of_issue: form.unit_of_issue,
        unit_price: form.unit_price,
        bid_total: String(bidTotal),
        delivery_days: form.delivery_days,
        ship_to: form.ship_to,
        fob: form.fob,
        set_aside: form.set_aside,
        ref_part_number: form.ref_part_number,
        cage_supplier: form.cage_supplier,
        dodaac: form.dodaac,
        contracting_office: form.contracting_office,
        award_date: form.award_date,
        invoice_date: form.invoice_date,
        payment_terms: form.payment_terms,
        funding_path: form.funding_path,
        entity: form.entity || ENTITY_DEFAULT,
        supplier_name: form.supplier_name,
        supplier_quote_price: form.supplier_quote_price,
        actual_cost: form.actual_cost,
        shipping_cost: form.shipping_cost,
        cogs_total: String(cogsTotal),
        gross_profit: String(gp),
        gp_pct: gpPct,
        ssc_fee: String(sscFee),
        net_take: String(netTake),
        cogs_source: cogsSource,
        inv_status: existing?.inv_status || "draft",
        so_status: existing?.so_status || "open",
        payment_status: form.payment_status || "unpaid",
        date_paid: form.date_paid || "",
        last_updated: new Date().toISOString(),
      };

      await awardSave(record);
      setDocNums({ po_number, so_number, inv_number });
      setSaving(false);
      showToast(po_number + " — Award record saved");
      if (onSave) onSave(record);
    };

    const gpColor =
      parseFloat(gpPct) >= 25
        ? "var(--accent-green)"
        : parseFloat(gpPct) >= 18
          ? "var(--amber)"
          : "var(--red)";

    return hW(
      "div",
      {
        style: {
          maxWidth: "860px",
          margin: "0 auto",
          animation: "fadeUp .4s ease both",
        },
      },

      hW(
        "div",
        { style: { marginBottom: "28px" } },
        hW(
          "div",
          {
            style: {
              ...cinzel,
              fontSize: "10px",
              letterSpacing: ".28em",
              textTransform: "uppercase",
              color: "var(--gold-dim)",
              marginBottom: "8px",
            },
          },
          "◆ Award Processing",
        ),
        hW(
          "div",
          {
            style: {
              ...cinzel,
              fontSize: "22px",
              letterSpacing: ".08em",
              ...gold,
            },
          },
          "New Award Record",
        ),
        hW(
          "div",
          {
            style: {
              fontFamily: "Cormorant Garamond,serif",
              fontSize: "14px",
              fontStyle: "italic",
              color: "var(--body-faint)",
              marginTop: "4px",
            },
          },
          "All fields are editable before confirming. Document numbers are issued on confirm.",
        ),
      ),

      // Doc number preview bar
      hW(
        "div",
        {
          style: {
            background: "var(--surface-sheen)",
            border: "1px solid rgba(201,168,76,.2)",
            borderLeft: "3px solid var(--gold-solid)",
            padding: "14px 18px",
            marginBottom: "24px",
            display: "flex",
            gap: "32px",
            flexWrap: "wrap",
            alignItems: "center",
          },
        },
        hW(
          "div",
          {
            style: {
              ...cinzel,
              fontSize: "9px",
              letterSpacing: ".18em",
              textTransform: "uppercase",
              color: "var(--gold-dim)",
              flex: "0 0 auto",
            },
          },
          "Document Numbers",
        ),
        ...[
          ["PO", preview.po],
          ["SO", preview.so],
          ["INV", preview.inv],
        ].map(([type, num]) =>
          hW(
            "div",
            {
              key: type,
              style: { display: "flex", flexDirection: "column", gap: "2px" },
            },
            hW(
              "div",
              {
                style: {
                  ...cinzel,
                  fontSize: "8px",
                  letterSpacing: ".1em",
                  color: "var(--gold-dim)",
                },
              },
              type,
            ),
            hW(
              "div",
              {
                style: {
                  ...mono,
                  fontSize: "13px",
                  color: docNums ? "var(--accent-green)" : "var(--alabaster)",
                },
              },
              docNums
                ? type === "PO"
                  ? docNums.po_number
                  : type === "SO"
                    ? docNums.so_number
                    : docNums.inv_number
                : num + " (preview)",
            ),
          ),
        ),
        hW(
          "div",
          {
            style: {
              marginLeft: "auto",
              display: "flex",
              flexDirection: "column",
              gap: "4px",
            },
          },
          hW("label", { style: labelStyle }, "Entity Code"),
          hW("input", {
            value: form.entity,
            onChange: (e) =>
              set("entity", e.target.value.toUpperCase().slice(0, 6)),
            placeholder: "IMP",
            style: { ...fieldStyle, width: "80px", textTransform: "uppercase" },
          }),
        ),
      ),

      section("Contract Record"),
      hW(
        "div",
        {
          style: {
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))",
            gap: "12px",
            marginBottom: "8px",
          },
        },
        hW(Field, {
          label: "Sol Number",
          value: form.sol_number,
          onChange: (v) => set("sol_number", v),
        }),
        hW(Field, {
          label: "NSN",
          value: form.nsn,
          onChange: (v) => set("nsn", v),
        }),
        hW(Field, {
          label: "FSC",
          value: form.fsc,
          onChange: (v) => set("fsc", v),
        }),
        hW(Field, {
          label: "CLIN",
          value: form.clin,
          onChange: (v) => set("clin", v),
        }),
        hW(Field, {
          label: "Item Name",
          value: form.item_name,
          onChange: (v) => set("item_name", v),
        }),
        hW(Field, {
          label: "Ref Part Number",
          value: form.ref_part_number,
          onChange: (v) => set("ref_part_number", v),
        }),
        hW(Field, {
          label: "Quantity",
          value: form.quantity,
          onChange: (v) => set("quantity", v),
          type: "number",
        }),
        hW(Field, {
          label: "Unit of Issue",
          value: form.unit_of_issue,
          onChange: (v) => set("unit_of_issue", v),
        }),
        hW(Field, {
          label: "Award Unit Price ($)",
          value: form.unit_price,
          onChange: (v) => set("unit_price", v),
          type: "number",
        }),
        hW(Field, {
          label: "Award Date",
          value: form.award_date,
          onChange: (v) => set("award_date", v),
        }),
        hW(Field, {
          label: "Delivery (days ARO)",
          value: form.delivery_days,
          onChange: (v) => set("delivery_days", v),
        }),
        hW(Field, {
          label: "Ship To",
          value: form.ship_to,
          onChange: (v) => set("ship_to", v),
        }),
        hW(Field, {
          label: "FOB",
          value: form.fob,
          onChange: (v) => set("fob", v),
        }),
        hW(Field, {
          label: "Set Aside",
          value: form.set_aside,
          onChange: (v) => set("set_aside", v),
        }),
        hW(Field, {
          label: "CAGE (Supplier)",
          value: form.cage_supplier,
          onChange: (v) => set("cage_supplier", v),
        }),
      ),

      section("Government Office"),
      hW(
        "div",
        {
          style: {
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))",
            gap: "12px",
            marginBottom: "8px",
          },
        },
        hW(Field, {
          label: "DoDAAC (Paying Office)",
          value: form.dodaac,
          onChange: (v) => set("dodaac", v),
        }),
        hW(Field, {
          label: "Contracting Office / CO",
          value: form.contracting_office,
          onChange: (v) => set("contracting_office", v),
        }),
      ),

      section("Sales Order — Supplier & COGS"),
      hW(
        "div",
        {
          style: {
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))",
            gap: "12px",
            marginBottom: "8px",
          },
        },
        hW(Field, {
          label: "Supplier Name",
          value: form.supplier_name,
          onChange: (v) => set("supplier_name", v),
        }),
        hW(Field, {
          label: "Supplier Quote Price ($)",
          value: form.supplier_quote_price,
          onChange: (v) => set("supplier_quote_price", v),
          type: "number",
          placeholder: "Auto-pulled if in sourcing",
        }),
        hW(Field, {
          label: "Actual Cost / ea ($)",
          value: form.actual_cost,
          onChange: (v) => set("actual_cost", v),
          type: "number",
          placeholder: "Override if confirmed",
        }),
        hW(Field, {
          label: "Shipping Cost ($)",
          value: form.shipping_cost,
          onChange: (v) => set("shipping_cost", v),
          type: "number",
        }),
      ),

      hW(
        "div",
        { style: { marginBottom: "16px" } },
        hW(
          "div",
          {
            style: {
              ...cinzel,
              fontSize: "9px",
              letterSpacing: ".14em",
              textTransform: "uppercase",
              color: "var(--gold-dim)",
              marginBottom: "8px",
            },
          },
          "Funding Path",
        ),
        hW(
          "div",
          { style: { display: "flex", gap: "10px" } },
          ...[
            ["self", "Self-Funded (\u2264$10K)", "var(--accent-green)"],
            ["ssc", "SSC / Factoring (6%)", "var(--amber)"],
          ].map(([val, lbl, clr]) =>
            hW(
              "button",
              {
                key: val,
                onClick: () => set("funding_path", val),
                style: {
                  padding: "8px 18px",
                  background:
                    form.funding_path === val
                      ? val === "self"
                        ? "rgba(61,214,140,.12)"
                        : "rgba(243,156,18,.12)"
                      : "var(--inset-bg)",
                  border:
                    "1px solid " +
                    (form.funding_path === val ? clr : "rgba(201,168,76,.15)"),
                  color: form.funding_path === val ? clr : "var(--body-dim)",
                  ...cinzel,
                  fontSize: "10px",
                  letterSpacing: ".1em",
                  cursor: "pointer",
                  transition: "all .15s",
                },
              },
              lbl,
            ),
          ),
        ),
      ),

      bidTotal > 0 &&
        hW(
          "div",
          {
            style: {
              background: "var(--surface-sheen)",
              border: "1px solid rgba(201,168,76,.15)",
              borderLeft: "3px solid " + gpColor,
              padding: "16px 20px",
              marginBottom: "24px",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))",
              gap: "16px",
            },
          },
          ...[
            ["Bid Total", fmt(bidTotal)],
            ["COGS Total", fmt(cogsTotal)],
            ["Gross Profit", fmt(gp)],
            ["GP %", gpPct + "%"],
            form.funding_path === "ssc" ? ["SSC Fee (6%)", fmt(sscFee)] : null,
            ["Net Take Home", fmt(netTake)],
          ]
            .filter(Boolean)
            .map(([lbl, val], i) =>
              hW(
                "div",
                { key: i },
                hW(
                  "div",
                  {
                    style: {
                      ...cinzel,
                      fontSize: "8px",
                      letterSpacing: ".12em",
                      textTransform: "uppercase",
                      color: "var(--gold-dim)",
                      marginBottom: "4px",
                    },
                  },
                  lbl,
                ),
                hW(
                  "div",
                  {
                    style: {
                      ...mono,
                      fontSize: i >= 3 ? "16px" : "14px",
                      fontWeight: "700",
                      color:
                        lbl === "Net Take Home"
                          ? gpColor
                          : lbl === "GP %"
                            ? gpColor
                            : "var(--alabaster)",
                    },
                  },
                  val,
                ),
              ),
            ),
        ),

      section("Invoice & Payment"),
      hW(
        "div",
        {
          style: {
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))",
            gap: "12px",
            marginBottom: "24px",
          },
        },
        hW(Field, {
          label: "Invoice Date",
          value: form.invoice_date,
          onChange: (v) => set("invoice_date", v),
        }),
        hW(Field, {
          label: "Payment Terms",
          value: form.payment_terms,
          onChange: (v) => set("payment_terms", v),
        }),
        hW(SelectField, {
          label: "Payment Status",
          value: form.payment_status,
          onChange: (v) => set("payment_status", v),
          options: [
            ["unpaid", "Unpaid"],
            ["partial", "Partial"],
            ["paid", "Paid"],
            ["overdue", "Overdue"],
          ],
        }),
        hW(Field, {
          label: "Date Paid",
          value: form.date_paid,
          onChange: (v) => set("date_paid", v),
          placeholder: "MM/DD/YYYY",
        }),
      ),

      hW(
        "div",
        {
          style: {
            display: "flex",
            gap: "12px",
            marginBottom: "40px",
            alignItems: "center",
          },
        },
        hW(
          "button",
          {
            className: "btn btn-primary",
            onClick: handleConfirm,
            disabled: saving,
            style: {
              fontSize: "12px",
              padding: "12px 36px",
              opacity: saving ? 0.6 : 1,
            },
          },
          hW("span", { className: "glint" }),
          saving
            ? "Saving\u2026"
            : docNums
              ? "\u2713 Award Confirmed \u2014 Update Record"
              : "\u25c6 Confirm Award & Issue Documents",
        ),
        onCancel &&
          hW(
            "button",
            {
              onClick: onCancel,
              style: {
                padding: "12px 24px",
                background: "transparent",
                border: "1px solid rgba(201,168,76,.25)",
                color: "var(--body-dim)",
                ...cinzel,
                fontSize: "10px",
                letterSpacing: ".1em",
                cursor: "pointer",
              },
            },
            "Cancel",
          ),
        docNums &&
          hW(
            "div",
            {
              style: {
                ...cinzel,
                fontSize: "10px",
                letterSpacing: ".1em",
                color: "var(--accent-green)",
              },
            },
            "\u2713 " +
              docNums.po_number +
              " \u00b7 " +
              docNums.so_number +
              " \u00b7 " +
              docNums.inv_number,
          ),
      ),
    );
  }

  // ── AWARD DETAIL ─────────────────────────────────────────────────────
  function AwardDetail({ record, onEdit, onVoid, showToast }) {
    const { fmt } = window.SCC_MATH;
    const [activePanel, setActivePanel] = useWState("contract");

    const panels = [
      ["contract", "Contract Record"],
      ["so", "Sales Order"],
      ["invoice", "Invoice"],
      ["wawf", "\u29c9 WAWF Mirror"],
    ];

    const gpColor =
      parseFloat(record.gp_pct) >= 25
        ? "var(--accent-green)"
        : parseFloat(record.gp_pct) >= 18
          ? "var(--amber)"
          : "var(--red)";

    const invStatusColors = {
      draft: "var(--body-dim)",
      issued: "var(--amber)",
      submitted: "var(--accent-blue)",
      paid: "var(--accent-green)",
    };

    return hW(
      "div",
      { style: { animation: "fadeUp .4s ease both" } },

      // Top bar
      hW(
        "div",
        {
          style: {
            display: "flex",
            gap: "16px",
            alignItems: "flex-start",
            marginBottom: "20px",
            flexWrap: "wrap",
          },
        },
        hW(
          "div",
          { style: { flex: 1 } },
          hW(
            "div",
            {
              style: {
                ...cinzel,
                fontSize: "10px",
                letterSpacing: ".22em",
                textTransform: "uppercase",
                color: "var(--gold-dim)",
                marginBottom: "6px",
              },
            },
            "\u25c6 Award Record",
          ),
          hW(
            "div",
            {
              style: {
                ...cinzel,
                fontSize: "20px",
                letterSpacing: ".06em",
                ...gold,
              },
            },
            record.sol_number,
          ),
          hW(
            "div",
            {
              style: {
                ...mono,
                fontSize: "12px",
                color: "var(--body-dim)",
                marginTop: "4px",
              },
            },
            record.item_name || "\u2014",
          ),
        ),
        hW(
          "div",
          { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
          hW(
            "button",
            {
              onClick: onEdit,
              style: {
                padding: "7px 16px",
                background: "var(--surface-sheen)",
                border: "1px solid rgba(201,168,76,.3)",
                color: "var(--gold-solid)",
                ...cinzel,
                fontSize: "10px",
                letterSpacing: ".1em",
                cursor: "pointer",
              },
            },
            "\u270e Edit",
          ),
          hW(
            "button",
            {
              onClick: () => {
                if (
                  confirm(
                    "Void this award record? Document numbers will be retired to the void log.",
                  )
                )
                  onVoid(record.award_id);
              },
              style: {
                padding: "7px 16px",
                background: "transparent",
                border: "1px solid rgba(231,76,60,.3)",
                color: "rgba(231,76,60,.7)",
                ...cinzel,
                fontSize: "10px",
                letterSpacing: ".1em",
                cursor: "pointer",
              },
            },
            "\u2297 Void",
          ),
        ),
      ),

      // Doc chips + status chips
      hW(
        "div",
        {
          style: {
            display: "flex",
            gap: "10px",
            flexWrap: "wrap",
            marginBottom: "20px",
          },
        },
        ...[
          ["PO", record.po_number],
          ["SO", record.so_number],
          ["INV", record.inv_number],
        ].map(([type, num]) =>
          hW(
            "div",
            {
              key: type,
              style: {
                padding: "6px 14px",
                background: "var(--surface-sheen)",
                border: "1px solid rgba(201,168,76,.18)",
                borderRadius: "2px",
                display: "flex",
                gap: "10px",
                alignItems: "center",
              },
            },
            hW(
              "span",
              {
                style: {
                  ...cinzel,
                  fontSize: "8px",
                  letterSpacing: ".12em",
                  color: "var(--gold-dim)",
                },
              },
              type,
            ),
            hW(
              "span",
              {
                style: { ...mono, fontSize: "13px", color: "var(--alabaster)" },
              },
              num,
            ),
          ),
        ),
        // INV status chip
        hW(
          "div",
          {
            style: {
              padding: "6px 14px",
              background: "var(--surface-sheen)",
              border:
                "1px solid " +
                (invStatusColors[record.inv_status] || "rgba(201,168,76,.18)"),
              borderRadius: "2px",
            },
          },
          hW(
            "span",
            {
              style: {
                ...cinzel,
                fontSize: "9px",
                letterSpacing: ".1em",
                textTransform: "uppercase",
                color: invStatusColors[record.inv_status] || "var(--body-dim)",
              },
            },
            "INV: " + (record.inv_status || "draft"),
          ),
        ),
        // Pay status chip
        hW(
          "div",
          {
            style: {
              padding: "6px 14px",
              background: "var(--surface-sheen)",
              border:
                "1px solid " +
                (payStatusColors[record.payment_status] ||
                  "rgba(201,168,76,.18)"),
              borderRadius: "2px",
            },
          },
          hW(
            "span",
            {
              style: {
                ...cinzel,
                fontSize: "9px",
                letterSpacing: ".1em",
                textTransform: "uppercase",
                color:
                  payStatusColors[record.payment_status] || "var(--body-dim)",
              },
            },
            "PAY: " +
              (record.payment_status || "unpaid") +
              (record.date_paid ? " \u00b7 " + record.date_paid : ""),
          ),
        ),
      ),

      // Panel nav
      hW(
        "div",
        {
          style: {
            display: "flex",
            gap: "4px",
            marginBottom: "20px",
            borderBottom: "1px solid rgba(201,168,76,.12)",
          },
        },
        ...panels.map(([id, lbl]) =>
          hW(
            "button",
            {
              key: id,
              onClick: () => setActivePanel(id),
              style: {
                padding: "9px 18px",
                background: "transparent",
                border: "none",
                borderBottom:
                  activePanel === id
                    ? "2px solid var(--gold-solid)"
                    : "2px solid transparent",
                color:
                  activePanel === id ? "var(--gold-solid)" : "var(--body-dim)",
                ...cinzel,
                fontSize: "10px",
                letterSpacing: ".12em",
                cursor: "pointer",
                marginBottom: "-1px",
                transition: "all .15s",
              },
            },
            lbl,
          ),
        ),
      ),

      // CONTRACT PANEL
      activePanel === "contract" &&
        hW(
          "div",
          {
            style: {
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))",
              gap: "12px",
              animation: "fadeUp .3s ease both",
            },
          },
          ...[
            ["Sol Number", record.sol_number],
            ["NSN", record.nsn],
            ["FSC", record.fsc],
            ["CLIN", record.clin],
            ["Item Name", record.item_name],
            ["Ref Part Number", record.ref_part_number],
            [
              "Quantity",
              record.quantity + " " + (record.unit_of_issue || "EA"),
            ],
            ["Award Unit Price", fmt(parseFloat(record.unit_price))],
            ["Bid Total", fmt(parseFloat(record.bid_total))],
            ["Award Date", record.award_date],
            [
              "Delivery",
              record.delivery_days
                ? record.delivery_days + " days ARO"
                : "\u2014",
            ],
            ["Ship To", record.ship_to],
            ["FOB", record.fob],
            ["Set Aside", record.set_aside],
            ["CAGE (Supplier)", record.cage_supplier],
            ["DoDAAC", record.dodaac],
            ["Contracting Office", record.contracting_office],
          ].map(([lbl, val]) =>
            hW(
              "div",
              {
                key: lbl,
                style: {
                  background: "var(--surface-sheen)",
                  border: "1px solid rgba(201,168,76,.1)",
                  padding: "12px 14px",
                },
              },
              hW(
                "div",
                {
                  style: {
                    ...cinzel,
                    fontSize: "8px",
                    letterSpacing: ".12em",
                    textTransform: "uppercase",
                    color: "var(--gold-dim)",
                    marginBottom: "4px",
                  },
                },
                lbl,
              ),
              hW(
                "div",
                {
                  style: {
                    ...mono,
                    fontSize: "13px",
                    color: val ? "var(--alabaster)" : "var(--body-faint)",
                    fontStyle: val ? "normal" : "italic",
                  },
                },
                val || "\u2014",
              ),
            ),
          ),
        ),

      // SALES ORDER PANEL
      activePanel === "so" &&
        hW(
          "div",
          { style: { animation: "fadeUp .3s ease both" } },
          hW(
            "div",
            {
              style: {
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))",
                gap: "12px",
                marginBottom: "20px",
              },
            },
            ...[
              ["SO Number", record.so_number],
              ["Supplier", record.supplier_name],
              ["Quote Price/ea", fmt(parseFloat(record.supplier_quote_price))],
              [
                "Actual Cost/ea",
                fmt(
                  parseFloat(record.actual_cost || record.supplier_quote_price),
                ),
              ],
              ["COGS Source", record.cogs_source],
              ["Shipping", fmt(parseFloat(record.shipping_cost) || 0)],
              ["COGS Total", fmt(parseFloat(record.cogs_total))],
              ["Gross Profit", fmt(parseFloat(record.gross_profit))],
              ["GP %", record.gp_pct + "%"],
              [
                "Funding Path",
                record.funding_path === "ssc"
                  ? "SSC / Factoring"
                  : "Self-Funded",
              ],
              record.funding_path === "ssc"
                ? ["SSC Fee (6%)", fmt(parseFloat(record.ssc_fee))]
                : null,
              ["Net Take Home", fmt(parseFloat(record.net_take))],
              ["SO Status", record.so_status],
            ]
              .filter(Boolean)
              .map(([lbl, val]) =>
                hW(
                  "div",
                  {
                    key: lbl,
                    style: {
                      background: "var(--surface-sheen)",
                      border: "1px solid rgba(201,168,76,.1)",
                      padding: "12px 14px",
                      borderLeft:
                        lbl === "Net Take Home"
                          ? "3px solid " + gpColor
                          : undefined,
                    },
                  },
                  hW(
                    "div",
                    {
                      style: {
                        ...cinzel,
                        fontSize: "8px",
                        letterSpacing: ".12em",
                        textTransform: "uppercase",
                        color: "var(--gold-dim)",
                        marginBottom: "4px",
                      },
                    },
                    lbl,
                  ),
                  hW(
                    "div",
                    {
                      style: {
                        ...mono,
                        fontSize: lbl === "Net Take Home" ? "16px" : "13px",
                        fontWeight: lbl === "Net Take Home" ? "700" : "400",
                        color:
                          lbl === "Net Take Home" || lbl === "GP %"
                            ? gpColor
                            : val
                              ? "var(--alabaster)"
                              : "var(--body-faint)",
                      },
                    },
                    val || "\u2014",
                  ),
                ),
              ),
          ),
        ),

      // INVOICE PANEL
      activePanel === "invoice" &&
        hW(
          "div",
          { style: { animation: "fadeUp .3s ease both" } },
          hW(
            "div",
            {
              style: {
                background: "var(--surface-sheen)",
                border: "1px solid rgba(201,168,76,.25)",
                padding: "32px 36px",
                maxWidth: "720px",
                marginBottom: "20px",
              },
            },
            hW(
              "div",
              {
                style: {
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: "28px",
                  flexWrap: "wrap",
                  gap: "16px",
                },
              },
              hW(
                "div",
                null,
                hW(
                  "div",
                  {
                    style: {
                      ...cinzel,
                      fontSize: "24px",
                      fontWeight: "900",
                      letterSpacing: ".18em",
                      ...gold,
                    },
                  },
                  "IMPERIO",
                ),
                hW(
                  "div",
                  {
                    style: {
                      fontFamily: "Cormorant Garamond,serif",
                      fontStyle: "italic",
                      fontSize: "13px",
                      color: "var(--body-dim)",
                      letterSpacing: ".12em",
                    },
                  },
                  "Talent Solutions \u00b7 Mil-Spec Supply",
                ),
                hW(
                  "div",
                  {
                    style: {
                      ...mono,
                      fontSize: "11px",
                      color: "var(--body-faint)",
                      marginTop: "6px",
                    },
                  },
                  "CAGE 152U4 \u00b7 SDVOSB \u00b7 Killeen, TX",
                ),
                hW(
                  "div",
                  {
                    style: {
                      ...mono,
                      fontSize: "11px",
                      color: "var(--body-faint)",
                    },
                  },
                  "anthony@imperiovita.co \u00b7 (254) 265-9335",
                ),
              ),
              hW(
                "div",
                { style: { textAlign: "right" } },
                hW(
                  "div",
                  {
                    style: {
                      ...cinzel,
                      fontSize: "18px",
                      letterSpacing: ".14em",
                      color: "var(--gold-solid)",
                    },
                  },
                  "INVOICE",
                ),
                hW(
                  "div",
                  {
                    style: {
                      ...mono,
                      fontSize: "13px",
                      color: "var(--alabaster)",
                      marginTop: "4px",
                    },
                  },
                  record.inv_number,
                ),
                hW(
                  "div",
                  {
                    style: {
                      ...mono,
                      fontSize: "11px",
                      color: "var(--body-dim)",
                      marginTop: "4px",
                    },
                  },
                  "Date: " + record.invoice_date,
                ),
                hW(
                  "div",
                  {
                    style: {
                      ...mono,
                      fontSize: "11px",
                      color: "var(--body-dim)",
                    },
                  },
                  "Terms: " + record.payment_terms,
                ),
              ),
            ),
            hW("div", {
              style: {
                borderTop: "1px solid rgba(201,168,76,.25)",
                marginBottom: "20px",
              },
            }),
            hW(
              "div",
              { style: { marginBottom: "20px" } },
              hW(
                "div",
                {
                  style: {
                    ...cinzel,
                    fontSize: "9px",
                    letterSpacing: ".18em",
                    textTransform: "uppercase",
                    color: "var(--gold-dim)",
                    marginBottom: "6px",
                  },
                },
                "Bill To",
              ),
              hW(
                "div",
                {
                  style: {
                    ...mono,
                    fontSize: "12px",
                    color: "var(--alabaster)",
                  },
                },
                record.contracting_office || "\u2014",
              ),
              hW(
                "div",
                {
                  style: {
                    ...mono,
                    fontSize: "12px",
                    color: "var(--body-dim)",
                  },
                },
                "DoDAAC: " + (record.dodaac || "\u2014"),
              ),
            ),
            hW(
              "div",
              {
                style: {
                  marginBottom: "20px",
                  display: "flex",
                  gap: "32px",
                  flexWrap: "wrap",
                },
              },
              ...[
                ["Contract / Sol", record.sol_number],
                ["PO Number", record.po_number],
                ["CLIN", record.clin],
                ["Award Date", record.award_date],
              ].map(([lbl, val]) =>
                hW(
                  "div",
                  { key: lbl },
                  hW(
                    "div",
                    {
                      style: {
                        ...cinzel,
                        fontSize: "8px",
                        letterSpacing: ".12em",
                        textTransform: "uppercase",
                        color: "var(--gold-dim)",
                        marginBottom: "2px",
                      },
                    },
                    lbl,
                  ),
                  hW(
                    "div",
                    {
                      style: {
                        ...mono,
                        fontSize: "12px",
                        color: "var(--alabaster)",
                      },
                    },
                    val || "\u2014",
                  ),
                ),
              ),
            ),
            hW(
              "div",
              { style: { marginBottom: "24px" } },
              hW(
                "div",
                {
                  style: {
                    display: "grid",
                    gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr",
                    gap: "0",
                    borderBottom: "1px solid rgba(201,168,76,.3)",
                    paddingBottom: "8px",
                    marginBottom: "8px",
                  },
                },
                ...[
                  "Description",
                  "NSN / P/N",
                  "Qty",
                  "Unit Price",
                  "Total",
                ].map((h) =>
                  hW(
                    "div",
                    {
                      key: h,
                      style: {
                        ...cinzel,
                        fontSize: "9px",
                        letterSpacing: ".12em",
                        textTransform: "uppercase",
                        color: "var(--gold-dim)",
                      },
                    },
                    h,
                  ),
                ),
              ),
              hW(
                "div",
                {
                  style: {
                    display: "grid",
                    gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr",
                    gap: "0",
                    paddingBottom: "12px",
                    borderBottom: "1px solid rgba(201,168,76,.12)",
                  },
                },
                hW(
                  "div",
                  {
                    style: {
                      ...mono,
                      fontSize: "12px",
                      color: "var(--alabaster)",
                    },
                  },
                  record.item_name || "\u2014",
                ),
                hW(
                  "div",
                  {
                    style: {
                      ...mono,
                      fontSize: "12px",
                      color: "var(--alabaster)",
                    },
                  },
                  record.nsn +
                    (record.ref_part_number
                      ? "\n" + record.ref_part_number
                      : ""),
                ),
                hW(
                  "div",
                  {
                    style: {
                      ...mono,
                      fontSize: "12px",
                      color: "var(--alabaster)",
                    },
                  },
                  record.quantity + " " + (record.unit_of_issue || "EA"),
                ),
                hW(
                  "div",
                  {
                    style: {
                      ...mono,
                      fontSize: "12px",
                      color: "var(--alabaster)",
                    },
                  },
                  fmt(parseFloat(record.unit_price)),
                ),
                hW(
                  "div",
                  {
                    style: {
                      ...mono,
                      fontSize: "12px",
                      fontWeight: "700",
                      color: "var(--alabaster)",
                    },
                  },
                  fmt(parseFloat(record.bid_total)),
                ),
              ),
              hW(
                "div",
                {
                  style: {
                    display: "flex",
                    justifyContent: "flex-end",
                    paddingTop: "12px",
                    gap: "24px",
                    alignItems: "center",
                  },
                },
                hW(
                  "div",
                  {
                    style: {
                      ...cinzel,
                      fontSize: "10px",
                      letterSpacing: ".14em",
                      textTransform: "uppercase",
                      color: "var(--gold-dim)",
                    },
                  },
                  "Invoice Total",
                ),
                hW(
                  "div",
                  {
                    style: {
                      ...mono,
                      fontSize: "18px",
                      fontWeight: "700",
                      ...gold,
                    },
                  },
                  fmt(parseFloat(record.bid_total)),
                ),
              ),
            ),
          ),

          // Status controls row
          hW(
            "div",
            {
              style: {
                display: "flex",
                gap: "32px",
                alignItems: "flex-start",
                flexWrap: "wrap",
              },
            },
            // Invoice status
            hW(
              "div",
              null,
              hW(
                "div",
                {
                  style: {
                    ...cinzel,
                    fontSize: "9px",
                    letterSpacing: ".14em",
                    textTransform: "uppercase",
                    color: "var(--gold-dim)",
                    marginBottom: "8px",
                  },
                },
                "Invoice Status",
              ),
              hW(
                "div",
                { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
                ...["draft", "issued", "submitted", "paid"].map((s) =>
                  hW(
                    "button",
                    {
                      key: s,
                      onClick: () => {
                        const updated = {
                          ...record,
                          inv_status: s,
                          last_updated: new Date().toISOString(),
                        };
                        window.SCC_DB.awardSave(updated).then(() =>
                          showToast(record.inv_number + " \u2192 " + s),
                        );
                      },
                      style: {
                        padding: "6px 14px",
                        background:
                          record.inv_status === s
                            ? "rgba(201,168,76,.1)"
                            : "transparent",
                        border:
                          "1px solid " +
                          (record.inv_status === s
                            ? invStatusColors[s] || "var(--gold-solid)"
                            : "rgba(201,168,76,.18)"),
                        color:
                          record.inv_status === s
                            ? invStatusColors[s] || "var(--gold-solid)"
                            : "var(--body-dim)",
                        ...cinzel,
                        fontSize: "9px",
                        letterSpacing: ".1em",
                        textTransform: "uppercase",
                        cursor: "pointer",
                        transition: "all .15s",
                      },
                    },
                    s,
                  ),
                ),
              ),
            ),
            // Payment status
            hW(
              "div",
              null,
              hW(
                "div",
                {
                  style: {
                    ...cinzel,
                    fontSize: "9px",
                    letterSpacing: ".14em",
                    textTransform: "uppercase",
                    color: "var(--gold-dim)",
                    marginBottom: "8px",
                  },
                },
                "Payment Status",
              ),
              hW(
                "div",
                { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
                ...["unpaid", "partial", "paid", "overdue"].map((s) =>
                  hW(
                    "button",
                    {
                      key: s,
                      onClick: () => {
                        const datePaid =
                          s === "paid"
                            ? record.date_paid ||
                              new Date().toLocaleDateString()
                            : record.date_paid;
                        const updated = {
                          ...record,
                          payment_status: s,
                          date_paid: datePaid,
                          last_updated: new Date().toISOString(),
                        };
                        window.SCC_DB.awardSave(updated).then(() =>
                          showToast("Payment: " + s),
                        );
                      },
                      style: {
                        padding: "6px 14px",
                        background:
                          record.payment_status === s
                            ? "rgba(201,168,76,.07)"
                            : "transparent",
                        border:
                          "1px solid " +
                          (record.payment_status === s
                            ? payStatusColors[s]
                            : "rgba(201,168,76,.18)"),
                        color:
                          record.payment_status === s
                            ? payStatusColors[s]
                            : "var(--body-dim)",
                        ...cinzel,
                        fontSize: "9px",
                        letterSpacing: ".1em",
                        textTransform: "uppercase",
                        cursor: "pointer",
                        transition: "all .15s",
                      },
                    },
                    s,
                  ),
                ),
              ),
              record.date_paid &&
                hW(
                  "div",
                  {
                    style: {
                      ...mono,
                      fontSize: "11px",
                      color: "var(--body-dim)",
                      marginTop: "6px",
                    },
                  },
                  "Paid: " + record.date_paid,
                ),
            ),
          ),
        ),

      // WAWF PANEL
      activePanel === "wawf" &&
        hW(
          "div",
          { style: { animation: "fadeUp .3s ease both" } },
          hW(
            "div",
            {
              style: {
                background: "var(--surface-sheen)",
                border: "1px solid rgba(126,184,247,.2)",
                borderLeft: "3px solid var(--accent-blue)",
                padding: "14px 18px",
                marginBottom: "20px",
              },
            },
            hW(
              "div",
              {
                style: {
                  ...cinzel,
                  fontSize: "9px",
                  letterSpacing: ".18em",
                  textTransform: "uppercase",
                  color: "var(--accent-blue)",
                  marginBottom: "4px",
                },
              },
              "\u29c9 WAWF Mirror \u2014 Wide Area Workflow",
            ),
            hW(
              "div",
              {
                style: {
                  fontFamily: "Cormorant Garamond,serif",
                  fontSize: "13px",
                  fontStyle: "italic",
                  color: "var(--body-dim)",
                },
              },
              "Each field maps directly to a WAWF input. Click any cell to copy its value, then paste into WAWF.",
            ),
          ),
          hW(
            "div",
            {
              style: {
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))",
                gap: "10px",
              },
            },
            hW(CopyCell, {
              label: "Contract Number / Solicitation",
              value: record.sol_number,
            }),
            hW(CopyCell, { label: "CAGE Code (Your Company)", value: "152U4" }),
            hW(CopyCell, {
              label: "DoDAAC (Paying Office)",
              value: record.dodaac,
            }),
            hW(CopyCell, { label: "Invoice Number", value: record.inv_number }),
            hW(CopyCell, { label: "Invoice Date", value: record.invoice_date }),
            hW(CopyCell, { label: "PO Number", value: record.po_number }),
            hW(CopyCell, { label: "CLIN", value: record.clin }),
            hW(CopyCell, { label: "NSN", value: record.nsn }),
            hW(CopyCell, {
              label: "Part Number",
              value: record.ref_part_number,
            }),
            hW(CopyCell, { label: "Quantity", value: record.quantity }),
            hW(CopyCell, {
              label: "Unit of Issue",
              value: record.unit_of_issue,
            }),
            hW(CopyCell, { label: "Unit Price ($)", value: record.unit_price }),
            hW(CopyCell, {
              label: "Total Amount ($)",
              value: record.bid_total,
            }),
            hW(CopyCell, {
              label: "Ship Date / Delivery Date",
              value: record.award_date,
            }),
            hW(CopyCell, {
              label: "Contracting Office",
              value: record.contracting_office,
            }),
            hW(CopyCell, {
              label: "Shipment Number (use INV suffix)",
              value: record.inv_number
                ? record.inv_number.split("-").pop()
                : "",
            }),
          ),
        ),
    );
  }

  // ── AWARDS TAB ROOT ──────────────────────────────────────────────────
  function AwardsTab({ awardPrefill, onPrefillConsumed, showToast }) {
    const { awardGetAll, awardVoid } = window.SCC_DB;
    const { fmt } = window.SCC_MATH;

    const [view, setView] = useWState("list");
    const [awards, setAwards] = useWState([]);
    const [selected, setSelected] = useWState(null);
    const [editRecord, setEditRecord] = useWState(null);
    const [search, setSearch] = useWState("");

    const loadAwards = () => awardGetAll().then(setAwards);

    useWEffect(() => {
      loadAwards();
    }, []);

    useWEffect(() => {
      if (awardPrefill) {
        setEditRecord(null);
        setView("new");
        if (onPrefillConsumed) onPrefillConsumed();
      }
    }, [awardPrefill]);

    const handleVoid = async (award_id) => {
      const reason = prompt("Void reason (for audit log):") || "voided by user";
      await awardVoid(award_id, reason);
      await loadAwards();
      setView("list");
      showToast("Award voided \u2014 document numbers retired to void log");
    };

    const filtered = awards.filter((r) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        (r.sol_number || "").toLowerCase().includes(q) ||
        (r.nsn || "").includes(q) ||
        (r.po_number || "").toLowerCase().includes(q) ||
        (r.inv_number || "").toLowerCase().includes(q) ||
        (r.item_name || "").toLowerCase().includes(q)
      );
    });

    const invStatusColors = {
      draft: "var(--body-dim)",
      issued: "var(--amber)",
      submitted: "var(--accent-blue)",
      paid: "var(--accent-green)",
    };

    return hW(
      "div",
      { style: { animation: "fadeUp .5s ease both" } },

      hW(
        "div",
        { className: "pipe-header" },
        hW(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: "4px" } },
          hW("div", { className: "pipe-title" }, "Awards"),
          hW(
            "div",
            {
              style: {
                fontFamily: "Cormorant Garamond,serif",
                fontSize: "14px",
                fontStyle: "italic",
                color: "var(--body-faint)",
              },
            },
            "Contract Records \u00b7 Sales Orders \u00b7 Invoices \u00b7 WAWF Mirror",
          ),
        ),
        hW(
          "div",
          {
            style: {
              display: "flex",
              gap: "10px",
              alignItems: "center",
              flexWrap: "wrap",
            },
          },
          view !== "new" &&
            hW(
              "button",
              {
                className: "btn btn-primary",
                onClick: () => {
                  setEditRecord(null);
                  setView("new");
                },
                style: { fontSize: "11px", padding: "9px 22px" },
              },
              hW("span", { className: "glint" }),
              "\u25c6 New Award",
            ),
          (view === "new" || view === "detail") &&
            hW(
              "button",
              {
                onClick: () => setView("list"),
                style: {
                  padding: "9px 18px",
                  background: "transparent",
                  border: "1px solid rgba(201,168,76,.25)",
                  color: "var(--body-dim)",
                  ...cinzel,
                  fontSize: "10px",
                  letterSpacing: ".1em",
                  cursor: "pointer",
                },
              },
              "\u2190 Back to List",
            ),
        ),
      ),

      view === "list" &&
        hW(
          WFrag,
          null,
          awards.length === 0
            ? hW(
                "div",
                {
                  style: {
                    textAlign: "center",
                    padding: "60px 20px",
                    fontFamily: "Cormorant Garamond,serif",
                    fontSize: "18px",
                    fontStyle: "italic",
                    color: "var(--body-faint)",
                  },
                },
                'No awards yet \u2014 press a bid to "Awarded" in Pipeline, or use \u25c6 New Award above.',
              )
            : hW(
                WFrag,
                null,
                hW(
                  "div",
                  { style: { padding: "16px 0 8px", maxWidth: "420px" } },
                  hW("input", {
                    value: search,
                    onChange: (e) => setSearch(e.target.value),
                    placeholder: "Search sol, NSN, invoice #\u2026",
                    style: { ...fieldStyle, width: "100%" },
                  }),
                ),
                hW(
                  "div",
                  { style: { overflowX: "auto" } },
                  hW(
                    "table",
                    { className: "pipe-table", style: { width: "100%" } },
                    hW(
                      "thead",
                      null,
                      hW(
                        "tr",
                        null,
                        ...[
                          "Sol Number",
                          "NSN",
                          "Item",
                          "PO #",
                          "Inv #",
                          "Award Date",
                          "Bid Total",
                          "GP%",
                          "Net",
                          "INV Status",
                          "Pay Status",
                          "",
                        ].map((h) => hW("th", { key: h }, h)),
                      ),
                    ),
                    hW(
                      "tbody",
                      null,
                      ...filtered.map((r) =>
                        hW(
                          "tr",
                          {
                            key: r.award_id,
                            style: { cursor: "pointer" },
                            onClick: () => {
                              setSelected(r);
                              setView("detail");
                            },
                            onMouseEnter: (e) =>
                              (e.currentTarget.style.background =
                                "rgba(201,168,76,.04)"),
                            onMouseLeave: (e) =>
                              (e.currentTarget.style.background = ""),
                          },
                          hW(
                            "td",
                            {
                              style: {
                                ...mono,
                                fontSize: "12px",
                                color: "var(--gold-solid)",
                              },
                            },
                            r.sol_number,
                          ),
                          hW(
                            "td",
                            { style: { ...mono, fontSize: "12px" } },
                            r.nsn,
                          ),
                          hW(
                            "td",
                            {
                              style: {
                                fontFamily: "Cormorant Garamond,serif",
                                fontSize: "13px",
                                maxWidth: "160px",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              },
                            },
                            r.item_name || "\u2014",
                          ),
                          hW(
                            "td",
                            {
                              style: {
                                ...mono,
                                fontSize: "11px",
                                color: "var(--body-dim)",
                              },
                            },
                            r.po_number,
                          ),
                          hW(
                            "td",
                            {
                              style: {
                                ...mono,
                                fontSize: "11px",
                                color: "var(--body-dim)",
                              },
                            },
                            r.inv_number,
                          ),
                          hW(
                            "td",
                            { style: { ...mono, fontSize: "11px" } },
                            r.award_date,
                          ),
                          hW(
                            "td",
                            {
                              style: {
                                ...mono,
                                fontSize: "13px",
                                fontWeight: "700",
                              },
                            },
                            fmt(parseFloat(r.bid_total)),
                          ),
                          hW(
                            "td",
                            {
                              style: {
                                ...mono,
                                fontSize: "13px",
                                color:
                                  parseFloat(r.gp_pct) >= 25
                                    ? "var(--accent-green)"
                                    : "var(--amber)",
                              },
                            },
                            r.gp_pct + "%",
                          ),
                          hW(
                            "td",
                            {
                              style: {
                                ...mono,
                                fontSize: "13px",
                                fontWeight: "700",
                                color: "var(--accent-green)",
                              },
                            },
                            fmt(parseFloat(r.net_take)),
                          ),
                          hW(
                            "td",
                            null,
                            hW(
                              "span",
                              {
                                style: {
                                  ...cinzel,
                                  fontSize: "9px",
                                  letterSpacing: ".08em",
                                  textTransform: "uppercase",
                                  color:
                                    invStatusColors[r.inv_status] ||
                                    "var(--body-dim)",
                                  padding: "3px 8px",
                                  border:
                                    "1px solid " +
                                    (invStatusColors[r.inv_status] ||
                                      "rgba(201,168,76,.18)"),
                                },
                              },
                              r.inv_status || "draft",
                            ),
                          ),
                          hW(
                            "td",
                            null,
                            hW(
                              "span",
                              {
                                style: {
                                  ...cinzel,
                                  fontSize: "9px",
                                  letterSpacing: ".08em",
                                  textTransform: "uppercase",
                                  color:
                                    payStatusColors[r.payment_status] ||
                                    "var(--body-dim)",
                                  padding: "3px 8px",
                                  border:
                                    "1px solid " +
                                    (payStatusColors[r.payment_status] ||
                                      "rgba(201,168,76,.18)"),
                                },
                              },
                              r.payment_status || "unpaid",
                            ),
                          ),
                          hW(
                            "td",
                            { onClick: (e) => e.stopPropagation() },
                            hW(
                              "button",
                              {
                                className: "del-btn",
                                onClick: () => {
                                  if (
                                    confirm(
                                      "Void " +
                                        r.sol_number +
                                        "? Document numbers will be retired.",
                                    )
                                  )
                                    handleVoid(r.award_id);
                                },
                                title: "Void \u2014 retires document numbers",
                              },
                              "\u2297",
                            ),
                          ),
                        ),
                      ),
                    ),
                    hW(
                      "tfoot",
                      null,
                      hW(
                        "tr",
                        {
                          style: {
                            borderTop: "2px solid rgba(201,168,76,.4)",
                            background:
                              "linear-gradient(160deg,#2e2b32 0%,#1a1820 40%,#111012 100%)",
                          },
                        },
                        hW(
                          "td",
                          {
                            colSpan: "6",
                            style: {
                              padding: "14px",
                              ...cinzel,
                              fontSize: "10px",
                              letterSpacing: ".14em",
                              color: "var(--gold-dim)",
                              textTransform: "uppercase",
                            },
                          },
                          "Awards Total \u2014 " +
                            filtered.length +
                            " record" +
                            (filtered.length !== 1 ? "s" : ""),
                        ),
                        hW(
                          "td",
                          {
                            style: {
                              padding: "14px",
                              ...mono,
                              fontSize: "14px",
                              fontWeight: "700",
                              ...gold,
                            },
                          },
                          fmt(
                            filtered.reduce(
                              (s, r) => s + (parseFloat(r.bid_total) || 0),
                              0,
                            ),
                          ),
                        ),
                        hW("td", null),
                        hW("td", null),
                        hW(
                          "td",
                          {
                            style: {
                              padding: "14px",
                              ...mono,
                              fontSize: "14px",
                              fontWeight: "700",
                              color: "var(--accent-green)",
                            },
                          },
                          fmt(
                            filtered.reduce(
                              (s, r) => s + (parseFloat(r.net_take) || 0),
                              0,
                            ),
                          ),
                        ),
                        hW("td", { colSpan: "3" }),
                      ),
                    ),
                  ),
                ),
              ),
        ),

      view === "new" &&
        hW(AwardForm, {
          prefill: editRecord || awardPrefill,
          showToast,
          onCancel: () => setView("list"),
          onSave: async (record) => {
            await loadAwards();
            setSelected(record);
            setView("detail");
          },
        }),

      view === "detail" &&
        selected &&
        hW(AwardDetail, {
          record:
            awards.find((r) => r.award_id === selected.award_id) || selected,
          showToast,
          onEdit: () => {
            setEditRecord(
              awards.find((r) => r.award_id === selected.award_id) || selected,
            );
            setView("new");
          },
          onVoid: async (award_id) => {
            await handleVoid(award_id);
          },
        }),
    );
  }

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.AwardsTab = AwardsTab;
})();
