(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — SOURCE TAB
  //  Tabs: Vendor Rolodex | Distributor DB
  //  Pre-compiled React · No Babel · No JSX
  //  Exports: window.SCC_TABS.SourceTab
  // ═══════════════════════════════════════════════════════════════════════

  const { createElement: h, useState, useEffect, useCallback } = React;

  // ── DISTRIBUTOR DB PANEL ─────────────────────────────────────────────
  function DistributorDB() {
    const { distBatch, distDelete, distReloadCache, needsSeed, DISTRIBUTORS } =
      window.SCC_DIST;

    const [dists, setDists] = useState([]);
    const [paste, setPaste] = useState("");
    const [status, setStatus] = useState(null); // { ok, msg }
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState("");

    // Load current cache on mount
    useEffect(() => {
      window.SCC_DIST.onReady(() => {
        setDists([...window.SCC_DIST.DISTRIBUTORS]);
      });
    }, []);

    const refresh = () => setDists([...window.SCC_DIST.DISTRIBUTORS]);

    // ── Parse + seed ──────────────────────────────────────────────────
    const handleSeed = useCallback(async () => {
      if (!paste.trim()) {
        setStatus({ ok: false, msg: "Paste JSON array first." });
        return;
      }
      let records;
      try {
        const raw = paste.trim();
        records = JSON.parse(raw);
        if (!Array.isArray(records))
          throw new Error("Must be a JSON array [ {...}, ... ]");
        if (records.length === 0) throw new Error("Array is empty.");
        // Validate each record has minimum required fields
        const bad = records.filter((r) => !r.id || !r.name);
        if (bad.length)
          throw new Error(`${bad.length} record(s) missing id or name.`);
      } catch (e) {
        setStatus({ ok: false, msg: "Parse error: " + e.message });
        return;
      }
      setLoading(true);
      setStatus(null);
      try {
        const result = await distBatch(records);
        await distReloadCache();
        refresh();
        setStatus({
          ok: true,
          msg: `Done — ${result.inserted || 0} inserted, ${result.merged || 0} merged.${
            result.errors?.length ? " Errors: " + result.errors.join("; ") : ""
          }`,
        });
        setPaste("");
      } catch (e) {
        setStatus({ ok: false, msg: "Batch error: " + e.message });
      } finally {
        setLoading(false);
      }
    }, [paste, distBatch, distReloadCache]);

    // ── Delete ────────────────────────────────────────────────────────
    const handleDelete = useCallback(
      async (id) => {
        if (!confirm(`Remove distributor "${id}" from DB?`)) return;
        try {
          await distDelete(id);
          await distReloadCache();
          refresh();
          setStatus({ ok: true, msg: `Deleted: ${id}` });
        } catch (e) {
          setStatus({ ok: false, msg: "Delete error: " + e.message });
        }
      },
      [distDelete, distReloadCache],
    );

    const filtered = dists.filter((d) => {
      const q = search.toLowerCase();
      return (
        !q ||
        (d.name || "").toLowerCase().includes(q) ||
        (d.id || "").includes(q) ||
        (d.tags || []).some((t) => t.includes(q)) ||
        (d.fsc || []).some((f) => f.includes(q))
      );
    });

    const card = {
      background: "var(--surface-inset)",
      border: "1px solid rgba(201,168,76,.15)",
      borderRadius: "6px",
      padding: "16px",
      marginBottom: "16px",
    };

    const label = {
      fontFamily: "Cinzel,serif",
      fontSize: "8px",
      letterSpacing: ".15em",
      textTransform: "uppercase",
      color: "var(--gold-dim)",
      marginBottom: "6px",
    };

    return h(
      "div",
      { style: { animation: "fadeUp .4s ease both" } },

      // ── Header ──
      h(
        "div",
        {
          style: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: "20px",
            flexWrap: "wrap",
            gap: "12px",
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
                fontSize: "18px",
                letterSpacing: ".1em",
                color: "var(--gold-solid)",
              },
            },
            "Distributor DB",
          ),
          h(
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
            dists.length +
              " distributors loaded" +
              (needsSeed ? " — ⚠ Mongo empty, seed required" : ""),
          ),
        ),
        h("input", {
          value: search,
          onChange: (e) => setSearch(e.target.value),
          placeholder: "Filter by name, FSC, tag…",
          style: {
            padding: "7px 12px",
            background: "var(--inset-bg)",
            border: "1px solid rgba(201,168,76,.2)",
            color: "var(--alabaster)",
            fontFamily: "JetBrains Mono,monospace",
            fontSize: "12px",
            borderRadius: "4px",
            width: "220px",
          },
        }),
      ),

      // ── Seed panel ──
      h(
        "div",
        { style: card },
        h(
          "div",
          { style: label },
          "Seed / Import — paste dist-seed.json or any JSON array",
        ),
        h("textarea", {
          value: paste,
          onChange: (e) => setPaste(e.target.value),
          placeholder: '[{"id":"zoro","name":"Zoro Tools",...}, ...]',
          rows: 6,
          style: {
            width: "100%",
            boxSizing: "border-box",
            padding: "10px 12px",
            background: "var(--surface-sheen)",
            border: "1px solid rgba(201,168,76,.2)",
            color: "var(--alabaster)",
            fontFamily: "JetBrains Mono,monospace",
            fontSize: "11px",
            borderRadius: "4px",
            resize: "vertical",
            marginBottom: "10px",
          },
        }),
        h(
          "div",
          {
            style: {
              display: "flex",
              gap: "10px",
              alignItems: "center",
              flexWrap: "wrap",
            },
          },
          h(
            "button",
            {
              onClick: handleSeed,
              disabled: loading || !paste.trim(),
              style: {
                padding: "8px 20px",
                fontFamily: "Cinzel,serif",
                fontSize: "10px",
                letterSpacing: ".1em",
                background: loading
                  ? "rgba(201,168,76,.15)"
                  : "rgba(201,168,76,.2)",
                border: "1px solid rgba(201,168,76,.4)",
                color: "var(--gold-solid)",
                borderRadius: "4px",
                cursor: loading ? "wait" : "pointer",
              },
            },
            loading ? "Loading…" : "Parse & Seed Mongo",
          ),
          status &&
            h(
              "span",
              {
                style: {
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "11px",
                  color: status.ok ? "#3dd68c" : "#e74c3c",
                },
              },
              status.msg,
            ),
        ),
      ),

      // ── Current records table ──
      dists.length > 0 &&
        h(
          "div",
          {
            style: {
              border: "1px solid rgba(201,168,76,.12)",
              borderRadius: "6px",
              overflow: "hidden",
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
                { style: { background: "rgba(201,168,76,.06)" } },
                ["ID", "Name", "Phone", "FSCs", "P", "Search", ""].map((col) =>
                  h(
                    "th",
                    {
                      key: col,
                      style: {
                        fontFamily: "Cinzel,serif",
                        fontSize: "8px",
                        letterSpacing: ".12em",
                        color: "rgba(201,168,76,.6)",
                        padding: "8px 10px",
                        textAlign: "left",
                        borderBottom: "1px solid rgba(201,168,76,.1)",
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
              filtered.map((d, i) =>
                h(
                  "tr",
                  {
                    key: d.id,
                    style: {
                      background:
                        i % 2 === 0 ? "transparent" : "rgba(255,255,255,.02)",
                      borderBottom: "1px solid rgba(201,168,76,.06)",
                    },
                  },
                  // ID
                  h(
                    "td",
                    {
                      style: {
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "10px",
                        color: "var(--gold-dim)",
                        padding: "7px 10px",
                        whiteSpace: "nowrap",
                      },
                    },
                    d.id,
                  ),
                  // Name + tags
                  h(
                    "td",
                    { style: { padding: "7px 10px" } },
                    h(
                      "div",
                      {
                        style: {
                          fontFamily: "Cinzel,serif",
                          fontSize: "10px",
                          color: "var(--gold-solid)",
                          marginBottom: "2px",
                        },
                      },
                      d.name,
                    ),
                    h(
                      "div",
                      {
                        style: {
                          fontFamily: "JetBrains Mono,monospace",
                          fontSize: "9px",
                          color: "var(--body-faint)",
                        },
                      },
                      (d.tags || [])
                        .filter((t) => t !== "preferred-alt")
                        .slice(0, 4)
                        .join(" · "),
                    ),
                  ),
                  // Phone
                  h(
                    "td",
                    {
                      style: {
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "10px",
                        color: "var(--accent-green)",
                        padding: "7px 10px",
                        whiteSpace: "nowrap",
                      },
                    },
                    d.phone
                      ? h(
                          "a",
                          {
                            href: "tel:" + d.phone.replace(/\D/g, ""),
                            style: { color: "inherit", textDecoration: "none" },
                          },
                          d.phone,
                        )
                      : "—",
                  ),
                  // FSCs
                  h(
                    "td",
                    {
                      style: {
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "9px",
                        color: "var(--body-faint)",
                        padding: "7px 10px",
                        maxWidth: "140px",
                      },
                    },
                    (d.fsc || []).slice(0, 6).join(", ") +
                      ((d.fsc || []).length > 6
                        ? " +" + ((d.fsc || []).length - 6)
                        : ""),
                  ),
                  // Priority badge
                  h(
                    "td",
                    { style: { padding: "7px 10px", textAlign: "center" } },
                    h(
                      "span",
                      {
                        style: {
                          fontFamily: "Cinzel,serif",
                          fontSize: "9px",
                          color:
                            d.priority === 1
                              ? "#3dd68c"
                              : d.priority === 2
                                ? "var(--gold-solid)"
                                : "var(--body-faint)",
                        },
                      },
                      d.priority === 1 ? "★" : d.priority === 2 ? "P2" : "P3",
                    ),
                  ),
                  // Search mode
                  h(
                    "td",
                    { style: { padding: "7px 10px" } },
                    d.nsn_search === "full"
                      ? h(
                          "span",
                          {
                            style: {
                              fontFamily: "JetBrains Mono,monospace",
                              fontSize: "8px",
                              color: "#3dd68c",
                              background: "rgba(61,214,140,.12)",
                              border: "1px solid rgba(61,214,140,.3)",
                              padding: "1px 5px",
                              borderRadius: "2px",
                            },
                          },
                          "NSN✓",
                        )
                      : d.nsn_search === "niin"
                        ? h(
                            "span",
                            {
                              style: {
                                fontFamily: "JetBrains Mono,monospace",
                                fontSize: "8px",
                                color: "#7eb8f7",
                                background: "rgba(126,184,247,.12)",
                                border: "1px solid rgba(126,184,247,.3)",
                                padding: "1px 5px",
                                borderRadius: "2px",
                              },
                            },
                            "NIIN",
                          )
                        : h(
                            "span",
                            {
                              style: {
                                fontFamily: "JetBrains Mono,monospace",
                                fontSize: "8px",
                                color: "var(--body-faint)",
                              },
                            },
                            "P/N",
                          ),
                  ),
                  // Delete
                  h(
                    "td",
                    { style: { padding: "7px 10px", textAlign: "right" } },
                    h(
                      "button",
                      {
                        onClick: () => handleDelete(d.id),
                        title: "Remove " + d.id,
                        style: {
                          padding: "2px 8px",
                          fontFamily: "JetBrains Mono,monospace",
                          fontSize: "9px",
                          background: "rgba(231,76,60,.08)",
                          border: "1px solid rgba(231,76,60,.3)",
                          color: "rgba(231,76,60,.7)",
                          borderRadius: "3px",
                          cursor: "pointer",
                        },
                      },
                      "×",
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),

      // ── Empty state ──
      dists.length === 0 &&
        h(
          "div",
          {
            style: {
              padding: "40px",
              textAlign: "center",
              border: "1px dashed rgba(201,168,76,.2)",
              borderRadius: "6px",
              color: "var(--body-faint)",
              fontFamily: "Cormorant Garamond,serif",
              fontStyle: "italic",
              fontSize: "15px",
            },
          },
          "No distributors loaded. Paste dist-seed.json above and click Parse & Seed Mongo.",
        ),
    );
  }

  // ── SOURCE TAB ROOT ───────────────────────────────────────────────────
  function SourceTab({ showToast }) {
    const [subTab, setSubTab] = useState("rolodex");

    const { VendorRolodex } = window.SCC_TABS;

    const tabBtn = (id, label) =>
      h(
        "button",
        {
          onClick: () => setSubTab(id),
          style: {
            padding: "6px 16px",
            fontFamily: "Cinzel,serif",
            fontSize: "9px",
            letterSpacing: ".1em",
            background: subTab === id ? "rgba(201,168,76,.2)" : "transparent",
            border:
              subTab === id
                ? "1px solid rgba(201,168,76,.4)"
                : "1px solid rgba(201,168,76,.15)",
            color: subTab === id ? "var(--gold-solid)" : "var(--gold-dim)",
            borderRadius: "4px",
            cursor: "pointer",
            transition: "all .15s",
          },
        },
        label,
      );

    return h(
      "div",
      { style: { padding: "20px" } },
      // Sub-tab bar
      h(
        "div",
        { style: { display: "flex", gap: "8px", marginBottom: "20px" } },
        tabBtn("rolodex", "Vendor Rolodex"),
        tabBtn("distdb", "Distributor DB"),
      ),
      subTab === "rolodex" && VendorRolodex && h(VendorRolodex, { showToast }),
      subTab === "distdb" && h(DistributorDB, null),
    );
  }

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.SourceTab = SourceTab;
})();
