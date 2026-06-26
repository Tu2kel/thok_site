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
    // Restored from localStorage on remount so PDF drops survive tab switches
    const [items, setItems] = useState(function () {
      var saved = {};
      try {
        var raw = localStorage.getItem(_sessionKey);
        if (raw) {
          JSON.parse(raw).forEach(function (it) { saved[it.sol_number] = it; });
        }
      } catch (e) {}
      return queue.records.map(function (r) {
        var s = saved[r.sol_number] || {};
        return Object.assign({}, r, {
          _resolved:   s._resolved   !== undefined ? s._resolved : null,
          _pns:        s._pns        || [],
          _input:      s._input      || "",
          _candidates: s._candidates || [],
          _parsing:    false,
          _pdfName:    s._pdfName    || null,
          _removed:    s._removed    || false,
        });
      });
    });

    // {solNum: bool} — whether the "+ Add P/N" input is open for a resolved item
    const [addingMore, setAddingMore] = useState({});
    // {solNum: bool} — whether DIBBS auto-lookup is in flight
    const [lookingUp, setLookingUp] = useState({});

    const updateItem = useCallback(function (solNum, patch) {
      setItems(function (prev) {
        return prev.map(function (it) {
          return it.sol_number === solNum ? Object.assign({}, it, patch) : it;
        });
      });
    }, []);

    // Add a P/N to a sol's confirmed list; closes addingMore mode
    const confirmPN = useCallback(function (solNum, pn) {
      pn = pn.trim();
      if (!pn) return;
      setItems(function (prev) {
        return prev.map(function (it) {
          if (it.sol_number !== solNum) return it;
          var newPns = it._pns.includes(pn) ? it._pns : it._pns.concat([pn]);
          return Object.assign({}, it, { _pns: newPns, _resolved: newPns.join(" / "), _input: "" });
        });
      });
      setAddingMore(function (p) { return Object.assign({}, p, { [solNum]: false }); });
    }, []);

    // Remove one P/N from the confirmed list; resets to pending if list empties
    const removePN = useCallback(function (solNum, pn) {
      setItems(function (prev) {
        return prev.map(function (it) {
          if (it.sol_number !== solNum) return it;
          var newPns = it._pns.filter(function (p) { return p !== pn; });
          return Object.assign({}, it, { _pns: newPns, _resolved: newPns.length ? newPns.join(" / ") : null });
        });
      });
    }, []);

    // Persist items to localStorage whenever they change
    const [lastSaved, setLastSaved] = useState(null);
    useEffect(function () {
      try {
        localStorage.setItem(_sessionKey, JSON.stringify(
          items.map(function (it) {
            return { sol_number: it.sol_number, _resolved: it._resolved, _pns: it._pns, _input: it._input, _candidates: it._candidates, _pdfName: it._pdfName, _removed: it._removed };
          })
        ));
        setLastSaved(new Date().toLocaleTimeString());
      } catch (e) {}
    }, [items]);

    const activeItems   = items.filter(function (it) { return !it._removed; });
    const allResolved   = activeItems.every(function (it) { return it._resolved !== null; });
    const resolvedCount = activeItems.filter(function (it) { return it._resolved !== null; }).length;

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
      try { localStorage.removeItem(_sessionKey); } catch (e) {}
    }, []);

    function buildReleasePayload(sourceItems) {
      return sourceItems.map(function (it) {
        var rec = Object.assign({}, it);
        if (!it._resolved || it._resolved === "N/A") {
          rec.ref_part_number = "";
          rec._pn_na = true;
        } else {
          rec.ref_part_number = it._resolved;
          rec._pn_na = false;
        }
        delete rec._resolved;
        delete rec._pns;
        delete rec._input;
        delete rec._candidates;
        delete rec._parsing;
        delete rec._pdfName;
        delete rec._removed;
        return rec;
      });
    }

    const handleRelease = useCallback(function () {
      if (!allResolved) return;
      clearSession();
      onRelease(buildReleasePayload(activeItems), queue.opts || {});
    }, [allResolved, activeItems, queue.opts, onRelease, clearSession]);

    const handleReleaseAnyway = useCallback(function () {
      var withPN    = activeItems.filter(function (it) { return it._resolved && it._resolved !== "N/A"; });
      var skipped   = activeItems.filter(function (it) { return !it._resolved || it._resolved === "N/A"; }).length;
      if (!withPN.length) { alert("No items have a confirmed P/N — nothing to release."); return; }
      if (!window.confirm("Release " + withPN.length + " item(s) with confirmed P/Ns?\n\n" + skipped + " item(s) without P/Ns will be dropped from this blast.")) return;
      clearSession();
      onRelease(buildReleasePayload(withPN), queue.opts || {});
    }, [activeItems, queue.opts, onRelease, clearSession]);

    const lookupPN = useCallback(function (solNum, nsn) {
      if (!nsn) return;
      setLookingUp(function (p) { return Object.assign({}, p, { [solNum]: true }); });
      fetch("/.netlify/functions/lookup-pn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nsn: nsn.replace(/\D/g, "") }),
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          setLookingUp(function (p) { return Object.assign({}, p, { [solNum]: false }); });
          if (data.ok && data.partNumbers && data.partNumbers.length) {
            if (data.partNumbers.length === 1) {
              confirmPN(solNum, data.partNumbers[0]);
            } else {
              updateItem(solNum, { _candidates: data.partNumbers, _pdfName: "(auto)" });
            }
          } else {
            updateItem(solNum, { _candidates: ["(none found)"], _pdfName: "(auto)" });
          }
        })
        .catch(function () {
          setLookingUp(function (p) { return Object.assign({}, p, { [solNum]: false }); });
        });
    }, [confirmPN, updateItem]);

    const handleLookupAll = useCallback(function () {
      var pending = items.filter(function (it) { return !it._removed && it._resolved === null && it.nsn; });
      if (!pending.length) return;
      pending.forEach(function (it, i) {
        setTimeout(function () { lookupPN(it.sol_number, it.nsn); }, i * 800);
      });
    }, [items, lookupPN]);

    const [bulkOpen, setBulkOpen] = useState(false);
    const [bulkText, setBulkText] = useState("");

    const handleBulkFill = useCallback(function () {
      var lines = bulkText.split(/\n/).map(function (l) { return l.trim(); }).filter(Boolean);
      var filled = 0;
      lines.forEach(function (line) {
        // Accept: "SOL_NUM: PN", "SOL_NUM PN", "SOL_NUM=PN", or just "PN" (matched by position)
        var m = line.match(/^([A-Z0-9]+)\s*[:=\s]\s*(.+)$/i);
        if (!m) return;
        var sol = m[1].trim().toUpperCase();
        var pn  = m[2].trim();
        var match = items.find(function (it) { return it.sol_number.toUpperCase() === sol; });
        if (!match) return;
        var newPns = pn.toUpperCase() === "N/A" ? [] : [pn];
        var resolved = pn.toUpperCase() === "N/A" ? "N/A" : pn;
        updateItem(match.sol_number, { _pns: newPns, _resolved: resolved, _input: pn.toUpperCase() === "N/A" ? "" : pn });
        filled++;
      });
      setBulkText("");
      setBulkOpen(false);
      if (filled === 0) alert("No sol numbers matched. Format: SPE7M326T7015: 52833-941-12");
    }, [bulkText, items, updateItem]);

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
          resolvedCount + " / " + activeItems.length + " resolved" +
          (items.length > activeItems.length ? " (" + (items.length - activeItems.length) + " removed)" : "") +
          (allResolved ? " — ready to blast" : "")),
        lastSaved && h("div", { style: { ...S.mono, fontSize: "9px", color: "rgba(61,214,140,.5)" } }, "✓ saved " + lastSaved),
        h("div", { style: { flex: 1 } }),
        h("button", {
          onClick: handleRelease,
          disabled: !allResolved,
          style: Object.assign({}, S.btn(
            allResolved ? "var(--accent-green)" : "var(--body-faint)",
            allResolved ? "rgba(61,214,140,.1)" : "transparent"
          ), { opacity: allResolved ? 1 : 0.4 }),
        }, "Release Batch →"),
        !allResolved && h("button", {
          onClick: handleReleaseAnyway,
          style: S.btn("rgba(245,158,11,.8)", "rgba(245,158,11,.08)"),
        }, "Release P/N Only →"),
        h("button", {
          onClick: handleLookupAll,
          title: "Auto-lookup P/Ns from DIBBS for all pending items",
          style: S.btn("rgba(96,165,250,.7)", "rgba(96,165,250,.06)"),
        }, "🔍 Lookup All"),
        h("button", {
          onClick: function () { setBulkOpen(function (v) { return !v; }); },
          style: S.btn("rgba(201,168,76,.5)"),
        }, bulkOpen ? "✕ Close" : "⚡ Bulk Fill"),
        h("button", {
          onClick: function () {
            if (!window.confirm("Discard the entire PN Queue?\n\nAll part numbers you've entered will be lost and the batch will be cancelled.")) return;
            clearSession();
            onDismiss();
          },
          style: S.btn("rgba(231,76,60,.5)"),
        }, "✕ Discard"),
      ),

      // ── Bulk fill strip ──
      bulkOpen && h("div", { style: { marginBottom: "14px", padding: "12px 14px", background: "rgba(201,168,76,.05)", border: "1px solid rgba(201,168,76,.2)" } },
        h("div", { style: { ...S.mono, fontSize: "9px", color: "var(--body-faint)", marginBottom: "6px" } },
          "One line per sol — format: SOL_NUMBER: PART_NUMBER  (or N/A)"),
        h("div", { style: { display: "flex", gap: "8px", alignItems: "flex-start" } },
          h("textarea", {
            value: bulkText,
            onChange: function (e) { setBulkText(e.target.value); },
            placeholder: items.map(function (it) { return it.sol_number + ": "; }).join("\n"),
            rows: Math.min(items.length, 12),
            style: {
              flex: 1, ...S.mono, fontSize: "10px",
              background: "var(--inset-bg)", color: "var(--alabaster)",
              border: "1px solid rgba(201,168,76,.25)", padding: "8px 10px",
              resize: "vertical", outline: "none", lineHeight: 1.7,
            },
          }),
          h("button", {
            onClick: handleBulkFill,
            disabled: !bulkText.trim(),
            style: Object.assign({}, S.btn("var(--accent-green)", "rgba(61,214,140,.08)"), { opacity: bulkText.trim() ? 1 : 0.4, alignSelf: "stretch" }),
          }, "Apply"),
        ),
      ),

      // ── Held sols ──
      h("div", null,
        items.map(function (item) {
          var pending    = item._resolved === null;
          var isNA       = item._resolved === "N/A";
          var hasPNs     = item._pns && item._pns.length > 0;
          var showInput  = (pending || addingMore[item.sol_number]) && !item._removed;

          return h("div", {
            key: item.sol_number,
            style: {
              borderTop: "1px solid rgba(201,168,76,.08)",
              padding: "12px 0",
              display: "grid",
              gridTemplateColumns: "1fr 130px",
              gap: "16px",
              alignItems: "start",
              opacity: item._removed ? 0.35 : 1,
            },
          },

            // ── Left: item info + resolution controls ──
            h("div", null,

              // Sol # + item name + status badge
              h("div", { style: { display: "flex", gap: "10px", alignItems: "baseline", marginBottom: "6px", flexWrap: "wrap" } },
                h("span", { style: { ...S.mono, fontSize: "10px", color: "var(--gold-dim)" } }, item.sol_number),
                h("span", { style: { fontFamily: "Cormorant Garamond,serif", fontSize: "13px", color: item._removed ? "var(--body-faint)" : "var(--alabaster)" } },
                  item.item_name || "—"),
                item._removed
                  ? h("span", { style: { ...S.mono, fontSize: "9px", color: "rgba(231,76,60,.6)", padding: "1px 6px", border: "1px solid rgba(231,76,60,.25)" } }, "removed")
                  : pending
                  ? h("span", { style: { ...S.mono, fontSize: "9px", color: "rgba(245,158,11,.85)", padding: "1px 6px", border: "1px solid rgba(245,158,11,.3)" } }, "⏸ pending")
                  : isNA
                    ? h("span", { style: { ...S.mono, fontSize: "9px", color: "var(--body-faint)", padding: "1px 6px", border: "1px solid rgba(255,255,255,.12)" } }, "N/A")
                    : null,
              ),

              // Confirmed P/N tags (shown when resolved with actual P/Ns)
              hasPNs && !item._removed && h("div", {
                style: { display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center", marginBottom: "6px" },
              },
                item._pns.map(function (pn) {
                  return h("span", {
                    key: pn,
                    style: {
                      ...S.mono, fontSize: "10px",
                      background: "rgba(61,214,140,.1)",
                      border: "1px solid rgba(61,214,140,.4)",
                      color: "var(--accent-green)",
                      padding: "2px 8px",
                      display: "inline-flex", alignItems: "center", gap: "5px",
                    },
                  },
                    pn,
                    h("button", {
                      onClick: function () { removePN(item.sol_number, pn); },
                      title: "Remove this P/N",
                      style: {
                        background: "none", border: "none",
                        color: "rgba(61,214,140,.6)", cursor: "pointer",
                        fontFamily: "monospace", fontSize: "11px", padding: "0 1px", lineHeight: 1,
                      },
                    }, "×"),
                  );
                }),
                // + Add P/N button (shown when not already in add-more mode)
                !addingMore[item.sol_number] && h("button", {
                  onClick: function () { setAddingMore(function (p) { return Object.assign({}, p, { [item.sol_number]: true }); }); },
                  style: Object.assign({}, S.btn("rgba(201,168,76,.5)"), { padding: "3px 10px" }),
                }, "+ Add P/N"),
              ),

              // Input row (pending or adding more, not removed)
              showInput && h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginBottom: "6px" } },
                h("input", {
                  type: "text",
                  placeholder: "Type part number…",
                  value: item._input,
                  onChange: function (e) { updateItem(item.sol_number, { _input: e.target.value }); },
                  onKeyDown: function (e) {
                    if (e.key === "Enter" && item._input.trim()) {
                      confirmPN(item.sol_number, item._input);
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
                  onClick: function () { confirmPN(item.sol_number, item._input); },
                  disabled: !item._input.trim(),
                  style: Object.assign({}, S.btn("var(--accent-green)", "rgba(61,214,140,.08)"), { opacity: item._input.trim() ? 1 : 0.4 }),
                }, "Confirm"),
                // N/A and Remove only shown when pending (not in add-more mode)
                pending && h("button", {
                  onClick: function () { updateItem(item.sol_number, { _resolved: "N/A", _input: "", _pns: [] }); },
                  style: S.btn("var(--body-dim)"),
                }, "N/A"),
                item.nsn && pending && h("button", {
                  onClick: function () { lookupPN(item.sol_number, item.nsn); },
                  disabled: !!lookingUp[item.sol_number],
                  title: "Auto-lookup P/N from DIBBS approved sources",
                  style: Object.assign({}, S.btn("rgba(96,165,250,.7)", "rgba(96,165,250,.08)"), { opacity: lookingUp[item.sol_number] ? 0.5 : 1 }),
                }, lookingUp[item.sol_number] ? "…" : "🔍 AUTO"),
                item.nsn && pending && h("button", {
                  onClick: function () {
                    window.open("https://www.dibbs.bsm.dla.mil/RFQ/RFQNsn.aspx?value=" + item.nsn.replace(/\D/g,"") + "&category=&Scope=", "_blank");
                  },
                  style: S.btn("rgba(201,168,76,.5)"),
                }, "DIBBS ↗"),
                pending && h("button", {
                  onClick: function () { updateItem(item.sol_number, { _removed: true, _resolved: null, _pns: [] }); },
                  style: S.btn("rgba(231,76,60,.5)"),
                }, "✕ Remove"),
                // Cancel for add-more mode
                addingMore[item.sol_number] && h("button", {
                  onClick: function () { setAddingMore(function (p) { return Object.assign({}, p, { [item.sol_number]: false }); }); },
                  style: { ...S.mono, fontSize: "9px", background: "none", border: "none", color: "var(--body-faint)", cursor: "pointer" },
                }, "cancel"),
              ),

              // Change / undo links
              item._removed
                ? h("button", {
                    onClick: function () { updateItem(item.sol_number, { _removed: false }); },
                    style: { ...S.mono, fontSize: "9px", background: "none", border: "none", color: "rgba(201,168,76,.45)", cursor: "pointer", padding: "2px 0" },
                  }, "undo")
                : isNA && h("button", {
                    onClick: function () { updateItem(item.sol_number, { _resolved: null, _input: "", _candidates: [], _pns: [] }); },
                    style: { ...S.mono, fontSize: "9px", background: "none", border: "none", color: "rgba(201,168,76,.45)", cursor: "pointer", padding: "2px 0" },
                  }, "change"),

              // PDF / DIBBS candidates — click a chip to confirm (or add to list)
              item._candidates.length > 0 && (pending || addingMore[item.sol_number]) && h("div", {
                style: { display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center", marginTop: "4px" },
              },
                h("span", { style: { ...S.mono, fontSize: "9px", color: "var(--body-faint)" } },
                  (item._pdfName === "(auto)" ? "DIBBS" : "PDF") + " — click to confirm:"),
                item._candidates.map(function (c) {
                  var alreadyAdded = item._pns && item._pns.includes(c);
                  return h("button", {
                    key: c,
                    onClick: function () { if (!alreadyAdded) confirmPN(item.sol_number, c); },
                    title: alreadyAdded ? "Already added" : "Click to confirm this as the part number",
                    style: {
                      ...S.mono, fontSize: "10px",
                      background: alreadyAdded ? "rgba(61,214,140,.08)" : "rgba(201,168,76,.12)",
                      border: "1px solid " + (alreadyAdded ? "rgba(61,214,140,.3)" : "rgba(201,168,76,.5)"),
                      color: alreadyAdded ? "rgba(61,214,140,.5)" : "var(--gold-solid)",
                      padding: "3px 10px", cursor: alreadyAdded ? "default" : "pointer",
                      fontWeight: "bold",
                      textDecoration: alreadyAdded ? "line-through" : "none",
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
