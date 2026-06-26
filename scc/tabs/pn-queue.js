(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — PN QUEUE
  //  Holds an entire RFQ blast batch when any GO sol is missing a part number.
  //  User drops the DLA solicitation PDF onto each held sol → PDF.js extracts
  //  P/N candidates → user confirms or types → or marks N/A.
  //  When every sol is resolved the batch releases and blasts.
  // ═══════════════════════════════════════════════════════════════════════

  const { createElement: h, useState, useCallback, useEffect, useRef } = React;

  // ── PDF PARSING ───────────────────────────────────────────────────────
  async function parsePDFText(file) {
    const lib = window.pdfjsLib;
    if (!lib) throw new Error("PDF.js not loaded");
    const buf = await file.arrayBuffer();
    const pdf = await lib.getDocument({ data: buf }).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page    = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(function (it) { return it.str; }).join(" ") + "\n";
    }
    return text;
  }

  function extractCandidates(text) {
    const seen = new Set();
    const add  = function (v) { v = v.trim(); if (v.length > 1 && v.length < 30) seen.add(v); };

    // Labeled fields — highest confidence
    var labeled = [
      /(?:Piece\s*Part\s*No\.?|Part\s*No\.?|Part\s*Number|P\/N|PN)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/\.]{1,24})/gi,
      /(?:Reference\s*(?:Part\s*)?(?:Number|No\.?))\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/\.]{1,24})/gi,
      /(?:Mfr\.?\s*Part|Manufacturer\s*Part\s*Number)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/\.]{1,24})/gi,
    ];
    for (var i = 0; i < labeled.length; i++) {
      var m;
      while ((m = labeled[i].exec(text)) !== null) add(m[1]);
    }

    // MIL-SPEC prefixes — AN, MS, NAS, AND
    var milspec = text.match(/\b((?:AN|MS|NAS|AND)\d[\w\-]{1,18})\b/gi) || [];
    milspec.forEach(function (p) { add(p); });

    return Array.from(seen).slice(0, 6);
  }

  // ── COMPONENT ─────────────────────────────────────────────────────────
  function PNQueuePanel({ queue, onRelease, onDismiss }) {
    // Stable session key — survives tab switches and parent re-renders
    var _sessionKey = "pnq:" + queue.records.map(function (r) { return r.sol_number; }).join(",");

    // items mirrors queue.records — adds UI-only fields
    // Restored from sessionStorage on remount so PDF drops survive tab switches
    const [items, setItems] = useState(function () {
      var saved = {};
      try {
        var raw = sessionStorage.getItem(_sessionKey);
        if (raw) {
          JSON.parse(raw).forEach(function (it) { saved[it.sol_number] = it; });
        }
      } catch (e) {}
      return queue.records.map(function (r) {
        var s = saved[r.sol_number] || {};
        return Object.assign({}, r, {
          _resolved:   s._resolved   !== undefined ? s._resolved : null,
          _input:      s._input      || "",
          _candidates: s._candidates || [],
          _parsing:    false,
          _pdfName:    s._pdfName    || null,
        });
      });
    });

    // Fetch P/N candidates from DIBBS for one sol
    const fetchDibbsPN = useCallback(function (solNum) {
      updateItem(solNum, { _parsing: true });
      fetch("/.netlify/functions/scc-dibbs-pn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sol_number: solNum }),
      }).then(function (r) { return r.json(); }).then(function (data) {
        if (!data.ok || !data.candidates || !data.candidates.length) {
          updateItem(solNum, { _parsing: false });
          return;
        }
        updateItem(solNum, { _parsing: false, _candidates: data.candidates, _pdfName: "(auto)" });
      }).catch(function () {
        updateItem(solNum, { _parsing: false });
      });
    }, [updateItem]);

    // Auto-fetch on mount for any item not yet resolved or enriched
    useEffect(function () {
      items.forEach(function (item) {
        if (item._resolved !== null || item._candidates.length || item._pdfName) return;
        fetchDibbsPN(item.sol_number);
      });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Persist items to sessionStorage whenever they change
    useEffect(function () {
      try {
        sessionStorage.setItem(_sessionKey, JSON.stringify(
          items.map(function (it) {
            return { sol_number: it.sol_number, _resolved: it._resolved, _input: it._input, _candidates: it._candidates, _pdfName: it._pdfName };
          })
        ));
      } catch (e) {}
    }, [items]);

    const updateItem = useCallback(function (solNum, patch) {
      setItems(function (prev) {
        return prev.map(function (it) {
          return it.sol_number === solNum ? Object.assign({}, it, patch) : it;
        });
      });
    }, []);

    const allResolved = items.every(function (it) { return it._resolved !== null; });
    const resolvedCount = items.filter(function (it) { return it._resolved !== null; }).length;

    const [dragOver, setDragOver] = useState({}); // solNum → bool

    // Shared PDF handler — called from drop, paste, or file input
    const handlePDFFile = useCallback(function (solNum, file) {
      if (!file || file.type !== "application/pdf") return;
      updateItem(solNum, { _parsing: true, _pdfName: file.name, _candidates: [] });
      parsePDFText(file).then(function (text) {
        var cands = extractCandidates(text);
        updateItem(solNum, { _parsing: false, _candidates: cands });
      }).catch(function () {
        updateItem(solNum, { _parsing: false });
      });
    }, [updateItem]);

    const handleDrop = useCallback(function (solNum, e) {
      e.preventDefault();
      setDragOver(function (p) { return Object.assign({}, p, { [solNum]: false }); });
      handlePDFFile(solNum, e.dataTransfer.files && e.dataTransfer.files[0]);
    }, [handlePDFFile]);

    const handlePaste = useCallback(function (solNum, e) {
      var cd = e.clipboardData;
      if (!cd) return;
      // Check files list first (copy from File Explorer)
      if (cd.files && cd.files.length) {
        for (var f = 0; f < cd.files.length; f++) {
          if (cd.files[f].type === "application/pdf") {
            e.preventDefault();
            handlePDFFile(solNum, cd.files[f]);
            return;
          }
        }
      }
      // Check items (browser clipboard API — PDF file)
      if (cd.items) {
        for (var i = 0; i < cd.items.length; i++) {
          if (cd.items[i].kind === "file") {
            var file = cd.items[i].getAsFile();
            if (file && file.type === "application/pdf") {
              e.preventDefault();
              handlePDFFile(solNum, file);
              return;
            }
          }
        }
      }
      // Fallback: plain text (user selected + copied DLA document text)
      var text = cd.getData("text/plain");
      if (text && text.trim().length > 20) {
        e.preventDefault();
        var cands = extractCandidates(text);
        updateItem(solNum, { _candidates: cands, _pdfName: "(pasted text)" });
      }
    }, [handlePDFFile, updateItem]);

    const fileInputRefs = useRef({});

    const handleFileInput = useCallback(function (solNum, e) {
      handlePDFFile(solNum, e.target.files && e.target.files[0]);
      e.target.value = "";
    }, [handlePDFFile]);

    const clearSession = useCallback(function () {
      try { sessionStorage.removeItem(_sessionKey); } catch (e) {}
    }, []);

    const handleRelease = useCallback(function () {
      if (!allResolved) return;
      var resolved = items.map(function (it) {
        var rec = Object.assign({}, it);
        if (it._resolved === "N/A") {
          rec.ref_part_number = "";
          rec._pn_na = true;
        } else {
          rec.ref_part_number = it._resolved;
          rec._pn_na = false;
        }
        delete rec._resolved;
        delete rec._input;
        delete rec._candidates;
        delete rec._parsing;
        delete rec._pdfName;
        return rec;
      });
      clearSession();
      onRelease(resolved, queue.opts || {});
    }, [allResolved, items, queue.opts, onRelease, clearSession]);

    // ── Styles ──
    var S = {
      mono: { fontFamily: "JetBrains Mono,monospace", fontSize: "11px" },
      btn: function (color, bg) {
        return {
          fontFamily: "Cinzel,serif", fontSize: "9px", letterSpacing: ".1em",
          textTransform: "uppercase", padding: "6px 14px",
          border: "1px solid " + color, background: bg || "transparent",
          color: color, cursor: "pointer", transition: "all .15s",
        };
      },
    };

    return h("div", {
      style: {
        background: "var(--card-bg)",
        border: "1px solid rgba(245,158,11,.35)",
        padding: "18px 20px",
        marginBottom: "14px",
      },
    },

      // ── Header ──
      h("div", { style: { display: "flex", alignItems: "center", gap: "14px", marginBottom: "14px", flexWrap: "wrap" } },
        h("div", { style: { fontFamily: "Cinzel,serif", fontSize: "11px", letterSpacing: ".14em", color: "rgba(245,158,11,.9)", textTransform: "uppercase" } },
          "⏸ PN Queue"),
        h("div", { style: { ...S.mono, fontSize: "10px", color: allResolved ? "var(--accent-green)" : "rgba(245,158,11,.8)" } },
          resolvedCount + " / " + items.length + " resolved" + (allResolved ? " — ready to blast" : "")),
        h("div", { style: { flex: 1 } }),
        h("button", {
          onClick: handleRelease,
          disabled: !allResolved,
          style: Object.assign({}, S.btn(
            allResolved ? "var(--accent-green)" : "var(--body-faint)",
            allResolved ? "rgba(61,214,140,.1)" : "transparent"
          ), { opacity: allResolved ? 1 : 0.4 }),
        }, "Release Batch →"),
        h("button", { onClick: function () { clearSession(); onDismiss(); }, style: S.btn("rgba(231,76,60,.5)") }, "✕ Discard"),
      ),

      // ── Held sols ──
      h("div", null,
        items.map(function (item) {
          var pending = item._resolved === null;
          var isNA    = item._resolved === "N/A";
          var hasPN   = item._resolved && item._resolved !== "N/A";

          return h("div", {
            key: item.sol_number,
            style: {
              borderTop: "1px solid rgba(201,168,76,.08)",
              padding: "12px 0",
              display: "grid",
              gridTemplateColumns: "1fr 130px",
              gap: "16px",
              alignItems: "start",
            },
          },

            // ── Left: item info + resolution controls ──
            h("div", null,

              // Sol # + item name + status badge
              h("div", { style: { display: "flex", gap: "10px", alignItems: "baseline", marginBottom: "6px", flexWrap: "wrap" } },
                h("span", { style: { ...S.mono, fontSize: "10px", color: "var(--gold-dim)" } }, item.sol_number),
                h("span", { style: { fontFamily: "Cormorant Garamond,serif", fontSize: "13px", color: "var(--alabaster)" } },
                  item.item_name || "—"),
                pending
                  ? h("span", { style: { ...S.mono, fontSize: "9px", color: "rgba(245,158,11,.85)", padding: "1px 6px", border: "1px solid rgba(245,158,11,.3)" } }, "⏸ pending")
                  : isNA
                    ? h("span", { style: { ...S.mono, fontSize: "9px", color: "var(--body-faint)", padding: "1px 6px", border: "1px solid rgba(255,255,255,.12)" } }, "N/A")
                    : h("span", { style: { ...S.mono, fontSize: "9px", color: "var(--accent-green)", padding: "1px 6px", border: "1px solid rgba(61,214,140,.3)" } },
                        "P/N: " + item._resolved),
              ),

              // Input row (only when pending)
              pending && h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginBottom: "6px" } },
                h("input", {
                  type: "text",
                  placeholder: "Type part number…",
                  value: item._input,
                  onChange: function (e) { updateItem(item.sol_number, { _input: e.target.value }); },
                  onKeyDown: function (e) {
                    if (e.key === "Enter" && item._input.trim()) {
                      updateItem(item.sol_number, { _resolved: item._input.trim() });
                    }
                  },
                  style: {
                    ...S.mono, fontSize: "11px",
                    background: "var(--inset-bg)",
                    border: "1px solid rgba(201,168,76,.25)",
                    color: "var(--alabaster)",
                    padding: "5px 10px", width: "190px", outline: "none",
                  },
                }),
                h("button", {
                  onClick: function () {
                    var v = item._input.trim();
                    if (v) updateItem(item.sol_number, { _resolved: v });
                  },
                  disabled: !item._input.trim(),
                  style: Object.assign({}, S.btn("var(--accent-green)", "rgba(61,214,140,.08)"), { opacity: item._input.trim() ? 1 : 0.4 }),
                }, "Confirm"),
                h("button", {
                  onClick: function () { updateItem(item.sol_number, { _resolved: "N/A", _input: "" }); },
                  style: S.btn("var(--body-dim)"),
                }, "N/A"),
                h("button", {
                  onClick: function () { fetchDibbsPN(item.sol_number); },
                  disabled: !!item._parsing,
                  style: Object.assign({}, S.btn("rgba(201,168,76,.5)"), { opacity: item._parsing ? 0.4 : 1 }),
                }, item._parsing ? "…" : "DIBBS"),
              ),

              // Change link (when resolved)
              !pending && h("button", {
                onClick: function () { updateItem(item.sol_number, { _resolved: null, _input: "", _candidates: [] }); },
                style: { ...S.mono, fontSize: "9px", background: "none", border: "none", color: "rgba(201,168,76,.45)", cursor: "pointer", padding: "2px 0" },
              }, "change"),

              // PDF candidates
              item._candidates.length > 0 && pending && h("div", {
                style: { display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center", marginTop: "4px" },
              },
                h("span", { style: { ...S.mono, fontSize: "9px", color: "var(--body-faint)" } }, "PDF found:"),
                item._candidates.map(function (c) {
                  return h("button", {
                    key: c,
                    onClick: function () { updateItem(item.sol_number, { _resolved: c, _input: c }); },
                    style: {
                      ...S.mono, fontSize: "9px",
                      background: "rgba(201,168,76,.07)",
                      border: "1px solid rgba(201,168,76,.3)",
                      color: "var(--gold-solid)",
                      padding: "2px 8px", cursor: "pointer",
                    },
                  }, c);
                }),
              ),
            ),

            // ── Right: PDF drop zone (drag + paste + click-to-browse) ──
            h("div", {
              onDragOver:  function (e) { e.preventDefault(); setDragOver(function (p) { return Object.assign({}, p, { [item.sol_number]: true }); }); },
              onDragLeave: function ()  { setDragOver(function (p) { return Object.assign({}, p, { [item.sol_number]: false }); }); },
              onDrop:      function (e) { handleDrop(item.sol_number, e); },
              onPaste:     function (e) { handlePaste(item.sol_number, e); },
              tabIndex:    0,
              style: {
                border: "1px dashed " + (
                  item._pdfName             ? "rgba(61,214,140,.55)" :
                  dragOver[item.sol_number] ? "rgba(201,168,76,.8)"  :
                  "rgba(201,168,76,.25)"
                ),
                minHeight: "64px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "8px",
                textAlign: "center",
                background: dragOver[item.sol_number]
                  ? "rgba(201,168,76,.07)"
                  : item._parsing
                    ? "rgba(201,168,76,.04)"
                    : "transparent",
                transition: "border-color .12s, background .12s",
                outline: "none",
              },
            },
              item._parsing
                ? h("span", { style: { ...S.mono, fontSize: "9px", color: "var(--gold-dim)" } }, "⟳ fetching…")
                : item._pdfName
                  ? h("span", { style: { ...S.mono, fontSize: "8px", color: "var(--accent-green)", wordBreak: "break-all" } },
                      "✓ " + (item._pdfName.length > 18 ? item._pdfName.slice(0, 18) + "…" : item._pdfName))
                  : [
                      h("span", { key: "arrow", style: { fontSize: "18px", color: "rgba(201,168,76,.3)", lineHeight: 1 } }, "⬇"),
                      h("span", { key: "label", style: { ...S.mono, fontSize: "8px", color: "var(--body-faint)", marginTop: "4px", lineHeight: 1.5 } },
                        "Drop PDF · paste text"),
                    ],
              // Browse button — separate from the focusable zone so paste still works
              !item._parsing && h("button", {
                key: "browse",
                onClick: function (e) {
                  e.stopPropagation();
                  fileInputRefs.current[item.sol_number] && fileInputRefs.current[item.sol_number].click();
                },
                style: {
                  marginTop: "5px", padding: "2px 8px",
                  fontFamily: "JetBrains Mono,monospace", fontSize: "8px",
                  background: "transparent", border: "1px solid rgba(201,168,76,.25)",
                  color: "var(--body-faint)", cursor: "pointer", borderRadius: "2px",
                },
              }, "browse…"),
              h("input", {
                key: "file-input",
                ref: function (el) { fileInputRefs.current[item.sol_number] = el; },
                type: "file",
                accept: ".pdf,application/pdf",
                onChange: function (e) { handleFileInput(item.sol_number, e); },
                style: { display: "none" },
              }),
            ),
          );
        })
      ),
    );
  }

  window.SCC_TABS      = window.SCC_TABS || {};
  window.SCC_TABS.PNQueuePanel = PNQueuePanel;
})();
