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
    const [dragging, setDragging] = useState(false);

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

    // ── Dedup ─────────────────────────────────────────────────────────
    const [dedupLoading, setDedupLoading] = useState(false);
    const handleDedup = useCallback(async () => {
      if (
        !confirm(
          "Scan Mongo for duplicate distributor names and merge them into single records?",
        )
      )
        return;
      setDedupLoading(true);
      setStatus(null);
      try {
        const res = await fetch("/.netlify/functions/scc-distributors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "distDedup", payload: {} }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Dedup failed");
        await distReloadCache();
        refresh();
        setStatus({
          ok: true,
          msg: `Dedup complete — ${data.result.merged} name groups merged, ${data.result.deleted} duplicate records removed.`,
        });
      } catch (e) {
        setStatus({ ok: false, msg: "Dedup error: " + e.message });
      } finally {
        setDedupLoading(false);
      }
    }, [distReloadCache]);

    // ── File / drop ───────────────────────────────────────────────────
    const readFile = useCallback((file) => {
      if (!file) return;
      if (!file.name.endsWith(".json")) {
        setStatus({ ok: false, msg: "Drop a .json file." });
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => setPaste(e.target.result);
      reader.onerror = () =>
        setStatus({ ok: false, msg: "Could not read file." });
      reader.readAsText(file);
    }, []);
    const handleDrop = useCallback(
      (e) => {
        e.preventDefault();
        setDragging(false);
        readFile(e.dataTransfer.files[0]);
      },
      [readFile],
    );
    const handleDragOver = (e) => {
      e.preventDefault();
      setDragging(true);
    };
    const handleDragLeave = () => setDragging(false);
    const handleFileInput = (e) => readFile(e.target.files[0]);

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
          "Seed / Import — drop dist-seed.json, pick a file, or paste JSON",
        ),

        // ── Drop zone ──
        h(
          "div",
          {
            onDrop: handleDrop,
            onDragOver: handleDragOver,
            onDragLeave: handleDragLeave,
            style: {
              border: dragging
                ? "2px dashed rgba(201,168,76,.8)"
                : paste.trim()
                  ? "2px dashed rgba(61,214,140,.5)"
                  : "2px dashed rgba(201,168,76,.25)",
              borderRadius: "6px",
              padding: "20px 16px",
              marginBottom: "10px",
              textAlign: "center",
              background: dragging
                ? "rgba(201,168,76,.06)"
                : paste.trim()
                  ? "rgba(61,214,140,.04)"
                  : "var(--surface-sheen)",
              transition: "all .15s",
              position: "relative",
            },
          },
          h("input", {
            type: "file",
            accept: ".json",
            onChange: handleFileInput,
            style: {
              position: "absolute",
              inset: 0,
              opacity: 0,
              cursor: "pointer",
              width: "100%",
              height: "100%",
            },
          }),
          paste.trim()
            ? h(
                "div",
                null,
                h(
                  "div",
                  { style: { fontSize: "18px", marginBottom: "4px" } },
                  "\u2713",
                ),
                h(
                  "div",
                  {
                    style: {
                      fontFamily: "Cinzel,serif",
                      fontSize: "9px",
                      letterSpacing: ".1em",
                      color: "#3dd68c",
                    },
                  },
                  (() => {
                    try {
                      return JSON.parse(paste).length + " records ready";
                    } catch {
                      return "JSON loaded — check format";
                    }
                  })(),
                ),
                h(
                  "div",
                  {
                    style: {
                      fontFamily: "JetBrains Mono,monospace",
                      fontSize: "9px",
                      color: "var(--body-faint)",
                      marginTop: "4px",
                    },
                  },
                  "Drop another file or click to replace",
                ),
              )
            : h(
                "div",
                null,
                h(
                  "div",
                  { style: { fontSize: "22px", marginBottom: "6px" } },
                  dragging ? "\u2B07" : "\uD83D\uDCC2",
                ),
                h(
                  "div",
                  {
                    style: {
                      fontFamily: "Cinzel,serif",
                      fontSize: "10px",
                      letterSpacing: ".08em",
                      color: dragging ? "var(--gold-solid)" : "var(--gold-dim)",
                    },
                  },
                  dragging
                    ? "Drop it"
                    : "Drop dist-seed.json or click to browse",
                ),
              ),
        ),

        // ── Paste fallback ──
        h("textarea", {
          value: paste,
          onChange: (e) => setPaste(e.target.value),
          placeholder: '[{"id":"zoro","name":"Zoro Tools",...}, ...]',
          rows: 2,
          style: {
            width: "100%",
            boxSizing: "border-box",
            padding: "8px 12px",
            background: "var(--surface-sheen)",
            border: "1px solid rgba(201,168,76,.15)",
            color: "var(--alabaster)",
            fontFamily: "JetBrains Mono,monospace",
            fontSize: "10px",
            borderRadius: "4px",
            resize: "vertical",
            marginBottom: "10px",
            opacity: 0.6,
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
          h(
            "button",
            {
              onClick: handleDedup,
              disabled: dedupLoading,
              title:
                "Find all duplicate distributor names in Mongo and merge them into single records",
              style: {
                padding: "8px 20px",
                fontFamily: "Cinzel,serif",
                fontSize: "10px",
                letterSpacing: ".1em",
                background: dedupLoading
                  ? "rgba(231,76,60,.08)"
                  : "rgba(231,76,60,.15)",
                border: "1px solid rgba(231,76,60,.4)",
                color: "#e74c3c",
                borderRadius: "4px",
                cursor: dedupLoading ? "wait" : "pointer",
                marginLeft: "8px",
              },
            },
            dedupLoading ? "Merging\u2026" : "\u26a1 Dedup & Merge",
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

      // -- Tiered card grid --
      (() => {
        if (dists.length === 0) return null;
        const isPreferred = (d) => (d.tags || []).includes("preferred-alt");
        const preferred = filtered.filter(isPreferred);
        const others = filtered.filter((d) => !isPreferred(d));
        const p1 = preferred.filter((d) => (d.priority || 9) === 1);
        const p2 = preferred.filter((d) => (d.priority || 9) === 2);
        const p3 = preferred.filter((d) => (d.priority || 9) >= 3);

        const tierLabel = (text, count, color, sub) =>
          h(
            "div",
            {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: sub ? "7px" : "8px",
                letterSpacing: ".15em",
                textTransform: "uppercase",
                color: color || "var(--gold-dim)",
                marginTop: sub ? "10px" : "18px",
                marginBottom: "8px",
                paddingLeft: sub ? "4px" : "0",
                borderLeft: sub
                  ? "3px solid " + (color || "rgba(201,168,76,.3)")
                  : "none",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              },
            },
            text,
            h(
              "span",
              {
                style: {
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "9px",
                  color: "var(--body-faint)",
                  letterSpacing: 0,
                },
              },
              "(" + count + ")",
            ),
          );

        const renderDistCard = (d) => {
          const pref = isPreferred(d);
          const borderColor = !pref
            ? "rgba(201,168,76,.12)"
            : d.priority === 1
              ? "rgba(61,214,140,.5)"
              : d.priority === 2
                ? "rgba(201,168,76,.4)"
                : "rgba(160,160,160,.3)";
          return h(
            "div",
            {
              key: d.id,
              style: {
                background: "var(--surface-sheen)",
                border: "1px solid rgba(201,168,76,.12)",
                borderLeft: "3px solid " + borderColor,
                borderRadius: "4px",
                padding: "10px 12px",
                display: "flex",
                flexDirection: "column",
                gap: "5px",
              },
            },
            // Name + NSN badge
            h(
              "div",
              {
                style: {
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: "6px",
                },
              },
              h(
                "div",
                {
                  style: {
                    fontFamily: "Cinzel,serif",
                    fontSize: "10px",
                    letterSpacing: ".06em",
                    color: "var(--gold-solid)",
                    lineHeight: 1.3,
                  },
                },
                d.name,
              ),
              h(
                "div",
                {
                  style: {
                    display: "flex",
                    gap: "3px",
                    alignItems: "center",
                    flexShrink: 0,
                  },
                },
                d.nsn_search === "full" &&
                  h(
                    "span",
                    {
                      style: {
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "7px",
                        color: "#3dd68c",
                        background: "rgba(61,214,140,.12)",
                        border: "1px solid rgba(61,214,140,.3)",
                        padding: "1px 4px",
                        borderRadius: "2px",
                      },
                    },
                    "NSN\u2713",
                  ),
                d.nsn_search === "niin" &&
                  h(
                    "span",
                    {
                      style: {
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "7px",
                        color: "#7eb8f7",
                        background: "rgba(126,184,247,.12)",
                        border: "1px solid rgba(126,184,247,.3)",
                        padding: "1px 4px",
                        borderRadius: "2px",
                      },
                    },
                    "NIIN",
                  ),
              ),
            ),
            // Tags
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
                .join(" \u00B7") || "\u00A0",
            ),
            // FSCs
            h(
              "div",
              {
                style: {
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "9px",
                  color: "rgba(201,168,76,.45)",
                },
              },
              (d.fsc || []).slice(0, 5).join(", ") +
                ((d.fsc || []).length > 5
                  ? " +" + ((d.fsc || []).length - 5)
                  : ""),
            ),
            // Phone + delete
            h(
              "div",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginTop: "2px",
                },
              },
              d.phone
                ? h(
                    "a",
                    {
                      href: "tel:" + d.phone.replace(/[^0-9]/g, ""),
                      style: {
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "10px",
                        color: "var(--accent-green)",
                        textDecoration: "none",
                      },
                    },
                    "\uD83D\uDCDE " + d.phone,
                  )
                : h(
                    "span",
                    {
                      style: {
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "9px",
                        color: "var(--body-faint)",
                        fontStyle: "italic",
                      },
                    },
                    "No phone",
                  ),
              h(
                "button",
                {
                  onClick: () => handleDelete(d.id),
                  title: "Remove " + d.id,
                  style: {
                    padding: "1px 6px",
                    fontFamily: "JetBrains Mono,monospace",
                    fontSize: "9px",
                    background: "rgba(231,76,60,.08)",
                    border: "1px solid rgba(231,76,60,.25)",
                    color: "rgba(231,76,60,.6)",
                    borderRadius: "3px",
                    cursor: "pointer",
                  },
                },
                "\u00D7",
              ),
            ),
          );
        };

        const grid = (items, op) =>
          h(
            "div",
            {
              style: {
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))",
                gap: "8px",
                marginBottom: "6px",
                opacity: op || 1,
              },
            },
            ...items.map(renderDistCard),
          );

        return h(
          "div",
          null,
          preferred.length > 0 &&
            h(
              "div",
              null,
              tierLabel("Preferred Sources", preferred.length, "#3dd68c"),
              p1.length > 0 &&
                h(
                  "div",
                  null,
                  tierLabel(
                    "P1 \u2014 Broadest \u00B7 Hit First",
                    p1.length,
                    "#3dd68c",
                    true,
                  ),
                  grid(p1),
                ),
              p2.length > 0 &&
                h(
                  "div",
                  null,
                  tierLabel(
                    "P2 \u2014 Lane Specialists",
                    p2.length,
                    "var(--gold-solid)",
                    true,
                  ),
                  grid(p2),
                ),
              p3.length > 0 &&
                h(
                  "div",
                  null,
                  tierLabel(
                    "P3 \u2014 Need Account",
                    p3.length,
                    "var(--body-faint)",
                    true,
                  ),
                  grid(p3),
                ),
            ),
          others.length > 0 &&
            h(
              "div",
              null,
              tierLabel("Other Distributors", others.length, "var(--gold-dim)"),
              grid(others, 0.65),
            ),
        );
      })(),

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
