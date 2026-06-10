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

    const [purgeLoading, setPurgeLoading] = useState(false);
    const [expandedCards, setExpandedCards] = useState({});
    const toggleCard = (id) =>
      setExpandedCards((prev) => ({ ...prev, [id]: !prev[id] }));

    const [editingCards, setEditingCards] = useState({}); // id → draft object | undefined
    const [savingCards, setSavingCards] = useState({}); // id → bool

    const startEdit = (d) =>
      setEditingCards((prev) => ({
        ...prev,
        [d.id]: {
          name: d.name || "",
          phone: d.phone || "",
          email: d.email || "",
          website: d.website || "",
          notes: d.notes || "",
          fsc: (d.fsc || []).join(", "),
          tags: (d.tags || []).filter((t) => t !== "preferred-alt").join(", "),
        },
      }));

    const cancelEdit = (id) =>
      setEditingCards((prev) => {
        const n = { ...prev };
        delete n[id];
        return n;
      });

    const patchDraft = (id, field, val) =>
      setEditingCards((prev) => ({
        ...prev,
        [id]: { ...prev[id], [field]: val },
      }));

    const saveCard = async (d) => {
      const draft = editingCards[d.id];
      if (!draft) return;
      setSavingCards((prev) => ({ ...prev, [d.id]: true }));
      try {
        const parseCsv = (s) =>
          s
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean);
        const updated = {
          ...d,
          name: draft.name.trim() || d.name,
          phone: draft.phone.trim(),
          email: draft.email.trim(),
          website: draft.website.trim(),
          notes: draft.notes.trim(),
          fsc: parseCsv(draft.fsc),
          tags: [
            ...parseCsv(draft.tags),
            ...(d.tags || []).filter((t) => t === "preferred-alt"),
          ],
        };
        await window.SCC_DIST.distSave(updated);
        await window.SCC_DIST.distReloadCache();
        setDists([...window.SCC_DIST.DISTRIBUTORS]);
        cancelEdit(d.id);
      } catch (e) {
        alert("Save failed: " + e.message);
      } finally {
        setSavingCards((prev) => {
          const n = { ...prev };
          delete n[d.id];
          return n;
        });
      }
    };
    const handlePurge = useCallback(async () => {
      if (
        !confirm(
          "PURGE ALL distributors from MongoDB?\n\nThis deletes every record and cannot be undone. Use only when starting fresh with real contacts.",
        )
      )
        return;
      setPurgeLoading(true);
      setStatus(null);
      try {
        const result = await window.SCC_DIST.distPurge();
        await distReloadCache();
        refresh();
        setStatus({
          ok: true,
          msg: `Purged — ${result.purged || 0} record(s) removed. DB is now empty.`,
        });
      } catch (e) {
        setStatus({ ok: false, msg: "Purge error: " + e.message });
      } finally {
        setPurgeLoading(false);
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

    // ── Account / Rep toggle ──────────────────────────────────────────
    const handleToggle = useCallback(
      async (d, field) => {
        const updated = { ...d, [field]: !d[field] };
        try {
          await window.SCC_DIST.distSave(updated);
          await window.SCC_DIST.distReloadCache();
          setDists([...window.SCC_DIST.DISTRIBUTORS]);
        } catch (e) {
          setStatus({ ok: false, msg: "Toggle error: " + e.message });
        }
      },
      [distReloadCache],
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
          h(
            "button",
            {
              onClick: handlePurge,
              disabled: purgeLoading || dists.length === 0,
              title:
                "Delete ALL distributor records from MongoDB — use when starting fresh",
              style: {
                padding: "8px 20px",
                fontFamily: "Cinzel,serif",
                fontSize: "10px",
                letterSpacing: ".1em",
                background: purgeLoading
                  ? "rgba(180,0,0,.08)"
                  : "rgba(100,0,0,.25)",
                border: "1px solid rgba(180,0,0,.5)",
                color: "#ff6b6b",
                borderRadius: "4px",
                cursor:
                  purgeLoading || dists.length === 0
                    ? "not-allowed"
                    : "pointer",
                marginLeft: "8px",
                opacity: dists.length === 0 ? 0.4 : 1,
              },
            },
            purgeLoading ? "Purging\u2026" : "\uD83D\uDDD1 Purge All",
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

        // per-card state lives in component-level maps (expandedCards, editingCards)

        const renderDistCard = (d) => {
          const pref = isPreferred(d);
          const expanded = !!expandedCards[d.id];
          const draft = editingCards[d.id]; // undefined = view mode
          const isEditing = !!draft;
          const isSaving = !!savingCards[d.id];

          const hasAcct = !!d.has_account;
          const hasRep = !!d.has_rep;
          const hasJcp = !!d.has_jcp;
          const hasMilPack = !!d.has_mil_std_pack;

          // Border + card bg: rep (green) > account (gold) > pref tiers > default
          let borderColor, cardBg, cardBorder;
          if (hasRep) {
            borderColor = "rgba(61,214,140,.75)";
            cardBg = "rgba(61,214,140,.05)";
            cardBorder = "1px solid rgba(61,214,140,.28)";
          } else if (hasAcct) {
            borderColor = "rgba(201,168,76,.9)";
            cardBg = "rgba(201,168,76,.07)";
            cardBorder = "1px solid rgba(201,168,76,.38)";
          } else if (pref) {
            borderColor =
              d.priority === 1
                ? "rgba(61,214,140,.5)"
                : d.priority === 2
                  ? "rgba(201,168,76,.4)"
                  : "rgba(160,160,160,.3)";
            cardBg = isEditing
              ? "rgba(201,168,76,.04)"
              : "var(--surface-sheen)";
            cardBorder = isEditing
              ? "1px solid rgba(201,168,76,.35)"
              : "1px solid rgba(201,168,76,.14)";
          } else {
            borderColor = "rgba(201,168,76,.12)";
            cardBg = isEditing
              ? "rgba(201,168,76,.04)"
              : "var(--surface-sheen)";
            cardBorder = isEditing
              ? "1px solid rgba(201,168,76,.35)"
              : "1px solid rgba(201,168,76,.14)";
          }

          // Small toggle pill button
          const toggleBtn = (
            active,
            label,
            title,
            field,
            activeBg,
            activeBorder,
            activeColor,
          ) =>
            h(
              "button",
              {
                onClick: (e) => {
                  e.stopPropagation();
                  handleToggle(d, field);
                },
                title,
                style: {
                  padding: "3px 8px",
                  fontSize: "9px",
                  fontFamily: "JetBrains Mono,monospace",
                  fontWeight: active ? "700" : "400",
                  letterSpacing: ".06em",
                  lineHeight: "14px",
                  background: active ? activeBg : "rgba(255,255,255,.04)",
                  border: "1px solid " + (active ? activeBorder : "rgba(255,255,255,.12)"),
                  color: active ? activeColor : "rgba(255,255,255,.25)",
                  borderRadius: "3px",
                  cursor: "pointer",
                  transition: "all .15s",
                  flexShrink: 0,
                  boxShadow: active ? ("0 0 6px " + activeBorder) : "none",
                  textShadow: active ? ("0 0 8px " + activeColor) : "none",
                },
              },
              label,
            );

          const allFsc = d.fsc || [];
          const shownFsc = expanded ? allFsc : allFsc.slice(0, 6);
          const hiddenCount = allFsc.length - 6;

          const chipStyle = {
            fontFamily: "JetBrains Mono,monospace",
            fontSize: "9px",
            color: "rgba(201,168,76,.7)",
            background: "rgba(201,168,76,.08)",
            border: "1px solid rgba(201,168,76,.18)",
            borderRadius: "3px",
            padding: "1px 5px",
            display: "inline-block",
          };

          const rowStyle = {
            display: "flex",
            alignItems: "center",
            gap: "6px",
            minWidth: 0,
          };

          const iconColor = "rgba(201,168,76,.5)";

          // ── shared input style ──
          const inputStyle = {
            flex: 1,
            minWidth: 0,
            fontFamily: "JetBrains Mono,monospace",
            fontSize: "11px",
            background: "rgba(201,168,76,.06)",
            border: "1px solid rgba(201,168,76,.25)",
            borderRadius: "3px",
            color: "var(--alabaster)",
            padding: "4px 8px",
            outline: "none",
          };

          const fieldLabel = (txt) =>
            h(
              "span",
              {
                style: {
                  fontFamily: "Cinzel,serif",
                  fontSize: "8px",
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                  color: "var(--gold-dim)",
                  flexShrink: 0,
                  width: "52px",
                },
              },
              txt,
            );

          return h(
            "div",
            {
              key: d.id,
              style: {
                background: cardBg,
                border: cardBorder,
                borderLeft: "3px solid " + borderColor,
                borderRadius: "4px",
                padding: "14px 16px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                transition: "background .15s, border .15s",
              },
            },

            // ── Row 1: Name + badges + toggle buttons + action buttons ──
            h(
              "div",
              {
                style: {
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: "8px",
                },
              },
              // Name (editable in edit mode)
              isEditing
                ? h("input", {
                    value: draft.name,
                    onChange: (e) => patchDraft(d.id, "name", e.target.value),
                    style: {
                      ...inputStyle,
                      fontFamily: "Cinzel,serif",
                      fontSize: "12px",
                      letterSpacing: ".05em",
                      color: "var(--gold-solid)",
                      flex: 1,
                    },
                    placeholder: "Company name",
                  })
                : h(
                    "div",
                    {
                      style: {
                        fontFamily: "Cinzel,serif",
                        fontSize: "12px",
                        letterSpacing: ".06em",
                        color: hasRep
                          ? "#3dd68c"
                          : hasAcct
                            ? "#d4a843"
                            : "var(--gold-solid)",
                        lineHeight: 1.35,
                        flex: 1,
                        minWidth: 0,
                      },
                    },
                    d.name,
                  ),

              // Right cluster: status badges + toggle btns + edit/delete
              h(
                "div",
                {
                  style: {
                    display: "flex",
                    gap: "4px",
                    alignItems: "center",
                    flexShrink: 0,
                    flexWrap: "wrap",
                    justifyContent: "flex-end",
                  },
                },

                // Status badges (view mode only)
                !isEditing &&
                  hasRep &&
                  h(
                    "span",
                    {
                      style: {
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "8px",
                        color: "#3dd68c",
                        background: "rgba(61,214,140,.14)",
                        border: "1px solid rgba(61,214,140,.4)",
                        padding: "2px 6px",
                        borderRadius: "2px",
                        letterSpacing: ".05em",
                        whiteSpace: "nowrap",
                      },
                    },
                    "ACCT REP",
                  ),
                !isEditing &&
                  hasAcct &&
                  h(
                    "span",
                    {
                      style: {
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "8px",
                        color: "#C9A84C",
                        background: "rgba(201,168,76,.14)",
                        border: "1px solid rgba(201,168,76,.4)",
                        padding: "2px 6px",
                        borderRadius: "2px",
                        letterSpacing: ".05em",
                        whiteSpace: "nowrap",
                      },
                    },
                    "WEB RFQ",
                  ),

                // NSN / NIIN badges
                !isEditing &&
                  d.nsn_search === "full" &&
                  h(
                    "span",
                    {
                      style: {
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "8px",
                        color: "#3dd68c",
                        background: "rgba(61,214,140,.12)",
                        border: "1px solid rgba(61,214,140,.3)",
                        padding: "2px 5px",
                        borderRadius: "2px",
                      },
                    },
                    "NSN\u2713",
                  ),
                !isEditing &&
                  d.nsn_search === "niin" &&
                  h(
                    "span",
                    {
                      style: {
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "8px",
                        color: "#7eb8f7",
                        background: "rgba(126,184,247,.12)",
                        border: "1px solid rgba(126,184,247,.3)",
                        padding: "2px 5px",
                        borderRadius: "2px",
                      },
                    },
                    "NIIN",
                  ),


                // Edit / Save / Cancel
                !isEditing &&
                  h(
                    "button",
                    {
                      onClick: () => startEdit(d),
                      title: "Edit record",
                      style: {
                        padding: "2px 8px",
                        fontFamily: "Cinzel,serif",
                        fontSize: "8px",
                        letterSpacing: ".08em",
                        background: "rgba(201,168,76,.1)",
                        border: "1px solid rgba(201,168,76,.3)",
                        color: "var(--gold-dim)",
                        borderRadius: "3px",
                        cursor: "pointer",
                      },
                    },
                    "Edit",
                  ),
                isEditing &&
                  h(
                    "button",
                    {
                      onClick: () => saveCard(d),
                      disabled: isSaving,
                      title: "Save changes",
                      style: {
                        padding: "2px 10px",
                        fontFamily: "Cinzel,serif",
                        fontSize: "8px",
                        letterSpacing: ".08em",
                        background: isSaving
                          ? "rgba(61,214,140,.1)"
                          : "rgba(61,214,140,.18)",
                        border: "1px solid rgba(61,214,140,.45)",
                        color: "#3dd68c",
                        borderRadius: "3px",
                        cursor: isSaving ? "wait" : "pointer",
                      },
                    },
                    isSaving ? "Saving\u2026" : "Save",
                  ),
                isEditing &&
                  h(
                    "button",
                    {
                      onClick: () => cancelEdit(d.id),
                      disabled: isSaving,
                      title: "Cancel edit",
                      style: {
                        padding: "2px 8px",
                        fontFamily: "Cinzel,serif",
                        fontSize: "8px",
                        letterSpacing: ".08em",
                        background: "transparent",
                        border: "1px solid rgba(255,255,255,.12)",
                        color: "var(--body-faint)",
                        borderRadius: "3px",
                        cursor: "pointer",
                      },
                    },
                    "Cancel",
                  ),
                !isEditing &&
                  h(
                    "button",
                    {
                      onClick: () => handleDelete(d.id),
                      title: "Remove " + d.id,
                      style: {
                        padding: "2px 7px",
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "10px",
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
            ),

            // ── Toggle buttons (under card name) ──
            !isEditing &&
              h(
                "div",
                {
                  style: {
                    display: "flex",
                    gap: "5px",
                    flexWrap: "wrap",
                  },
                },
                toggleBtn(
                  hasAcct,
                  "\u2605",
                  hasAcct
                    ? "Clear: web account"
                    : "Mark: have account — use web RFQ",
                  "has_account",
                  "rgba(201,168,76,.35)",
                  "#C9A84C",
                  "#ffe08a",
                ),
                toggleBtn(
                  hasRep,
                  "\uD83D\uDC64",
                  hasRep ? "Clear: account rep" : "Mark: have account rep",
                  "has_rep",
                  "rgba(61,214,140,.30)",
                  "#3dd68c",
                  "#9effd4",
                ),
                toggleBtn(
                  hasJcp,
                  "JCP",
                  hasJcp ? "Clear: JCP certified" : "Mark: JCP certified",
                  "has_jcp",
                  "rgba(167,139,250,.32)",
                  "#a78bfa",
                  "#ddd6fe",
                ),
                toggleBtn(
                  hasMilPack,
                  "MIL≡",
                  hasMilPack ? "Clear: mil-std packing" : "Mark: mil-std packing capable",
                  "has_mil_std_pack",
                  "rgba(96,165,250,.28)",
                  "#60a5fa",
                  "#bae6fd",
                ),
              ),

            // ════ VIEW MODE ════════════════════════════════════════════════
            !isEditing &&
              h(
                React.Fragment,
                null,

                // Tags
                (d.tags || []).filter((t) => t !== "preferred-alt").length >
                  0 &&
                  h(
                    "div",
                    {
                      style: { display: "flex", flexWrap: "wrap", gap: "4px" },
                    },
                    ...(d.tags || [])
                      .filter((t) => t !== "preferred-alt")
                      .map((t) =>
                        h(
                          "span",
                          {
                            key: t,
                            style: {
                              fontFamily: "JetBrains Mono,monospace",
                              fontSize: "9px",
                              color: "var(--body-dim)",
                              background: "rgba(255,255,255,.04)",
                              border: "1px solid rgba(255,255,255,.08)",
                              borderRadius: "3px",
                              padding: "1px 5px",
                            },
                          },
                          t,
                        ),
                      ),
                  ),

                // FSC chips + more toggle
                allFsc.length > 0 &&
                  h(
                    "div",
                    {
                      style: {
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "4px",
                        alignItems: "center",
                      },
                    },
                    ...shownFsc.map((f) =>
                      h("span", { key: f, style: chipStyle }, f),
                    ),
                    !expanded &&
                      hiddenCount > 0 &&
                      h(
                        "button",
                        {
                          onClick: () => toggleCard(d.id),
                          style: {
                            fontFamily: "JetBrains Mono,monospace",
                            fontSize: "9px",
                            color: "var(--gold-dim)",
                            background: "rgba(201,168,76,.06)",
                            border: "1px solid rgba(201,168,76,.2)",
                            borderRadius: "3px",
                            padding: "1px 6px",
                            cursor: "pointer",
                          },
                        },
                        "+" + hiddenCount + " more",
                      ),
                    expanded &&
                      allFsc.length > 6 &&
                      h(
                        "button",
                        {
                          onClick: () => toggleCard(d.id),
                          style: {
                            fontFamily: "JetBrains Mono,monospace",
                            fontSize: "9px",
                            color: "var(--body-faint)",
                            background: "transparent",
                            border: "1px solid rgba(201,168,76,.12)",
                            borderRadius: "3px",
                            padding: "1px 6px",
                            cursor: "pointer",
                          },
                        },
                        "collapse",
                      ),
                  ),

                // Divider
                h("div", {
                  style: {
                    borderTop: "1px solid rgba(201,168,76,.08)",
                    margin: "0 -2px",
                  },
                }),

                // Phone
                h(
                  "div",
                  { style: rowStyle },
                  h(
                    "span",
                    {
                      style: {
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "9px",
                        color: iconColor,
                        flexShrink: 0,
                      },
                    },
                    "\uD83D\uDCDE",
                  ),
                  d.phone
                    ? h(
                        "a",
                        {
                          href: "tel:" + d.phone.replace(/[^0-9]/g, ""),
                          style: {
                            fontFamily: "JetBrains Mono,monospace",
                            fontSize: "11px",
                            color: "var(--accent-green)",
                            textDecoration: "none",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          },
                        },
                        d.phone,
                      )
                    : h(
                        "span",
                        {
                          style: {
                            fontFamily: "JetBrains Mono,monospace",
                            fontSize: "10px",
                            color: "var(--body-faint)",
                            fontStyle: "italic",
                          },
                        },
                        "No phone",
                      ),
                ),

                // Email
                h(
                  "div",
                  { style: rowStyle },
                  h(
                    "span",
                    {
                      style: {
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "9px",
                        color: iconColor,
                        flexShrink: 0,
                      },
                    },
                    "\u2709",
                  ),
                  d.email
                    ? h(
                        "a",
                        {
                          href: "mailto:" + d.email,
                          title: d.email,
                          style: {
                            fontFamily: "JetBrains Mono,monospace",
                            fontSize: "11px",
                            color: "#7eb8f7",
                            textDecoration: "none",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            minWidth: 0,
                          },
                        },
                        d.email,
                      )
                    : h(
                        "span",
                        {
                          style: {
                            fontFamily: "JetBrains Mono,monospace",
                            fontSize: "10px",
                            color: "var(--body-faint)",
                            fontStyle: "italic",
                          },
                        },
                        "No email",
                      ),
                ),

                // Website
                h(
                  "div",
                  { style: rowStyle },
                  h(
                    "span",
                    {
                      style: {
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "9px",
                        color: iconColor,
                        flexShrink: 0,
                      },
                    },
                    "\uD83C\uDF10",
                  ),
                  d.website
                    ? h(
                        "a",
                        {
                          href: d.website.startsWith("http")
                            ? d.website
                            : "https://" + d.website,
                          target: "_blank",
                          rel: "noopener noreferrer",
                          title: d.website,
                          style: {
                            fontFamily: "JetBrains Mono,monospace",
                            fontSize: "11px",
                            color: "rgba(201,168,76,.8)",
                            textDecoration: "none",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            minWidth: 0,
                          },
                        },
                        (d.website || "")
                          .replace(/^https?:\/\//, "")
                          .replace(/\/$/, ""),
                      )
                    : h(
                        "span",
                        {
                          style: {
                            fontFamily: "JetBrains Mono,monospace",
                            fontSize: "10px",
                            color: "var(--body-faint)",
                            fontStyle: "italic",
                          },
                        },
                        "No website",
                      ),
                ),

                // Notes
                d.notes &&
                  h(
                    "div",
                    {
                      style: {
                        fontFamily: "Cormorant Garamond,serif",
                        fontStyle: "italic",
                        fontSize: "12px",
                        color: "var(--body-dim)",
                        lineHeight: 1.4,
                        borderTop: "1px solid rgba(201,168,76,.06)",
                        paddingTop: "6px",
                        marginTop: "2px",
                      },
                    },
                    d.notes,
                  ),
              ),

            // ════ EDIT MODE ════════════════════════════════════════════════
            isEditing &&
              h(
                "div",
                {
                  style: {
                    display: "flex",
                    flexDirection: "column",
                    gap: "7px",
                  },
                },

                // Phone
                h(
                  "div",
                  { style: rowStyle },
                  fieldLabel("Phone"),
                  h("input", {
                    value: draft.phone,
                    onChange: (e) => patchDraft(d.id, "phone", e.target.value),
                    placeholder: "(xxx) xxx-xxxx",
                    style: inputStyle,
                  }),
                ),

                // Email
                h(
                  "div",
                  { style: rowStyle },
                  fieldLabel("Email"),
                  h("input", {
                    value: draft.email,
                    onChange: (e) => patchDraft(d.id, "email", e.target.value),
                    placeholder: "rep@company.com",
                    style: inputStyle,
                  }),
                ),

                // Website
                h(
                  "div",
                  { style: rowStyle },
                  fieldLabel("Website"),
                  h("input", {
                    value: draft.website,
                    onChange: (e) =>
                      patchDraft(d.id, "website", e.target.value),
                    placeholder: "company.com",
                    style: inputStyle,
                  }),
                ),

                // FSC lanes
                h(
                  "div",
                  { style: rowStyle },
                  fieldLabel("FSC"),
                  h("input", {
                    value: draft.fsc,
                    onChange: (e) => patchDraft(d.id, "fsc", e.target.value),
                    placeholder: "4730, 4820, 4330",
                    title: "Comma-separated FSC codes",
                    style: inputStyle,
                  }),
                ),

                // Tags
                h(
                  "div",
                  { style: rowStyle },
                  fieldLabel("Tags"),
                  h("input", {
                    value: draft.tags,
                    onChange: (e) => patchDraft(d.id, "tags", e.target.value),
                    placeholder: "master-distributor, texas, fleet-pricing",
                    title: "Comma-separated tags",
                    style: inputStyle,
                  }),
                ),

                // Notes
                h(
                  "div",
                  {
                    style: {
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "6px",
                    },
                  },
                  fieldLabel("Notes"),
                  h("textarea", {
                    value: draft.notes,
                    onChange: (e) => patchDraft(d.id, "notes", e.target.value),
                    placeholder:
                      "Account rep, pricing tier, special instructions…",
                    rows: 2,
                    style: {
                      ...inputStyle,
                      resize: "vertical",
                      lineHeight: 1.5,
                      fontFamily: "Cormorant Garamond,serif",
                      fontSize: "12px",
                    },
                  }),
                ),

                // Hint
                h(
                  "div",
                  {
                    style: {
                      fontFamily: "JetBrains Mono,monospace",
                      fontSize: "9px",
                      color: "var(--body-faint)",
                      fontStyle: "italic",
                    },
                  },
                  "FSC + Tags: comma-separated. Saves merge into existing record.",
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
                gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))",
                gap: "10px",
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
