(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — PIPELINE · VENDOR INTEL PANEL
  //  Pre-compiled React · No Babel · No JSX
  //  Exports: window.SCC_TABS.VendorIntelPanel
  // ═══════════════════════════════════════════════════════════════════════

  const {
    createElement: hP,
    useState: usePState,
    useEffect: usePEffect,
  } = React;

  const VI_STATUSES = ["confirmed", "quoted", "pending", "no_stock"];

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
      viGetByNSN(nsn).then(async (e) => {
        // If no existing entries, auto-seed from the parsed supplier list on the record
        if (e.length === 0 && record.all_suppliers) {
          const pipe = [
            ...(record.all_suppliers || "").matchAll(
              /([^(]+)\s+\(([A-Z0-9]{5})\)\s+P\/N:\s+([^\s·]+)/g,
            ),
          ];
          const seeded = [];
          for (const m of pipe) {
            const vname = m[1].trim();
            const cage = m[2].trim();
            const pn = m[3].trim();
            const vid = cage.toLowerCase();
            const rec = {
              id: nsn + "::" + vid + "::" + Date.now() + Math.random(),
              nsn,
              fsc,
              vendor_id: vid,
              vendor_name: vname,
              part_number: pn,
              unit_price: null,
              lead_time: "",
              moq: "",
              notes: "Auto-seeded from DIBBS supplier list",
              status: "pending",
              sol_number: record.sol_number,
              last_updated: new Date().toLocaleDateString(),
            };
            await viSave(rec);
            seeded.push(rec);
          }
          setEntries(seeded.length ? seeded : e);
        } else {
          setEntries(e);
        }
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

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.VendorIntelPanel = VendorIntelPanel;
})();
