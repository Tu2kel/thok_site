(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — SOURCE · VENDOR ROLODEX
  //  Pre-compiled React · No Babel · No JSX
  //  Depends on: source-blocked.js (VI_STATUS_STYLE)
  //  Exports: window.SCC_TABS.VendorRolodex
  // ═══════════════════════════════════════════════════════════════════════

  const {
    createElement: hS,
    useState: useSourceState,
    useEffect: useSourceEffect,
  } = React;

  function VendorRolodex() {
    const VI_STATUS_STYLE = window.SCC_TABS.VI_STATUS_STYLE;
    const { viGetAll, viSave, viDelete } = window.SCC_DB;
    const VI_STATUSES = ["confirmed", "quoted", "pending", "no_stock"];

    const [entries, setEntries] = useSourceState([]);
    const [loading, setLoading] = useSourceState(true);
    const [search, setSearch] = useSourceState("");

    useSourceEffect(() => {
      viGetAll().then((e) => {
        setEntries(e || []);
        setLoading(false);
      });
    }, []);

    const handleStatusChange = async (entry, newStatus) => {
      const updated = {
        ...entry,
        status: newStatus,
        last_updated: new Date().toLocaleDateString(),
      };
      await viSave(updated);
      setEntries((prev) => prev.map((r) => (r.id === entry.id ? updated : r)));
    };

    const handleDelete = async (id) => {
      if (!confirm("Remove this vendor intel record?")) return;
      await viDelete(id);
      setEntries((prev) => prev.filter((r) => r.id !== id));
    };

    const q = search.toLowerCase().trim();
    const filtered = entries.filter(
      (e) =>
        !q ||
        (e.vendor_name || "").toLowerCase().includes(q) ||
        (e.nsn || "").includes(q) ||
        (e.part_number || "").toLowerCase().includes(q) ||
        (e.sol_number || "").toLowerCase().includes(q) ||
        (e.fsc || "").includes(q),
    );

    // Group by vendor name
    const grouped = {};
    filtered.forEach((e) => {
      const key = e.vendor_name || "Unknown";
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(e);
    });
    const vendorGroups = Object.entries(grouped).sort((a, b) =>
      a[0].localeCompare(b[0]),
    );

    const ss = (status) =>
      (VI_STATUS_STYLE || {})[status] || {
        bg: "transparent",
        border: "rgba(201,168,76,.3)",
        color: "var(--gold-solid)",
      };

    return hS(
      "div",
      { style: { animation: "fadeUp .4s ease both" } },

      // Header + search
      hS(
        "div",
        {
          style: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "20px",
            flexWrap: "wrap",
            gap: "12px",
          },
        },
        hS(
          "div",
          null,
          hS(
            "div",
            {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: "18px",
                letterSpacing: ".1em",
                color: "var(--gold-solid)",
              },
            },
            "Vendor Rolodex",
          ),
          hS(
            "div",
            {
              style: {
                fontFamily: "Cormorant Garamond,serif",
                fontStyle: "italic",
                fontSize: "13px",
                color: "var(--gold-dim)",
                marginTop: "3px",
              },
            },
            entries.length +
              " intel records · " +
              Object.keys(grouped).length +
              " vendors",
          ),
        ),
        hS("input", {
          value: search,
          onChange: (e) => setSearch(e.target.value),
          placeholder: "Search vendor, NSN, part #, sol…",
          style: {
            padding: "8px 14px",
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

      loading &&
        hS(
          "div",
          {
            style: {
              fontFamily: "Cinzel,serif",
              fontSize: "11px",
              color: "var(--gold-dim)",
              letterSpacing: ".1em",
            },
          },
          "Loading vendor intel…",
        ),

      !loading &&
        entries.length === 0 &&
        hS(
          "div",
          {
            style: {
              fontFamily: "Cormorant Garamond,serif",
              fontStyle: "italic",
              fontSize: "15px",
              color: "var(--body-faint)",
              padding: "32px 0",
            },
          },
          "No vendor intel logged yet — add vendors in the pipeline drawer when sourcing.",
        ),

      !loading &&
        entries.length > 0 &&
        filtered.length === 0 &&
        hS(
          "div",
          {
            style: {
              fontFamily: "Cormorant Garamond,serif",
              fontStyle: "italic",
              fontSize: "14px",
              color: "var(--body-faint)",
              padding: "20px 0",
            },
          },
          'No records match "' + search + '"',
        ),

      // Vendor groups
      !loading &&
        vendorGroups.map(([vendorName, records]) =>
          hS(
            "div",
            {
              key: vendorName,
              style: {
                marginBottom: "20px",
                border: "1px solid rgba(201,168,76,.1)",
                background: "var(--surface-sheen)",
              },
            },

            // Vendor header
            hS(
              "div",
              {
                style: {
                  padding: "10px 16px",
                  borderBottom: "1px solid rgba(201,168,76,.1)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "rgba(201,168,76,.04)",
                },
              },
              hS(
                "span",
                {
                  style: {
                    fontFamily: "Cinzel,serif",
                    fontSize: "13px",
                    letterSpacing: ".08em",
                    color: "var(--gold-solid)",
                  },
                },
                vendorName,
              ),
              hS(
                "span",
                {
                  style: {
                    fontFamily: "JetBrains Mono,monospace",
                    fontSize: "10px",
                    color: "var(--gold-dim)",
                  },
                },
                records.length + " record" + (records.length !== 1 ? "s" : ""),
              ),
            ),

            // Records table
            hS(
              "div",
              { style: { overflowX: "auto" } },
              hS(
                "table",
                { style: { width: "100%", borderCollapse: "collapse" } },
                hS(
                  "thead",
                  null,
                  hS(
                    "tr",
                    null,
                    ...[
                      "NSN",
                      "Part #",
                      "FSC",
                      "Unit Price",
                      "Lead Time",
                      "MOQ",
                      "Sol #",
                      "Status",
                      "Updated",
                      "",
                    ].map((col) =>
                      hS(
                        "th",
                        {
                          key: col,
                          style: {
                            fontFamily: "Cinzel,serif",
                            fontSize: "9px",
                            letterSpacing: ".14em",
                            textTransform: "uppercase",
                            color: "var(--body-faint)",
                            padding: "8px 12px",
                            textAlign: col === "" ? "center" : "left",
                            borderBottom: "1px solid rgba(201,168,76,.12)",
                            whiteSpace: "nowrap",
                          },
                        },
                        col,
                      ),
                    ),
                  ),
                ),
                hS(
                  "tbody",
                  null,
                  ...records.map((e, i) => {
                    const style = ss(e.status);
                    return hS(
                      "tr",
                      {
                        key: e.id,
                        style: {
                          borderBottom: "1px solid rgba(201,168,76,.06)",
                          background:
                            i % 2 === 0
                              ? "transparent"
                              : "rgba(201,168,76,.02)",
                        },
                      },
                      hS(
                        "td",
                        {
                          style: {
                            padding: "8px 12px",
                            fontFamily: "JetBrains Mono,monospace",
                            fontSize: "12px",
                            color: "#C9A84C",
                          },
                        },
                        e.nsn || "—",
                      ),
                      hS(
                        "td",
                        {
                          style: {
                            padding: "8px 12px",
                            fontFamily: "JetBrains Mono,monospace",
                            fontSize: "12px",
                            color: "var(--accent-green-bright)",
                          },
                        },
                        e.part_number || "—",
                      ),
                      hS(
                        "td",
                        {
                          style: {
                            padding: "8px 12px",
                            fontFamily: "JetBrains Mono,monospace",
                            fontSize: "11px",
                            color: "var(--body-faint)",
                          },
                        },
                        e.fsc || "—",
                      ),
                      hS(
                        "td",
                        {
                          style: {
                            padding: "8px 12px",
                            fontFamily: "JetBrains Mono,monospace",
                            fontSize: "13px",
                            fontWeight: 700,
                            color: "var(--gold-solid)",
                            whiteSpace: "nowrap",
                          },
                        },
                        e.unit_price != null
                          ? "$" + parseFloat(e.unit_price).toFixed(2)
                          : "—",
                      ),
                      hS(
                        "td",
                        {
                          style: {
                            padding: "8px 12px",
                            fontFamily: "Cormorant Garamond,serif",
                            fontSize: "13px",
                            color: "var(--body-dim)",
                          },
                        },
                        e.lead_time || "—",
                      ),
                      hS(
                        "td",
                        {
                          style: {
                            padding: "8px 12px",
                            fontFamily: "JetBrains Mono,monospace",
                            fontSize: "12px",
                            color: "var(--body-faint)",
                          },
                        },
                        e.moq || "—",
                      ),
                      hS(
                        "td",
                        {
                          style: {
                            padding: "8px 12px",
                            fontFamily: "JetBrains Mono,monospace",
                            fontSize: "11px",
                            color: "var(--body-faint)",
                          },
                        },
                        e.sol_number || "—",
                      ),
                      hS(
                        "td",
                        { style: { padding: "8px 12px" } },
                        hS(
                          "select",
                          {
                            value: e.status || "pending",
                            onChange: (ev) =>
                              handleStatusChange(e, ev.target.value),
                            style: {
                              background: style.bg,
                              border: "1px solid " + style.border,
                              color: style.color,
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
                            hS(
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
                      ),
                      hS(
                        "td",
                        {
                          style: {
                            padding: "8px 12px",
                            fontFamily: "JetBrains Mono,monospace",
                            fontSize: "10px",
                            color: "var(--body-faint)",
                            whiteSpace: "nowrap",
                          },
                        },
                        e.last_updated || "—",
                      ),
                      hS(
                        "td",
                        { style: { padding: "8px 12px", textAlign: "center" } },
                        hS(
                          "button",
                          {
                            onClick: () => handleDelete(e.id),
                            style: {
                              background: "transparent",
                              border: "none",
                              color: "var(--accent-red-dim)",
                              cursor: "pointer",
                              fontSize: "13px",
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
          ),
        ),
    );
  }

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.VendorRolodex = VendorRolodex;
})();
