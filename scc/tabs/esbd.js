(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — ESBD MODULE
  //  Texas Electronic State Business Daily solicitation pipeline
  //  Manual intake · Sourcing workspace · Bid builder · Submission tracker
  //  Pre-compiled React · No Babel · No JSX
  //  Exposes: window.SCC_ESBD  (DB layer)
  //           window.SCC_TABS.EsbdTab  (React component)
  // ═══════════════════════════════════════════════════════════════════════

  const {
    createElement: h,
    Fragment,
    useState,
    useEffect,
    useCallback,
  } = React;

  // ── CONSTANTS ────────────────────────────────────────────────────────────
  const LS_KEY = "imperio_esbd_bids";

  const ESBD_STATUSES = [
    "Draft",
    "Sourcing",
    "Ready to Bid",
    "Submitted",
    "Pending Award",
    "Awarded",
    "Lost",
    "No Bid",
  ];

  const ESBD_STATUS_COLOR = {
    Draft: "rgba(201,168,76,.5)",
    Sourcing: "rgba(135,206,235,.7)",
    "Ready to Bid": "rgba(61,214,140,.8)",
    Submitted: "rgba(201,168,76,.9)",
    "Pending Award": "rgba(232,143,203,.8)",
    Awarded: "rgba(61,214,140,1)",
    Lost: "rgba(232,116,116,.7)",
    "No Bid": "rgba(160,160,160,.5)",
  };

  // ── PERSISTENCE ──────────────────────────────────────────────────────────
  function lsGet() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    } catch (e) {
      return [];
    }
  }
  function lsSave(arr) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(arr));
    } catch (e) {
      alert("Storage full — export a backup.");
    }
  }

  function esbdGetAll() {
    return Promise.resolve(lsGet());
  }
  function esbdSave(rec) {
    const arr = lsGet();
    const idx = arr.findIndex((r) => r.id === rec.id);
    if (idx >= 0) arr[idx] = rec;
    else arr.push(rec);
    lsSave(arr);
    return Promise.resolve(true);
  }
  function esbdDelete(id) {
    lsSave(lsGet().filter((r) => r.id !== id));
    return Promise.resolve(true);
  }
  function esbdGetActive() {
    return Promise.resolve(
      lsGet().filter((r) => !["Awarded", "Lost", "No Bid"].includes(r.status)),
    );
  }

  // ── HELPERS ──────────────────────────────────────────────────────────────
  const { fmt, calcBidMath } = window.SCC_MATH;

  function newId() {
    return "esbd_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
  }

  function blankBid() {
    return {
      id: newId(),
      sol_id: "",
      agency: "",
      agency_num: "",
      nigp_code: "",
      title: "",
      due_date: "",
      due_time: "5:00 PM",
      posted_date: "",
      status: "Draft",
      contact_name: "",
      contact_phone: "",
      contact_email: "",
      submit_email: "",
      delivery_addr: "",
      item_desc: "",
      qty: "",
      uom: "",
      spec_notes: "",
      mfr_name: "",
      mfr_pn: "",
      vethub_pref: false,
      fob: "Destination",
      suppliers: [], // [{id, name, contact, phone, email, unit_price, notes, date_quoted}]
      bid_unit_price: "",
      bid_total: "",
      margin_pct: "",
      net_take: "",
      submission_note: "",
      date_added: new Date().toLocaleDateString(),
      notes: "",
    };
  }

  // ── PARSE ESBD JSON FROM CHAT OUTPUT ────────────────────────────────────
  function parseEsbdJson(raw) {
    let parsed;
    try {
      const clean = raw
        .trim()
        .replace(/^```[a-z]*\n?/i, "")
        .replace(/```$/, "")
        .trim();
      parsed = JSON.parse(clean);
    } catch (e) {
      return { ok: false, error: "Could not parse JSON: " + e.message };
    }
    const bid = {
      ...blankBid(),
      ...parsed,
      id: newId(),
      date_added: new Date().toLocaleDateString(),
      status: parsed.status || "Draft",
      suppliers: Array.isArray(parsed.suppliers) ? parsed.suppliers : [],
    };
    return { ok: true, bid };
  }

  function blankSupplier() {
    return {
      id: newId(),
      name: "",
      contact: "",
      phone: "",
      email: "",
      unit_price: "",
      total_quote: "",
      lead_days: "",
      notes: "",
      date_quoted: new Date().toLocaleDateString(),
    };
  }

  // ── BID MATH FROM BEST QUOTE ─────────────────────────────────────────────
  // FE applies when bid_total >= $10K (Day-30 benchmark: 5.00% combined)
  // Self-funded below $10K: no FE fees, 20%+ margin target
  const FE_THRESHOLD = 10000;
  const FE_RATE = 0.05; // 2.50% factoring + 2.50% PO = 5.00% Day-30 benchmark

  function calcEsbdMath(bid) {
    const qty = parseFloat(bid.qty) || 0;
    if (!qty) return null;
    const prices = (bid.suppliers || [])
      .map((s) => parseFloat(s.unit_price))
      .filter((p) => p > 0);
    if (!prices.length) return null;
    const bestUnit = Math.min(...prices);
    const bidTotal = parseFloat(bid.bid_total) || 0;
    if (!bidTotal) return null;
    const cogs = bestUnit * qty;
    const gp = bidTotal - cogs;
    const gpPct = bidTotal > 0 ? (gp / bidTotal) * 100 : 0;
    const useFE = bidTotal >= FE_THRESHOLD;
    const feFee = useFE ? bidTotal * FE_RATE : 0;
    const net = gp - feFee;
    const netPct = bidTotal > 0 ? (net / bidTotal) * 100 : 0;
    return { bestUnit, cogs, bidTotal, gp, gpPct, feFee, net, netPct, useFE };
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  SUB-COMPONENTS
  // ══════════════════════════════════════════════════════════════════════════

  // ── STATUS BADGE ─────────────────────────────────────────────────────────
  function StatusBadge({ status }) {
    return h(
      "span",
      {
        style: {
          display: "inline-block",
          padding: "2px 10px",
          borderRadius: "3px",
          fontSize: "15px",
          fontFamily: "Cinzel, serif",
          letterSpacing: "0.1em",
          border:
            "1px solid " + (ESBD_STATUS_COLOR[status] || "rgba(201,168,76,.4)"),
          color: ESBD_STATUS_COLOR[status] || "var(--body-faint)",
          background: "rgba(0,0,0,.18)",
          whiteSpace: "nowrap",
        },
      },
      status,
    );
  }

  // ── FIELD ROW ─────────────────────────────────────────────────────────────
  function FieldRow({ label, children, half }) {
    return h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: "4px",
          flex: half ? "0 0 calc(50% - 6px)" : "1 1 100%",
        },
      },
      h(
        "label",
        {
          style: {
            fontFamily: "Cinzel, serif",
            fontSize: "14px",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--body-faint)",
          },
        },
        label,
      ),
      children,
    );
  }

  function Input({ value, onChange, placeholder, type, style }) {
    return h("input", {
      type: type || "text",
      value: value || "",
      onChange: (e) => onChange(e.target.value),
      placeholder: placeholder || "",
      style: {
        background: "var(--surface-2, rgba(255,255,255,.04))",
        border: "1px solid rgba(201,168,76,.2)",
        borderRadius: "4px",
        color: "var(--body-text, #F5F0E8)",
        fontFamily: "Cormorant Garamond, serif",
        fontSize: "14px",
        padding: "6px 10px",
        width: "100%",
        boxSizing: "border-box",
        outline: "none",
        ...style,
      },
    });
  }

  function Textarea({ value, onChange, placeholder, rows }) {
    return h("textarea", {
      value: value || "",
      onChange: (e) => onChange(e.target.value),
      placeholder: placeholder || "",
      rows: rows || 3,
      style: {
        background: "var(--surface-2, rgba(255,255,255,.04))",
        border: "1px solid rgba(201,168,76,.2)",
        borderRadius: "4px",
        color: "var(--body-text, #F5F0E8)",
        fontFamily: "Cormorant Garamond, serif",
        fontSize: "14px",
        padding: "6px 10px",
        width: "100%",
        boxSizing: "border-box",
        outline: "none",
        resize: "vertical",
      },
    });
  }

  function Select({ value, onChange, options }) {
    return h(
      "select",
      {
        value: value || "",
        onChange: (e) => onChange(e.target.value),
        style: {
          background: "var(--surface-2, rgba(255,255,255,.04))",
          border: "1px solid rgba(201,168,76,.2)",
          borderRadius: "4px",
          color: "var(--body-text, #F5F0E8)",
          fontFamily: "Cormorant Garamond, serif",
          fontSize: "14px",
          padding: "6px 10px",
          width: "100%",
          boxSizing: "border-box",
          outline: "none",
        },
      },
      options.map((o) =>
        h("option", { key: o, value: o, style: { background: "#1a0008" } }, o),
      ),
    );
  }

  // ── SECTION HEADER ────────────────────────────────────────────────────────
  function SectionHead({ label }) {
    return h(
      "div",
      {
        style: {
          fontFamily: "Cinzel, serif",
          fontSize: "14px",
          letterSpacing: "0.26em",
          textTransform: "uppercase",
          color: "rgba(201,168,76,.6)",
          borderBottom: "1px solid rgba(201,168,76,.15)",
          paddingBottom: "6px",
          marginTop: "18px",
          marginBottom: "12px",
        },
      },
      label,
    );
  }

  // ── GOLD BUTTON ───────────────────────────────────────────────────────────
  function GoldBtn({ onClick, children, style, disabled }) {
    return h(
      "button",
      {
        onClick,
        disabled,
        style: {
          background:
            "linear-gradient(135deg,#b8860b 0%,#f9f295 45%,#e0aa3e 55%,#b8860b 100%)",
          border: "none",
          borderRadius: "4px",
          color: "#1a0008",
          fontFamily: "Cinzel, serif",
          fontSize: "15px",
          letterSpacing: "0.14em",
          fontWeight: "700",
          padding: "8px 18px",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
          whiteSpace: "nowrap",
          ...style,
        },
      },
      children,
    );
  }

  function GhostBtn({ onClick, children, style, color }) {
    const c = color || "rgba(201,168,76,.6)";
    return h(
      "button",
      {
        onClick,
        style: {
          background: "transparent",
          border: "1px solid " + c,
          borderRadius: "4px",
          color: c,
          fontFamily: "Cinzel, serif",
          fontSize: "14px",
          letterSpacing: "0.12em",
          padding: "6px 14px",
          cursor: "pointer",
          whiteSpace: "nowrap",
          ...style,
        },
      },
      children,
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  BID FORM — create / edit a single ESBD bid
  // ══════════════════════════════════════════════════════════════════════════
  function BidForm({ initial, onSave, onCancel }) {
    const [bid, setBid] = useState(initial || blankBid());
    const [newSup, setNewSup] = useState(blankSupplier());
    const [showSupForm, setShowSupForm] = useState(false);

    const set = (field) => (val) => setBid((b) => ({ ...b, [field]: val }));

    // Auto-calc bid total when unit price + qty change
    useEffect(() => {
      const u = parseFloat(bid.bid_unit_price);
      const q = parseFloat(bid.qty);
      if (u > 0 && q > 0) {
        const total = (u * q).toFixed(2);
        setBid((b) => ({ ...b, bid_total: total }));
      }
    }, [bid.bid_unit_price, bid.qty]);

    // Auto-calc margin when bid total + best supplier quote available
    useEffect(() => {
      const q = parseFloat(bid.qty) || 0;
      const prices = (bid.suppliers || [])
        .map((s) => parseFloat(s.unit_price))
        .filter((p) => p > 0);
      const bestUnit = prices.length ? Math.min(...prices) : 0;
      const bidTotal = parseFloat(bid.bid_total) || 0;
      if (bestUnit > 0 && bidTotal > 0 && q > 0) {
        const cogs = bestUnit * q;
        const gp = bidTotal - cogs;
        const useFE = bidTotal >= FE_THRESHOLD;
        const feFee = useFE ? bidTotal * FE_RATE : 0;
        const net = gp - feFee;
        const netPct = ((net / bidTotal) * 100).toFixed(1);
        setBid((b) => ({ ...b, margin_pct: netPct, net_take: net.toFixed(2) }));
      }
    }, [bid.bid_total, bid.suppliers, bid.qty]);

    const addSupplier = () => {
      if (!newSup.name.trim()) return;
      setBid((b) => ({
        ...b,
        suppliers: [...(b.suppliers || []), { ...newSup, id: newId() }],
      }));
      setNewSup(blankSupplier());
      setShowSupForm(false);
    };

    const removeSupplier = (id) => {
      setBid((b) => ({
        ...b,
        suppliers: b.suppliers.filter((s) => s.id !== id),
      }));
    };

    const handleSave = () => {
      if (!bid.sol_id.trim()) {
        alert("Solicitation ID is required.");
        return;
      }
      if (!bid.title.trim()) {
        alert("Title is required.");
        return;
      }
      onSave(bid);
    };

    // Best quote indicator
    const prices = (bid.suppliers || [])
      .map((s) => parseFloat(s.unit_price))
      .filter((p) => p > 0);
    const bestUnit = prices.length ? Math.min(...prices) : null;
    const bidTotal = parseFloat(bid.bid_total) || 0;
    const qty = parseFloat(bid.qty) || 0;
    const cogs = bestUnit && qty ? bestUnit * qty : 0;
    const gp = bidTotal && cogs ? bidTotal - cogs : 0;
    const gpPct = bidTotal > 0 && cogs > 0 ? (gp / bidTotal) * 100 : 0;
    const useFE = bidTotal >= FE_THRESHOLD;
    const feFee = useFE ? bidTotal * FE_RATE : 0;
    const netAfterFE = gp - feFee;
    const netPct = bidTotal > 0 ? (netAfterFE / bidTotal) * 100 : 0;
    const marginOk = gpPct >= 10;

    return h(
      "div",
      {
        style: {
          background: "var(--surface-1, rgba(255,255,255,.03))",
          border: "1px solid rgba(201,168,76,.2)",
          borderRadius: "8px",
          padding: "24px",
          maxWidth: "860px",
        },
      },

      // ── Solicitation Info ──
      h(SectionHead, { label: "Solicitation" }),
      h(
        "div",
        { style: { display: "flex", flexWrap: "wrap", gap: "12px" } },
        h(
          FieldRow,
          { label: "Solicitation ID *", half: true },
          h(Input, {
            value: bid.sol_id,
            onChange: set("sol_id"),
            placeholder: "e.g. IW246367",
          }),
        ),
        h(
          FieldRow,
          { label: "Title *", half: true },
          h(Input, {
            value: bid.title,
            onChange: set("title"),
            placeholder: "e.g. Disposable Vinyl Gloves",
          }),
        ),
        h(
          FieldRow,
          { label: "Agency Name", half: true },
          h(Input, {
            value: bid.agency,
            onChange: set("agency"),
            placeholder: "e.g. TDCJ",
          }),
        ),
        h(
          FieldRow,
          { label: "Agency / SmartBuy #", half: true },
          h(Input, {
            value: bid.agency_num,
            onChange: set("agency_num"),
            placeholder: "e.g. A2237",
          }),
        ),
        h(
          FieldRow,
          { label: "NIGP Class/Item Code", half: true },
          h(Input, {
            value: bid.nigp_code,
            onChange: set("nigp_code"),
            placeholder: "e.g. 475-41",
          }),
        ),
        h(
          FieldRow,
          { label: "Status", half: true },
          h(Select, {
            value: bid.status,
            onChange: set("status"),
            options: ESBD_STATUSES,
          }),
        ),
        h(
          FieldRow,
          { label: "Due Date", half: true },
          h(Input, {
            value: bid.due_date,
            onChange: set("due_date"),
            placeholder: "4/8/2026",
          }),
        ),
        h(
          FieldRow,
          { label: "Due Time", half: true },
          h(Input, {
            value: bid.due_time,
            onChange: set("due_time"),
            placeholder: "3:00 PM",
          }),
        ),
        h(
          FieldRow,
          { label: "Posted Date", half: true },
          h(Input, {
            value: bid.posted_date,
            onChange: set("posted_date"),
            placeholder: "3/24/2026",
          }),
        ),
        h(
          FieldRow,
          { label: "FOB Terms", half: true },
          h(Select, {
            value: bid.fob,
            onChange: set("fob"),
            options: ["Destination", "Origin", "Destination Prepaid & Allowed"],
          }),
        ),
      ),

      // VetHUB checkbox
      h(
        "div",
        {
          style: {
            marginTop: "10px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          },
        },
        h("input", {
          type: "checkbox",
          id: "vethub-pref",
          checked: !!bid.vethub_pref,
          onChange: (e) =>
            setBid((b) => ({ ...b, vethub_pref: e.target.checked })),
          style: { accentColor: "#C9A84C", width: "14px", height: "14px" },
        }),
        h(
          "label",
          {
            htmlFor: "vethub-pref",
            style: {
              fontFamily: "Cormorant Garamond, serif",
              fontSize: "15px",
              color: "var(--body-faint)",
              cursor: "pointer",
            },
          },
          "VetHUB Preference Applicable",
        ),
      ),

      // ── Contact ──
      h(SectionHead, { label: "Contact & Submission" }),
      h(
        "div",
        { style: { display: "flex", flexWrap: "wrap", gap: "12px" } },
        h(
          FieldRow,
          { label: "Contact Name", half: true },
          h(Input, {
            value: bid.contact_name,
            onChange: set("contact_name"),
            placeholder: "Andrea Jones",
          }),
        ),
        h(
          FieldRow,
          { label: "Contact Phone", half: true },
          h(Input, {
            value: bid.contact_phone,
            onChange: set("contact_phone"),
            placeholder: "936-437-3804",
          }),
        ),
        h(
          FieldRow,
          { label: "Contact Email", half: true },
          h(Input, {
            value: bid.contact_email,
            onChange: set("contact_email"),
            placeholder: "andrea.jones@agency.texas.gov",
          }),
        ),
        h(
          FieldRow,
          { label: "Submit / Bid Response Email", half: true },
          h(Input, {
            value: bid.submit_email,
            onChange: set("submit_email"),
            placeholder: "bids@agency.texas.gov",
          }),
        ),
        h(
          FieldRow,
          { label: "Delivery Address" },
          h(Input, {
            value: bid.delivery_addr,
            onChange: set("delivery_addr"),
            placeholder: "861 I-45 Dock C, Huntsville TX 77320",
          }),
        ),
      ),

      // ── Item Spec ──
      h(SectionHead, { label: "Item Specification" }),
      h(
        "div",
        { style: { display: "flex", flexWrap: "wrap", gap: "12px" } },
        h(
          FieldRow,
          { label: "Qty", half: true },
          h(Input, {
            value: bid.qty,
            onChange: set("qty"),
            placeholder: "1500",
            type: "number",
          }),
        ),
        h(
          FieldRow,
          { label: "Unit of Measure", half: true },
          h(Input, {
            value: bid.uom,
            onChange: set("uom"),
            placeholder: "CS, EA, BX...",
          }),
        ),
        h(
          FieldRow,
          { label: "Manufacturer Name", half: true },
          h(Input, {
            value: bid.mfr_name,
            onChange: set("mfr_name"),
            placeholder: "Basic Medical Industries",
          }),
        ),
        h(
          FieldRow,
          { label: "Manufacturer P/N", half: true },
          h(Input, {
            value: bid.mfr_pn,
            onChange: set("mfr_pn"),
            placeholder: "VGPF3004",
          }),
        ),
        h(
          FieldRow,
          { label: "Item Description" },
          h(Textarea, {
            value: bid.item_desc,
            onChange: set("item_desc"),
            placeholder:
              "Disposable gloves, vinyl (PVC), powder-free, non-sterile, 4.0 mil, X-Large...",
            rows: 3,
          }),
        ),
        h(
          FieldRow,
          { label: "Spec Notes / Equivalency Notes" },
          h(Textarea, {
            value: bid.spec_notes,
            onChange: set("spec_notes"),
            placeholder:
              "Equivalent product acceptable? Samples required? Special certifications?",
            rows: 2,
          }),
        ),
      ),

      // ── Sourcing Log ──
      h(SectionHead, { label: "Sourcing Log" }),

      // Supplier table
      (bid.suppliers || []).length > 0 &&
        h(
          "div",
          {
            style: {
              border: "1px solid rgba(201,168,76,.15)",
              borderRadius: "6px",
              overflow: "hidden",
              marginBottom: "12px",
            },
          },
          h(
            "table",
            { style: { width: "100%", borderCollapse: "collapse" } },
            h(
              "thead",
              null,
              h(
                "tr",
                { style: { background: "rgba(201,168,76,.08)" } },
                [
                  "Supplier",
                  "Contact",
                  "Unit Price",
                  "Lead Days",
                  "Date Quoted",
                  "Notes",
                  "",
                ].map((col) =>
                  h(
                    "th",
                    {
                      key: col,
                      style: {
                        fontFamily: "Cinzel, serif",
                        fontSize: "14px",
                        letterSpacing: "0.16em",
                        color: "rgba(201,168,76,.7)",
                        padding: "8px 10px",
                        textAlign: "left",
                        borderBottom: "1px solid rgba(201,168,76,.12)",
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
              (bid.suppliers || []).map((s, i) => {
                const isLowest =
                  prices.length > 0 && parseFloat(s.unit_price) === bestUnit;
                return h(
                  "tr",
                  {
                    key: s.id,
                    style: {
                      background: isLowest
                        ? "rgba(61,214,140,.06)"
                        : i % 2 === 0
                          ? "transparent"
                          : "rgba(255,255,255,.02)",
                      borderLeft: isLowest
                        ? "2px solid rgba(61,214,140,.6)"
                        : "2px solid transparent",
                    },
                  },
                  h(
                    "td",
                    {
                      style: {
                        padding: "8px 10px",
                        fontFamily: "Cormorant Garamond, serif",
                        fontSize: "15px",
                        color: "var(--body-text)",
                      },
                    },
                    s.name,
                    isLowest &&
                      h(
                        "span",
                        {
                          style: {
                            marginLeft: "6px",
                            fontSize: "15px",
                            color: "rgba(61,214,140,.8)",
                          },
                        },
                        "★ Best",
                      ),
                  ),
                  h(
                    "td",
                    {
                      style: {
                        padding: "8px 10px",
                        fontSize: "14px",
                        color: "var(--body-faint)",
                      },
                    },
                    s.contact || s.email || "—",
                  ),
                  h(
                    "td",
                    {
                      style: {
                        padding: "8px 10px",
                        fontSize: "15px",
                        color: s.unit_price
                          ? "var(--accent-green, #3dd68c)"
                          : "var(--body-faint)",
                      },
                    },
                    s.unit_price ? fmt(parseFloat(s.unit_price)) : "—",
                  ),
                  h(
                    "td",
                    {
                      style: {
                        padding: "8px 10px",
                        fontSize: "14px",
                        color: "var(--body-faint)",
                      },
                    },
                    s.lead_days ? s.lead_days + "d" : "—",
                  ),
                  h(
                    "td",
                    {
                      style: {
                        padding: "8px 10px",
                        fontSize: "14px",
                        color: "var(--body-faint)",
                      },
                    },
                    s.date_quoted || "—",
                  ),
                  h(
                    "td",
                    {
                      style: {
                        padding: "8px 10px",
                        fontSize: "14px",
                        color: "var(--body-faint)",
                        maxWidth: "160px",
                      },
                    },
                    s.notes || "—",
                  ),
                  h(
                    "td",
                    { style: { padding: "8px 10px", textAlign: "right" } },
                    h(
                      "button",
                      {
                        onClick: () => removeSupplier(s.id),
                        style: {
                          background: "none",
                          border: "none",
                          color: "rgba(232,116,116,.6)",
                          cursor: "pointer",
                          fontSize: "15px",
                        },
                      },
                      "✕",
                    ),
                  ),
                );
              }),
            ),
          ),
        ),

      // Add supplier toggle
      !showSupForm &&
        h(
          GhostBtn,
          {
            onClick: () => setShowSupForm(true),
            style: { marginBottom: "12px" },
          },
          "+ Add Supplier Quote",
        ),

      // Supplier form
      showSupForm &&
        h(
          "div",
          {
            style: {
              background: "rgba(201,168,76,.04)",
              border: "1px solid rgba(201,168,76,.18)",
              borderRadius: "6px",
              padding: "16px",
              marginBottom: "12px",
            },
          },
          h(
            "div",
            {
              style: {
                fontFamily: "Cinzel, serif",
                fontSize: "14px",
                letterSpacing: "0.2em",
                color: "rgba(201,168,76,.6)",
                marginBottom: "12px",
              },
            },
            "NEW SUPPLIER QUOTE",
          ),
          h(
            "div",
            { style: { display: "flex", flexWrap: "wrap", gap: "10px" } },
            h(
              FieldRow,
              { label: "Supplier Name *", half: true },
              h(Input, {
                value: newSup.name,
                onChange: (v) => setNewSup((s) => ({ ...s, name: v })),
                placeholder: "Acme Medical Supply",
              }),
            ),
            h(
              FieldRow,
              { label: "Contact Name", half: true },
              h(Input, {
                value: newSup.contact,
                onChange: (v) => setNewSup((s) => ({ ...s, contact: v })),
                placeholder: "John Smith",
              }),
            ),
            h(
              FieldRow,
              { label: "Phone", half: true },
              h(Input, {
                value: newSup.phone,
                onChange: (v) => setNewSup((s) => ({ ...s, phone: v })),
                placeholder: "(800) 555-1234",
              }),
            ),
            h(
              FieldRow,
              { label: "Email", half: true },
              h(Input, {
                value: newSup.email,
                onChange: (v) => setNewSup((s) => ({ ...s, email: v })),
                placeholder: "sales@supplier.com",
              }),
            ),
            h(
              FieldRow,
              { label: "Unit Price (per UOM)", half: true },
              h(Input, {
                value: newSup.unit_price,
                onChange: (v) => setNewSup((s) => ({ ...s, unit_price: v })),
                placeholder: "32.50",
                type: "number",
              }),
            ),
            h(
              FieldRow,
              { label: "Lead Days", half: true },
              h(Input, {
                value: newSup.lead_days,
                onChange: (v) => setNewSup((s) => ({ ...s, lead_days: v })),
                placeholder: "7",
                type: "number",
              }),
            ),
            h(
              FieldRow,
              { label: "Notes" },
              h(Input, {
                value: newSup.notes,
                onChange: (v) => setNewSup((s) => ({ ...s, notes: v })),
                placeholder: "Confirmed stock, FDA cleared, can pull sample...",
              }),
            ),
          ),
          h(
            "div",
            { style: { display: "flex", gap: "10px", marginTop: "10px" } },
            h(GoldBtn, { onClick: addSupplier }, "Add Quote"),
            h(
              GhostBtn,
              {
                onClick: () => {
                  setShowSupForm(false);
                  setNewSup(blankSupplier());
                },
              },
              "Cancel",
            ),
          ),
        ),

      // ── Bid Math ──
      h(SectionHead, { label: "Bid Math" }),
      h(
        "div",
        { style: { display: "flex", flexWrap: "wrap", gap: "12px" } },
        h(
          FieldRow,
          { label: "Your Bid Unit Price", half: true },
          h(Input, {
            value: bid.bid_unit_price,
            onChange: set("bid_unit_price"),
            placeholder: "45.00",
            type: "number",
          }),
        ),
        h(
          FieldRow,
          { label: "Bid Total (auto-calc)", half: true },
          h(Input, {
            value: bid.bid_total,
            onChange: set("bid_total"),
            placeholder: "67,500.00",
            style: { color: "rgba(201,168,76,.9)" },
          }),
        ),
      ),

      // Live margin display
      bestUnit &&
        bidTotal > 0 &&
        qty > 0 &&
        h(
          "div",
          {
            style: {
              display: "flex",
              gap: "20px",
              flexWrap: "wrap",
              marginTop: "10px",
              padding: "12px 16px",
              background: marginOk
                ? "rgba(61,214,140,.06)"
                : "rgba(232,116,116,.06)",
              border:
                "1px solid " +
                (marginOk ? "rgba(61,214,140,.25)" : "rgba(232,116,116,.25)"),
              borderRadius: "6px",
            },
          },
          ...[
            ["Best Supplier Unit", fmt(bestUnit)],
            ["COGS", fmt(cogs)],
            ["Bid Total", fmt(bidTotal)],
            ["Gross Profit", fmt(gp)],
            ["Gross Margin", gpPct.toFixed(1) + "%"],
            [
              "FE Fees",
              useFE
                ? "-" + fmt(feFee) + " (5.00% Day-30)"
                : "None (Self-Funded)",
            ],
            ["Net Take", fmt(netAfterFE)],
            ["Net Margin", netPct.toFixed(1) + "%"],
          ].map(([label, val]) =>
            h(
              "div",
              {
                key: label,
                style: { display: "flex", flexDirection: "column", gap: "2px" },
              },
              h(
                "div",
                {
                  style: {
                    fontFamily: "Cinzel, serif",
                    fontSize: "14px",
                    letterSpacing: "0.18em",
                    color: "var(--body-faint)",
                  },
                },
                label,
              ),
              h(
                "div",
                {
                  style: {
                    fontFamily: "Cormorant Garamond, serif",
                    fontSize: "15px",
                    color:
                      label === "Net Margin"
                        ? marginOk
                          ? "rgba(61,214,140,.9)"
                          : "rgba(232,116,116,.9)"
                        : label === "FE Fees" && useFE
                          ? "rgba(201,168,76,.8)"
                          : "var(--body-text)",
                  },
                },
                val,
              ),
            ),
          ),
          !marginOk &&
            h(
              "div",
              {
                style: {
                  width: "100%",
                  fontFamily: "Cormorant Garamond, serif",
                  fontSize: "14px",
                  fontStyle: "italic",
                  color: "rgba(232,116,116,.7)",
                  marginTop: "4px",
                },
              },
              "Below 10% gross margin floor — do not submit.",
            ),
        ),

      // ── Notes & Submission ──
      h(SectionHead, { label: "Notes & Submission" }),
      h(
        "div",
        { style: { display: "flex", flexWrap: "wrap", gap: "12px" } },
        h(
          FieldRow,
          { label: "Internal Notes" },
          h(Textarea, {
            value: bid.notes,
            onChange: set("notes"),
            placeholder: "Triage notes, sourcing observations, risk flags...",
            rows: 2,
          }),
        ),
        h(
          FieldRow,
          { label: "Submission Note (for bid response email)" },
          h(Textarea, {
            value: bid.submission_note,
            onChange: set("submission_note"),
            placeholder:
              "Any exceptions, delivery notes, or addendum acknowledgments to include...",
            rows: 2,
          }),
        ),
      ),

      // ── Actions ──
      h(
        "div",
        {
          style: {
            display: "flex",
            gap: "12px",
            marginTop: "20px",
            flexWrap: "wrap",
          },
        },
        h(GoldBtn, { onClick: handleSave }, "Save Bid"),
        h(GhostBtn, { onClick: onCancel }, "Cancel"),
      ),
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  BID CARD — pipeline list item
  // ══════════════════════════════════════════════════════════════════════════
  function BidCard({ bid, onEdit, onDelete, onStatusChange, goAward }) {
    const math = calcEsbdMath(bid);
    const qty = parseFloat(bid.qty) || 0;
    const daysToGo = (() => {
      if (!bid.due_date) return null;
      const parts = bid.due_date.split("/");
      if (parts.length !== 3) return null;
      const [m, d, y] = parts;
      const due = new Date(parseInt("20" + y) || parseInt(y), m - 1, d);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return Math.round((due - today) / 86400000);
    })();

    const urgency =
      daysToGo === null
        ? null
        : daysToGo < 0
          ? "overdue"
          : daysToGo <= 3
            ? "critical"
            : daysToGo <= 7
              ? "soon"
              : "ok";

    const urgencyColor =
      {
        overdue: "rgba(232,116,116,.8)",
        critical: "rgba(232,143,203,.8)",
        soon: "rgba(201,168,76,.8)",
        ok: "var(--body-faint)",
      }[urgency] || "var(--body-faint)";

    return h(
      "div",
      {
        style: {
          background: "var(--surface-1, rgba(255,255,255,.03))",
          border: "1px solid rgba(201,168,76,.15)",
          borderRadius: "8px",
          padding: "16px 18px",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          transition: "border-color .2s",
        },
      },
      // Top row
      h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "12px",
            flexWrap: "wrap",
          },
        },
        h(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: "4px" } },
          h(
            "div",
            {
              style: {
                fontFamily: "Cinzel, serif",
                fontSize: "15px",
                color: "var(--gold-solid, #C9A84C)",
                letterSpacing: "0.08em",
              },
            },
            bid.sol_id,
            " ",
            bid.vethub_pref &&
              h(
                "span",
                {
                  style: {
                    fontSize: "15px",
                    color: "rgba(135,206,235,.7)",
                    marginLeft: "6px",
                  },
                },
                "VetHUB",
              ),
          ),
          h(
            "div",
            {
              style: {
                fontFamily: "Cormorant Garamond, serif",
                fontSize: "15px",
                color: "var(--body-text)",
              },
            },
            bid.title,
          ),
          h(
            "div",
            {
              style: {
                fontFamily: "Cormorant Garamond, serif",
                fontSize: "14px",
                color: "var(--body-faint)",
                fontStyle: "italic",
              },
            },
            bid.agency,
            bid.nigp_code ? " · NIGP " + bid.nigp_code : "",
          ),
        ),
        h(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: "8px",
              flexWrap: "wrap",
            },
          },
          h(StatusBadge, { status: bid.status }),
          daysToGo !== null &&
            h(
              "span",
              {
                style: {
                  fontFamily: "Cinzel, serif",
                  fontSize: "14px",
                  color: urgencyColor,
                  letterSpacing: "0.1em",
                },
              },
              daysToGo < 0
                ? Math.abs(daysToGo) + "d PAST"
                : daysToGo + "d LEFT",
            ),
        ),
      ),

      // Stats row
      h(
        "div",
        { style: { display: "flex", gap: "20px", flexWrap: "wrap" } },
        ...[
          [
            "Due",
            bid.due_date ? bid.due_date + " " + (bid.due_time || "") : "—",
          ],
          ["Qty", qty > 0 ? qty.toLocaleString() + " " + (bid.uom || "") : "—"],
          ["Suppliers", (bid.suppliers || []).length],
          [
            "Bid Total",
            math
              ? fmt(math.bidTotal)
              : bid.bid_total
                ? fmt(parseFloat(bid.bid_total))
                : "—",
          ],
          ["Margin", math ? math.gpPct.toFixed(1) + "%" : "—"],
          ["Net", math ? fmt(math.net) : "—"],
        ].map(([label, val]) =>
          h(
            "div",
            {
              key: label,
              style: { display: "flex", flexDirection: "column", gap: "1px" },
            },
            h(
              "div",
              {
                style: {
                  fontFamily: "Cinzel, serif",
                  fontSize: "14px",
                  letterSpacing: "0.16em",
                  color: "var(--body-faint)",
                },
              },
              label,
            ),
            h(
              "div",
              {
                style: {
                  fontFamily: "Cormorant Garamond, serif",
                  fontSize: "14px",
                  color: "var(--body-text)",
                },
              },
              val,
            ),
          ),
        ),
      ),

      // Status changer + actions
      h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: "10px",
            flexWrap: "wrap",
            borderTop: "1px solid rgba(201,168,76,.1)",
            paddingTop: "10px",
          },
        },
        h(
          "select",
          {
            value: bid.status,
            onChange: (e) => onStatusChange(bid.id, e.target.value),
            style: {
              background: "transparent",
              border: "1px solid rgba(201,168,76,.2)",
              borderRadius: "4px",
              color: ESBD_STATUS_COLOR[bid.status] || "var(--body-faint)",
              fontFamily: "Cinzel, serif",
              fontSize: "14px",
              letterSpacing: "0.1em",
              padding: "4px 8px",
              cursor: "pointer",
            },
          },
          ESBD_STATUSES.map((s) =>
            h(
              "option",
              {
                key: s,
                value: s,
                style: { background: "#1a0008", color: "#F5F0E8" },
              },
              s,
            ),
          ),
        ),
        h(GhostBtn, { onClick: () => onEdit(bid) }, "Edit"),
        bid.status === "Awarded" &&
          goAward &&
          h(
            "button",
            {
              onClick: () => goAward(bid),
              style: {
                background: "rgba(61,214,140,.12)",
                border: "1px solid rgba(61,214,140,.5)",
                borderRadius: "4px",
                color: "rgba(61,214,140,.9)",
                fontFamily: "Cinzel, serif",
                fontSize: "14px",
                letterSpacing: "0.12em",
                padding: "5px 14px",
                cursor: "pointer",
                whiteSpace: "nowrap",
                fontWeight: "700",
              },
            },
            "★ Process Award",
          ),
        h(
          "button",
          {
            onClick: () => {
              if (confirm("Delete " + bid.sol_id + "?")) onDelete(bid.id);
            },
            style: {
              background: "none",
              border: "none",
              color: "rgba(232,116,116,.5)",
              cursor: "pointer",
              fontFamily: "Cinzel, serif",
              fontSize: "14px",
              letterSpacing: "0.1em",
            },
          },
          "Delete",
        ),
        // Quick submit mailto link
        bid.submit_email &&
          h(
            "a",
            {
              href:
                "mailto:" +
                bid.submit_email +
                "?subject=" +
                encodeURIComponent(
                  "Bid Response — Solicitation " +
                    bid.sol_id +
                    " — Imperio Talent Solutions",
                ) +
                "&body=" +
                encodeURIComponent(buildEmailBody(bid)),
              style: {
                marginLeft: "auto",
                background: "transparent",
                border: "1px solid rgba(61,214,140,.35)",
                borderRadius: "4px",
                color: "rgba(61,214,140,.7)",
                fontFamily: "Cinzel, serif",
                fontSize: "14px",
                letterSpacing: "0.1em",
                padding: "5px 12px",
                textDecoration: "none",
                whiteSpace: "nowrap",
              },
            },
            "✉ Open Bid Email",
          ),
      ),
    );
  }

  // ── BID EMAIL BODY BUILDER ───────────────────────────────────────────────
  function buildEmailBody(bid) {
    const lines = [
      "RE: Bid Response — Solicitation No. " + bid.sol_id,
      "Solicitation: " + bid.title,
      "Agency: " + bid.agency,
      "",
      "The House of Kel LLC | Imperio Talent Solutions | CAGE 152U4",
      "SDVOSB | VetHUB Certified | TVC Certified",
      "Email: anthony@imperiovita.co | Phone: (254) 265-9335 | (254) 226-5216",
      "",
      "ITEM PRICING:",
      "Description: " + bid.item_desc,
      "Quantity: " + (bid.qty || "") + " " + (bid.uom || ""),
      "Unit Price: $" + (bid.bid_unit_price || ""),
      "Total: $" + (bid.bid_total || ""),
      "Delivery: FOB " + (bid.fob || "Destination"),
      "",
    ];
    if (bid.submission_note) lines.push("Notes: " + bid.submission_note, "");
    lines.push(
      "Authorized Signature: Anthony Kelley, CEO",
      "The House of Kel LLC | Imperio Talent Solutions | CAGE 152U4",
    );
    return lines.join("\n");
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  ESBD TAB — main component
  // ══════════════════════════════════════════════════════════════════════════
  function EsbdTab({ goAward }) {
    const [bids, setBids] = useState([]);
    const [view, setView] = useState("list");
    const [editing, setEditing] = useState(null);
    const [filterStatus, setFilterStatus] = useState("All");
    const [search, setSearch] = useState("");
    const [pasteBox, setPasteBox] = useState("");
    const [parseError, setParseError] = useState("");

    const load = useCallback(() => {
      esbdGetAll().then((all) => {
        all.sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""));
        setBids(all);
      });
    }, []);

    useEffect(() => {
      load();
    }, [load]);

    const handleSave = async (bid) => {
      await esbdSave(bid);
      load();
      setView("list");
      setEditing(null);
    };

    const handleDelete = async (id) => {
      await esbdDelete(id);
      load();
    };

    const handleStatusChange = async (id, status) => {
      const bid = bids.find((b) => b.id === id);
      if (!bid) return;
      await esbdSave({ ...bid, status });
      load();
    };

    const handleEdit = (bid) => {
      setEditing(bid);
      setView("edit");
    };

    const handlePaste = () => {
      setParseError("");
      if (!pasteBox.trim()) {
        setParseError("Paste the JSON block from Claude first.");
        return;
      }
      const result = parseEsbdJson(pasteBox);
      if (!result.ok) {
        setParseError(result.error);
        return;
      }
      setEditing(result.bid);
      setView("form-parsed");
    };

    // ── PASTE VIEW ──
    if (view === "paste") {
      return h(
        "div",
        { style: { animation: "fadeUp .5s ease both", padding: "0 0 40px" } },
        h(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: "16px",
              marginBottom: "20px",
            },
          },
          h(
            GhostBtn,
            {
              onClick: () => {
                setView("list");
                setPasteBox("");
                setParseError("");
              },
            },
            "← Back",
          ),
          h("div", { className: "pipe-title" }, "Paste ESBD Intake"),
        ),
        h(
          "div",
          {
            style: {
              background: "var(--surface-1, rgba(255,255,255,.03))",
              border: "1px solid rgba(201,168,76,.2)",
              borderRadius: "8px",
              padding: "24px",
              maxWidth: "760px",
            },
          },
          h(
            "div",
            {
              style: {
                fontFamily: "Cormorant Garamond, serif",
                fontSize: "15px",
                color: "var(--body-faint)",
                fontStyle: "italic",
                marginBottom: "16px",
                lineHeight: "1.7",
              },
            },
            "After Claude analyzes an ESBD solicitation and calls GO, copy the ",
            h(
              "span",
              {
                style: {
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: "14px",
                  color: "rgba(201,168,76,.8)",
                  background: "rgba(201,168,76,.08)",
                  padding: "1px 6px",
                  borderRadius: "3px",
                },
              },
              "PASTE INTO ESBD INTAKE",
            ),
            " JSON block and drop it below.",
          ),
          h(
            "div",
            {
              style: {
                background: "rgba(201,168,76,.05)",
                border: "1px solid rgba(201,168,76,.12)",
                borderRadius: "6px",
                padding: "12px 14px",
                marginBottom: "16px",
                fontFamily: "JetBrains Mono, monospace",
                fontSize: "14px",
                color: "rgba(201,168,76,.5)",
                lineHeight: "1.6",
              },
            },
            '{"sol_id":"IW246367","title":"Disposable Clear Vinyl Gloves","agency":"TDCJ",...}',
          ),
          h(
            "div",
            {
              style: {
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                marginBottom: "16px",
              },
            },
            h(
              "label",
              {
                style: {
                  fontFamily: "Cinzel, serif",
                  fontSize: "14px",
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: "var(--body-faint)",
                },
              },
              "JSON Block from Claude",
            ),
            h("textarea", {
              value: pasteBox,
              onChange: (e) => {
                setPasteBox(e.target.value);
                setParseError("");
              },
              placeholder: "Paste JSON here...",
              rows: 10,
              style: {
                background: "var(--surface-2, rgba(255,255,255,.04))",
                border:
                  "1px solid " +
                  (parseError ? "rgba(232,116,116,.5)" : "rgba(201,168,76,.2)"),
                borderRadius: "4px",
                color: "var(--body-text, #F5F0E8)",
                fontFamily: "JetBrains Mono, monospace",
                fontSize: "14px",
                padding: "10px 12px",
                width: "100%",
                boxSizing: "border-box",
                outline: "none",
                resize: "vertical",
              },
            }),
          ),
          parseError &&
            h(
              "div",
              {
                style: {
                  fontFamily: "Cormorant Garamond, serif",
                  fontSize: "14px",
                  color: "rgba(232,116,116,.8)",
                  marginBottom: "12px",
                  fontStyle: "italic",
                },
              },
              parseError,
            ),
          h(
            "div",
            { style: { display: "flex", gap: "12px" } },
            h(GoldBtn, { onClick: handlePaste }, "Parse & Review"),
            h(
              GhostBtn,
              {
                onClick: () => {
                  setPasteBox("");
                  setParseError("");
                },
              },
              "Clear",
            ),
          ),
        ),
      );
    }

    // ── FORM-PARSED VIEW ──
    if (view === "form-parsed" && editing) {
      return h(
        "div",
        { style: { animation: "fadeUp .5s ease both", padding: "0 0 40px" } },
        h(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: "16px",
              marginBottom: "8px",
            },
          },
          h(GhostBtn, { onClick: () => setView("paste") }, "← Back to Paste"),
          h("div", { className: "pipe-title" }, "Review — " + editing.sol_id),
        ),
        h(
          "div",
          {
            style: {
              fontFamily: "Cormorant Garamond, serif",
              fontSize: "14px",
              fontStyle: "italic",
              color: "rgba(61,214,140,.7)",
              marginBottom: "16px",
            },
          },
          "Parsed from Claude analysis. Review fields below, then Save to pipeline.",
        ),
        h(BidForm, {
          initial: editing,
          onSave: handleSave,
          onCancel: () => setView("paste"),
        }),
      );
    }

    // Filter
    const visible = bids.filter((b) => {
      const matchStatus =
        filterStatus === "All"
          ? !["Lost", "No Bid"].includes(b.status)
          : b.status === filterStatus;
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        (b.sol_id || "").toLowerCase().includes(q) ||
        (b.title || "").toLowerCase().includes(q) ||
        (b.agency || "").toLowerCase().includes(q) ||
        (b.item_desc || "").toLowerCase().includes(q);
      return matchStatus && matchSearch;
    });

    // Summary stats
    const active = bids.filter(
      (b) => !["Awarded", "Lost", "No Bid"].includes(b.status),
    );
    const awarded = bids.filter((b) => b.status === "Awarded");
    const submitted = bids.filter((b) => b.status === "Submitted");
    const totalPipelineValue = active.reduce(
      (sum, b) => sum + (parseFloat(b.bid_total) || 0),
      0,
    );
    const totalAwardedValue = awarded.reduce(
      (sum, b) => sum + (parseFloat(b.bid_total) || 0),
      0,
    );

    // ── FORM VIEWS ──
    if (view === "form") {
      return h(
        "div",
        { style: { animation: "fadeUp .5s ease both", padding: "0 0 40px" } },
        h(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: "16px",
              marginBottom: "20px",
            },
          },
          h(GhostBtn, { onClick: () => setView("list") }, "← Back"),
          h("div", { className: "pipe-title" }, "New ESBD Bid"),
        ),
        h(BidForm, {
          initial: blankBid(),
          onSave: handleSave,
          onCancel: () => setView("list"),
        }),
      );
    }

    if (view === "edit" && editing) {
      return h(
        "div",
        { style: { animation: "fadeUp .5s ease both", padding: "0 0 40px" } },
        h(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: "16px",
              marginBottom: "20px",
            },
          },
          h(
            GhostBtn,
            {
              onClick: () => {
                setView("list");
                setEditing(null);
              },
            },
            "← Back",
          ),
          h("div", { className: "pipe-title" }, "Edit — " + editing.sol_id),
        ),
        h(BidForm, {
          initial: editing,
          onSave: handleSave,
          onCancel: () => {
            setView("list");
            setEditing(null);
          },
        }),
      );
    }

    // ── LIST VIEW ──
    return h(
      "div",
      { style: { animation: "fadeUp .5s ease both" } },

      // Header
      h(
        "div",
        { className: "pipe-header" },
        h(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: "4px" } },
          h("div", { className: "pipe-title" }, "ESBD Pipeline"),
          h(
            "div",
            {
              style: {
                fontFamily: "Cormorant Garamond,serif",
                fontSize: "14px",
                fontStyle: "italic",
                color: "var(--body-faint)",
              },
            },
            "Texas Electronic State Business Daily — state agency commodity bids",
          ),
        ),
        h(
          "div",
          { style: { display: "flex", gap: "10px", alignItems: "center" } },
          h(
            GhostBtn,
            { onClick: () => setView("form"), style: { fontSize: "14px" } },
            "Manual Entry",
          ),
          h(
            GoldBtn,
            {
              onClick: () => {
                setPasteBox("");
                setParseError("");
                setView("paste");
              },
            },
            "Paste from Claude",
          ),
        ),
      ),

      // Summary strip
      h(
        "div",
        {
          style: {
            display: "flex",
            gap: "2px",
            marginBottom: "20px",
            flexWrap: "wrap",
          },
        },
        ...[
          ["Total Bids", bids.length, "var(--body-faint)"],
          ["Active", active.length, "rgba(201,168,76,.8)"],
          ["Submitted", submitted.length, "rgba(135,206,235,.8)"],
          ["Awarded", awarded.length, "rgba(61,214,140,.9)"],
          ["Pipeline Value", fmt(totalPipelineValue), "rgba(201,168,76,.9)"],
          ["Awarded Value", fmt(totalAwardedValue), "rgba(61,214,140,.9)"],
        ].map(([label, val, color]) =>
          h(
            "div",
            {
              key: label,
              style: {
                flex: "1 1 120px",
                background: "var(--surface-1, rgba(255,255,255,.03))",
                border: "1px solid rgba(201,168,76,.12)",
                borderRadius: "6px",
                padding: "10px 14px",
                display: "flex",
                flexDirection: "column",
                gap: "3px",
              },
            },
            h(
              "div",
              {
                style: {
                  fontFamily: "Cinzel, serif",
                  fontSize: "14px",
                  letterSpacing: "0.18em",
                  color: "var(--body-faint)",
                },
              },
              label,
            ),
            h(
              "div",
              {
                style: {
                  fontFamily: "Cormorant Garamond, serif",
                  fontSize: "18px",
                  color,
                },
              },
              val,
            ),
          ),
        ),
      ),

      // Filters
      h(
        "div",
        {
          style: {
            display: "flex",
            gap: "10px",
            marginBottom: "16px",
            flexWrap: "wrap",
            alignItems: "center",
          },
        },
        h("input", {
          value: search,
          onChange: (e) => setSearch(e.target.value),
          placeholder: "Search sol ID, title, agency...",
          style: {
            flex: "1 1 200px",
            background: "var(--surface-2, rgba(255,255,255,.04))",
            border: "1px solid rgba(201,168,76,.2)",
            borderRadius: "4px",
            color: "var(--body-text)",
            fontFamily: "Cormorant Garamond, serif",
            fontSize: "15px",
            padding: "7px 12px",
            outline: "none",
          },
        }),
        h(
          "select",
          {
            value: filterStatus,
            onChange: (e) => setFilterStatus(e.target.value),
            style: {
              background: "var(--surface-2, rgba(255,255,255,.04))",
              border: "1px solid rgba(201,168,76,.2)",
              borderRadius: "4px",
              color: "var(--body-text)",
              fontFamily: "Cinzel, serif",
              fontSize: "14px",
              letterSpacing: "0.1em",
              padding: "7px 12px",
              outline: "none",
            },
          },
          ["All", ...ESBD_STATUSES].map((s) =>
            h(
              "option",
              { key: s, value: s, style: { background: "#1a0008" } },
              s,
            ),
          ),
        ),
      ),

      // Divider
      h(
        "div",
        { className: "divider", style: { margin: "0 0 16px" } },
        h("div", { className: "divider-line" }),
        h("div", { className: "divider-diamond" }),
        h("div", { className: "divider-line" }),
      ),

      // Bid cards
      visible.length === 0
        ? h(
            "div",
            {
              style: {
                textAlign: "center",
                padding: "60px 20px",
                fontFamily: "Cormorant Garamond, serif",
                fontSize: "16px",
                fontStyle: "italic",
                color: "var(--body-faint)",
              },
            },
            bids.length === 0
              ? 'No ESBD bids yet. Click "+ New ESBD Bid" to add your first.'
              : "No bids match the current filter.",
          )
        : h(
            "div",
            {
              style: {
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                paddingBottom: "40px",
              },
            },
            visible.map((bid) =>
              h(BidCard, {
                key: bid.id,
                bid,
                onEdit: handleEdit,
                onDelete: handleDelete,
                onStatusChange: handleStatusChange,
                goAward: goAward,
              }),
            ),
          ),
    );
  }

  // ── EXPOSE ────────────────────────────────────────────────────────────────
  window.SCC_ESBD = {
    esbdGetAll,
    esbdGetActive,
    esbdSave,
    esbdDelete,
  };

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.EsbdTab = EsbdTab;
})();
