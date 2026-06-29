(function () {
  "use strict";
  const hA = window.React.createElement;
  const { useState, useEffect, useCallback } = window.React;

  const FN = "/.netlify/functions/scc-sba-import";

  // ── Styles ─────────────────────────────────────────────────────────────────
  const S = {
    wrap: {
      padding: "0",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      background: "var(--bg)",
    },
    header: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "14px 20px 12px",
      borderBottom: "1px solid var(--accent-warm)",
      background: "var(--panel-bg)",
      flexShrink: 0,
    },
    titleBlock: { display: "flex", alignItems: "center", gap: "10px" },
    title: {
      fontFamily: "Cinzel,serif",
      fontSize: "13px",
      letterSpacing: "0.1em",
      color: "var(--gold-solid)",
      margin: 0,
    },
    badge: {
      fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
      fontSize: "10px",
      padding: "2px 8px",
      borderRadius: "3px",
      background: "rgba(180,140,80,0.15)",
      border: "1px solid rgba(180,140,80,0.3)",
      color: "var(--gold-solid)",
    },
    body: {
      flex: 1,
      overflow: "auto",
      padding: "20px",
    },
    card: {
      background: "var(--panel-bg)",
      border: "1px solid var(--accent-warm)",
      borderRadius: "4px",
      padding: "20px",
      marginBottom: "16px",
      maxWidth: "640px",
    },
    cardTitle: {
      fontFamily: "Cinzel,serif",
      fontSize: "11px",
      letterSpacing: "0.08em",
      color: "var(--gold-solid)",
      marginBottom: "12px",
      opacity: 0.85,
    },
    hint: {
      fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
      fontSize: "10px",
      color: "var(--body-dim)",
      marginBottom: "14px",
      lineHeight: "1.6",
    },
    fileRow: {
      display: "flex",
      alignItems: "center",
      gap: "12px",
      marginBottom: "14px",
    },
    fileBtn: {
      fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
      fontSize: "11px",
      padding: "7px 14px",
      border: "1px solid var(--accent-warm)",
      background: "var(--panel-bg)",
      color: "var(--body-text)",
      borderRadius: "3px",
      cursor: "pointer",
    },
    fileInfo: {
      fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
      fontSize: "10px",
      color: "var(--body-dim)",
    },
    btnRow: { display: "flex", gap: "10px", marginTop: "4px" },
    btn: (variant) => ({
      fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
      fontSize: "11px",
      padding: "8px 18px",
      border: "none",
      borderRadius: "3px",
      cursor: "pointer",
      letterSpacing: "0.05em",
      background:
        variant === "gold"
          ? "linear-gradient(180deg,#c8a84b 0%,#a07830 100%)"
          : variant === "green"
          ? "linear-gradient(180deg,#2d6a2d 0%,#1a421a 100%)"
          : "transparent",
      color: variant === "ghost" ? "var(--body-dim)" : "#fff",
      border: variant === "ghost" ? "1px solid var(--accent-warm)" : "none",
      opacity: 1,
    }),
    statsGrid: {
      display: "grid",
      gridTemplateColumns: "auto 1fr",
      gap: "4px 16px",
      fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
      fontSize: "11px",
      lineHeight: "1.8",
    },
    statLabel: { color: "var(--body-dim)", textAlign: "right" },
    statVal: (color) => ({
      color: color || "var(--body-text)",
      fontWeight: "bold",
    }),
    divider: {
      gridColumn: "1 / -1",
      borderTop: "1px solid var(--accent-warm)",
      margin: "4px 0",
    },
    resultBanner: (ok) => ({
      fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
      fontSize: "11px",
      padding: "12px 16px",
      borderRadius: "3px",
      border: `1px solid ${ok ? "rgba(80,180,80,0.4)" : "rgba(180,80,80,0.4)"}`,
      background: ok ? "rgba(40,100,40,0.15)" : "rgba(100,40,40,0.15)",
      color: ok ? "#8ecf8e" : "#cf8e8e",
      marginTop: "12px",
    }),
    errorText: {
      fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
      fontSize: "10px",
      color: "#cf8e8e",
      marginTop: "8px",
    },
  };

  // ── FileReader helper ──────────────────────────────────────────────────────
  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  // ── Count CSV data rows (skips header) ────────────────────────────────────
  function countDataRows(text) {
    const lines = text.replace(/\r\n/g, "\n").split("\n").filter(l => l.trim());
    return Math.max(0, lines.length - 1);
  }

  // ── SbaImportTab ──────────────────────────────────────────────────────────
  function SbaImportTab() {
    const [currentCount, setCurrentCount]   = useState(null);
    const [csvText, setCsvText]             = useState(null);
    const [fileName, setFileName]           = useState(null);
    const [rowCount, setRowCount]           = useState(0);
    const [preview, setPreview]             = useState(null);
    const [importResult, setImportResult]   = useState(null);
    const [loading, setLoading]             = useState(null); // "preview" | "import" | null
    const [error, setError]                 = useState(null);

    // Load current DB count on mount
    useEffect(() => {
      fetch(FN, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getStatus" }),
      })
        .then(r => r.json())
        .then(d => { if (d.ok) setCurrentCount(d.result.count); })
        .catch(() => {});
    }, []);

    const handleFileChange = useCallback(async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await readFile(file);
      setCsvText(text);
      setFileName(file.name);
      setRowCount(countDataRows(text));
      setPreview(null);
      setImportResult(null);
      setError(null);
    }, []);

    const handlePreview = useCallback(async () => {
      if (!csvText) return;
      setLoading("preview");
      setError(null);
      setPreview(null);
      setImportResult(null);
      try {
        const res = await fetch(FN, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "preview", csv: csvText }),
        });
        const data = await res.json();
        if (data.ok) setPreview(data.result);
        else setError(data.error || "Preview failed");
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(null);
      }
    }, [csvText]);

    const handleImport = useCallback(async () => {
      if (!csvText || !preview) return;
      setLoading("import");
      setError(null);
      try {
        const res = await fetch(FN, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "import", csv: csvText }),
        });
        const data = await res.json();
        if (data.ok) {
          setImportResult(data.result);
          setCurrentCount(data.result.final_count);
          setPreview(null);
          setCsvText(null);
          setFileName(null);
          setRowCount(0);
        } else {
          setError(data.error || "Import failed");
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(null);
      }
    }, [csvText, preview]);

    // ── Render ──────────────────────────────────────────────────────────────
    return hA("div", { style: S.wrap },

      // Header
      hA("div", { style: S.header },
        hA("div", { style: S.titleBlock },
          hA("h2", { style: S.title }, "SBA DSBS VENDOR IMPORT"),
          currentCount !== null && hA("span", { style: S.badge }, `DB: ${currentCount.toLocaleString()} vendors`),
        ),
      ),

      hA("div", { style: S.body },

        // Instructions card
        hA("div", { style: S.card },
          hA("div", { style: S.cardTitle }, "HOW TO EXPORT"),
          hA("div", { style: S.hint },
            "1. Go to search.certifications.sba.gov/advanced",     hA("br", null),
            "2. Filter: Certification → Authorized Distributor of Original Manufacturers", hA("br", null),
            "3. Optionally add NAICS keyword (e.g. 423690, 423620)", hA("br", null),
            "4. Click Export → Download CSV",                       hA("br", null),
            "5. Upload the CSV below — NAICS codes auto-map to FSC lanes",
          ),
        ),

        // Upload card
        hA("div", { style: S.card },
          hA("div", { style: S.cardTitle }, "SELECT CSV FILE"),

          hA("div", { style: S.fileRow },
            hA("label", { style: S.fileBtn },
              "📄 Browse CSV",
              hA("input", {
                type: "file",
                accept: ".csv,text/csv",
                style: { display: "none" },
                onChange: handleFileChange,
              }),
            ),
            fileName
              ? hA("span", { style: S.fileInfo }, `${fileName}  ·  ${rowCount.toLocaleString()} data rows`)
              : hA("span", { style: S.fileInfo }, "No file selected"),
          ),

          csvText && hA("div", { style: S.btnRow },
            hA("button", {
              style: { ...S.btn("gold"), opacity: loading ? 0.6 : 1 },
              disabled: !!loading,
              onClick: handlePreview,
            }, loading === "preview" ? "Analyzing…" : "Preview Import"),
          ),

          error && hA("div", { style: S.errorText }, "Error: " + error),
        ),

        // Preview results card
        preview && hA("div", { style: S.card },
          hA("div", { style: S.cardTitle }, "PREVIEW RESULTS"),

          hA("div", { style: S.statsGrid },
            hA("span", { style: S.statLabel }, "Total rows"),
            hA("span", { style: S.statVal() }, preview.total_rows.toLocaleString()),

            hA("span", { style: S.statLabel }, "Parsed OK"),
            hA("span", { style: S.statVal() }, preview.parsed.toLocaleString()),

            hA("span", { style: S.statLabel }, "No DIBBS FSC match"),
            hA("span", { style: S.statVal("var(--body-dim)") }, preview.no_fsc.toLocaleString()),

            hA("span", { style: S.statLabel }, "Hidden contact"),
            hA("span", { style: S.statVal("var(--body-dim)") }, preview.no_contact.toLocaleString()),

            hA("span", { style: S.statLabel }, "Duplicate UEI"),
            hA("span", { style: S.statVal("var(--body-dim)") }, preview.dup_uei.toLocaleString()),

            hA("span", { style: S.statLabel }, "Duplicate CAGE"),
            hA("span", { style: S.statVal("var(--body-dim)") }, preview.dup_cage.toLocaleString()),

            hA("div", { style: S.divider }),

            hA("span", { style: S.statLabel }, "New vendors"),
            hA("span", { style: { ...S.statVal("#8ecf8e"), fontSize: "13px" } },
              preview.new_vendors.toLocaleString() + " ✓"
            ),
          ),

          preview.new_vendors > 0
            ? hA("div", { style: S.btnRow },
                hA("button", {
                  style: { ...S.btn("green"), marginTop: "14px", opacity: loading ? 0.6 : 1 },
                  disabled: !!loading,
                  onClick: handleImport,
                }, loading === "import"
                    ? "Importing…"
                    : `Import ${preview.new_vendors.toLocaleString()} Vendors`
                ),
              )
            : hA("div", { style: { ...S.resultBanner(false), marginTop: "12px" } },
                "Nothing new to import — all vendors already in DB or no DIBBS FSC match."
              ),
        ),

        // Import success card
        importResult && hA("div", { style: S.card },
          hA("div", { style: S.cardTitle }, "IMPORT COMPLETE"),
          hA("div", { style: S.resultBanner(true) },
            `Imported ${importResult.inserted.toLocaleString()} vendors. ` +
            `DB: ${(importResult.final_count - importResult.inserted).toLocaleString()} → ${importResult.final_count.toLocaleString()}`
          ),
          importResult.errors && importResult.errors.length > 0 &&
            hA("div", { style: S.errorText }, importResult.errors.join(" | ")),

          hA("div", { style: { ...S.statsGrid, marginTop: "14px" } },
            hA("span", { style: S.statLabel }, "Skipped — no FSC"),
            hA("span", { style: S.statVal("var(--body-dim)") }, importResult.no_fsc.toLocaleString()),
            hA("span", { style: S.statLabel }, "Skipped — hidden"),
            hA("span", { style: S.statVal("var(--body-dim)") }, importResult.no_contact.toLocaleString()),
            hA("span", { style: S.statLabel }, "Skipped — dup UEI"),
            hA("span", { style: S.statVal("var(--body-dim)") }, importResult.dup_uei.toLocaleString()),
            hA("span", { style: S.statLabel }, "Skipped — dup CAGE"),
            hA("span", { style: S.statVal("var(--body-dim)") }, importResult.dup_cage.toLocaleString()),
          ),

          hA("button", {
            style: { ...S.btn("ghost"), marginTop: "16px" },
            onClick: () => setImportResult(null),
          }, "Import Another File"),
        ),

      ), // end body
    );
  }

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.SbaImportTab = SbaImportTab;
})();
