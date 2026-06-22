(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — OUTREACH COMMAND
  //  Daily call list + email queue from pipeline approved sources.
  //  Pre-compiled React · No Babel · No JSX
  //  Exports: window.SCC_TABS.CallListTab
  // ═══════════════════════════════════════════════════════════════════════

  const {
    createElement: h,
    useState,
    useEffect,
    useCallback,
    Fragment,
  } = React;

  const DIBBS_TTL  = 24 * 60 * 60 * 1000; // 24h cache for DIBBS approved sources

  // ── Colour tokens (match app palette) ───────────────────────────────
  const C = {
    gold:    "#c9a84c",
    alabaster: "#f5f0e8",
    dim:     "rgba(245,240,232,.45)",
    dimmer:  "rgba(245,240,232,.2)",
    surface: "rgba(245,240,232,.03)",
    border:  "rgba(245,240,232,.08)",
    green:   "#3dd68c",
    amber:   "#f59e0b",
    red:     "#e87474",
    blue:    "#7eb8f7",
    bg:      "#141414",
  };

  // ── Helpers ─────────────────────────────────────────────────────────
  function fmt$(n) {
    if (!n) return "—";
    return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtDate(d) {
    if (!d) return "—";
    const s = String(d);
    if (s.includes("/")) return s;
    // ISO
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[2] + "/" + m[3] + "/" + m[1].slice(2) : s.slice(0, 10);
  }

  function samLink(cage) {
    return "https://sam.gov/search/?index=ed&page=1&pageSize=10&sort=-modifiedDate&sfm%5BsimpleSearch%5D%5BkeywordTerm%5D=" + encodeURIComponent(cage);
  }

  // ── DIBBS data fetch + 24h cache ─────────────────────────────────────
  async function getDIBBSData(nsn) {
    if (!nsn) return null;
    const key = "scc_dibbs_" + nsn.replace(/-/g, "");
    try {
      const cached = JSON.parse(localStorage.getItem(key) || "null");
      if (cached && Date.now() - cached.ts < DIBBS_TTL) return cached.data;
    } catch (_) {}
    const fn = window.SCC_TABS && window.SCC_TABS.fetchDIBBSData;
    if (!fn) return null;
    const data = await fn(nsn);
    if (data) {
      try { localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() })); } catch (_) {}
    }
    return data;
  }

  // ── Contact lookup (batch) ───────────────────────────────────────────
  async function batchContacts(cages) {
    if (!cages.length) return {};
    const res = await fetch("/.netlify/functions/contact-strategy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cages }),
    });
    if (!res.ok) return {};
    const { contacts } = await res.json();
    return contacts || {};
  }

  // ── Build the master outreach list from pipeline rows ────────────────
  // Returns: [ { cage, companyName, partNumber, contact, sols: [ rowContext ] } ]
  async function buildOutreachList(rows) {
    const actionable = rows.filter(
      (r) => r.nsn && !["Closed", "No Source", "Archive", "Awarded"].includes(r.status)
    );

    // Accumulate CAGE → { companyName, partNumber, sols[] }
    // Primary: approved_sources already on the pipeline row (from Navigator supplier_list)
    // Fallback: DIBBS NSN API (async, only for rows with no sources yet)
    const cageMap = {};

    function addSourcesToMap(row, sources, itemName) {
      for (const src of sources) {
        const cage = (src.cage || "").toUpperCase().trim();
        if (!cage) continue;
        if (!cageMap[cage]) {
          cageMap[cage] = {
            cage,
            companyName: src.companyName || src.name || "",
            partNumber:  src.partNumber  || src.pn   || "",
            sols: [],
          };
        }
        if (!cageMap[cage].sols.find((s) => s.sol_number === row.sol_number)) {
          cageMap[cage].sols.push({
            sol_number: row.sol_number,
            nsn:        row.nsn,
            itemName:   itemName || row.item_name || "",
            qty:        row.qty || row.quantity || "",
            price:      row.unit_price || row.price || "",
            quoteDue:   row.quote_due || "",
            partNumber: src.partNumber || src.pn || "",
          });
        }
      }
    }

    // Pass 1 — use Navigator approved_sources already on the record
    const needsDIBBS = [];
    for (const row of actionable) {
      const sources = row.approved_sources || [];
      if (sources.length) {
        addSourcesToMap(row, sources, row.item_name);
      } else {
        needsDIBBS.push(row); // no inline sources — try DIBBS API fallback
      }
    }

    // Pass 2 — DIBBS API fallback only for rows missing sources (capped to avoid timeout)
    if (needsDIBBS.length) {
      const nsnSet = [...new Set(needsDIBBS.map((r) => r.nsn).filter(Boolean))].slice(0, 30);
      const dibbsMap = {};
      await Promise.all(
        nsnSet.map((nsn, i) =>
          new Promise((res) =>
            setTimeout(() => getDIBBSData(nsn).then((d) => { dibbsMap[nsn] = d; res(); }).catch(() => res()), i * 120)
          )
        )
      );
      for (const row of needsDIBBS) {
        const dibbs = dibbsMap[row.nsn];
        if (dibbs && dibbs.approvedSources && dibbs.approvedSources.length) {
          addSourcesToMap(row, dibbs.approvedSources, dibbs.nomenclature || row.item_name);
        }
      }
    }

    const allCages = Object.keys(cageMap);
    if (!allCages.length) return [];

    // Batch contact lookup
    const contacts = await batchContacts(allCages);

    // Merge
    return allCages.map((cage) => ({
      ...cageMap[cage],
      contact: contacts[cage] || { cage, strategy: "lookup", phone: "", email: "", companyName: "" },
    }));
  }

  // ── Call script generator ────────────────────────────────────────────
  function makeScript(vendor) {
    const sol = vendor.sols[0] || {};
    const pn = vendor.partNumber || sol.partNumber || "on file";
    const nsn = sol.nsn ? sol.nsn.replace(/(\d{4})(\d{2})(\d{3})(\d{4})/, "$1-$2-$3-$4") : "";
    const item = sol.itemName || "part";
    const qty  = sol.qty  ? sol.qty + " EA"  : "quantity TBD";
    const price = sol.price ? fmt$(sol.price) + " ea" : "gov price TBD";
    const due  = sol.quoteDue ? fmtDate(sol.quoteDue) : "TBD";

    return [
      "Hi, this is Anthony Kelley from Imperio Federal Logistics — we're an SDVOSB prime.",
      "",
      "I'm calling about part number " + pn + (nsn ? " (NSN " + nsn + ", " + item + ")" : " (" + item + ")") + ".",
      "DLA has an active solicitation — " + qty + " needed, gov price " + price + ", quote due " + due + ".",
      "",
      "Can you confirm availability and pricing for drop-ship to a government delivery address?",
      "We'll send a formal RFQ to follow up.",
    ].join("\n");
  }

  // ── Section header ───────────────────────────────────────────────────
  function SectionHeader({ label, count, color, icon }) {
    return h("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "8px 0 6px",
        borderBottom: "1px solid " + color + "30",
        marginBottom: "10px",
      },
    },
      h("span", { style: { fontSize: "14px" } }, icon),
      h("span", {
        style: {
          fontFamily: "Cinzel,serif",
          fontSize: "11px",
          letterSpacing: ".14em",
          color,
          textTransform: "uppercase",
        },
      }, label),
      h("span", {
        style: {
          fontFamily: "JetBrains Mono,monospace",
          fontSize: "10px",
          color: color + "90",
          marginLeft: "auto",
        },
      }, count + " vendor" + (count !== 1 ? "s" : "")),
    );
  }

  // ── Vendor card ──────────────────────────────────────────────────────
  function VendorCard({ vendor, onPhoneSave }) {
    const [open,    setOpen]    = useState(false);
    const [called,  setCalled]  = useState(false);
    const [addPhone, setAddPhone] = useState(false);
    const [phoneVal, setPhoneVal] = useState("");
    const [saving,  setSaving]  = useState(false);

    const contact = vendor.contact || {};
    const strategy = contact.strategy || "lookup";
    const name = contact.companyName || vendor.companyName || vendor.cage;
    const phone = contact.phone || "";
    const email = contact.email || "";

    const stratColor = strategy === "call" ? C.green : strategy === "email" ? C.blue : C.amber;

    const solTags = vendor.sols.slice(0, 3).map((s) =>
      h("span", {
        key: s.sol_number,
        style: {
          fontFamily: "JetBrains Mono,monospace",
          fontSize: "9px",
          padding: "2px 6px",
          background: "rgba(201,168,76,.08)",
          border: "1px solid rgba(201,168,76,.2)",
          borderRadius: "2px",
          color: C.gold,
          cursor: "default",
        },
        title: s.itemName + " · " + (s.qty || "?") + " EA · " + fmtDate(s.quoteDue),
      }, s.sol_number)
    );

    async function savePhone() {
      if (!phoneVal.trim()) return;
      setSaving(true);
      try {
        await fetch("/.netlify/functions/cage-phones", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "cagePhoneSave", payload: { cage: vendor.cage, name, phone: phoneVal.trim() } }),
        });
        onPhoneSave && onPhoneSave(vendor.cage, phoneVal.trim());
        setAddPhone(false);
        setPhoneVal("");
      } catch (_) {}
      setSaving(false);
    }

    return h("div", {
      style: {
        background: called ? "rgba(61,214,140,.04)" : C.surface,
        border: "1px solid " + (called ? C.green + "30" : C.border),
        borderLeft: "3px solid " + stratColor,
        borderRadius: "4px",
        padding: "12px 14px",
        marginBottom: "8px",
        opacity: called ? 0.6 : 1,
        transition: "opacity .2s, border-color .2s",
      },
    },
      // Header row
      h("div", { style: { display: "flex", alignItems: "flex-start", gap: "10px" } },
        // Company + CAGE
        h("div", { style: { flex: 1, minWidth: 0 } },
          h("div", {
            style: {
              fontFamily: "Cinzel,serif",
              fontSize: "12px",
              color: C.alabaster,
              letterSpacing: ".06em",
              marginBottom: "3px",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            },
          }, name),
          h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginBottom: "6px" } },
            h("span", {
              style: {
                fontFamily: "JetBrains Mono,monospace",
                fontSize: "10px",
                color: C.dim,
                letterSpacing: ".1em",
              },
            }, "CAGE " + vendor.cage),
            vendor.partNumber && h("span", {
              style: {
                fontFamily: "JetBrains Mono,monospace",
                fontSize: "10px",
                color: C.dim,
              },
            }, "P/N " + vendor.partNumber),
          ),
          h("div", { style: { display: "flex", gap: "5px", flexWrap: "wrap" } }, ...solTags),
        ),
        // Strategy badge + actions
        h("div", { style: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px", flexShrink: 0 } },
          h("span", {
            style: {
              fontFamily: "Cinzel,serif",
              fontSize: "9px",
              letterSpacing: ".14em",
              padding: "3px 8px",
              background: stratColor + "15",
              border: "1px solid " + stratColor + "40",
              borderRadius: "3px",
              color: stratColor,
              textTransform: "uppercase",
            },
          }, strategy === "call" ? "Call" : strategy === "email" ? "Email" : "Lookup"),
          strategy === "call" && !called && h("button", {
            onClick: () => setCalled(true),
            style: {
              fontFamily: "Cinzel,serif",
              fontSize: "9px",
              letterSpacing: ".1em",
              padding: "3px 8px",
              background: "rgba(61,214,140,.1)",
              border: "1px solid rgba(61,214,140,.3)",
              borderRadius: "3px",
              color: C.green,
              cursor: "pointer",
              textTransform: "uppercase",
            },
          }, "✓ Called"),
          called && h("span", {
            style: {
              fontFamily: "JetBrains Mono,monospace",
              fontSize: "9px",
              color: C.green,
            },
          }, "✓ done"),
        ),
      ),

      // Contact info row
      (phone || email || strategy === "lookup") && h("div", {
        style: {
          display: "flex",
          alignItems: "center",
          gap: "14px",
          marginTop: "8px",
          paddingTop: "8px",
          borderTop: "1px solid " + C.border,
          flexWrap: "wrap",
        },
      },
        phone && h("a", {
          href: "tel:" + phone.replace(/\D/g, ""),
          style: {
            fontFamily: "JetBrains Mono,monospace",
            fontSize: "12px",
            color: C.green,
            textDecoration: "none",
            letterSpacing: ".06em",
          },
        }, "📞 " + phone),
        email && h("a", {
          href: "mailto:" + email,
          style: {
            fontFamily: "JetBrains Mono,monospace",
            fontSize: "11px",
            color: C.blue,
            textDecoration: "none",
          },
        }, "✉ " + email),
        strategy === "lookup" && h("a", {
          href: samLink(vendor.cage),
          target: "_blank",
          rel: "noopener",
          style: {
            fontFamily: "Cinzel,serif",
            fontSize: "9px",
            letterSpacing: ".12em",
            color: C.gold,
            textDecoration: "none",
            background: "rgba(201,168,76,.08)",
            border: "1px solid rgba(201,168,76,.2)",
            borderRadius: "3px",
            padding: "3px 8px",
            textTransform: "uppercase",
          },
        }, "⊕ Look Up SAM.gov"),
        !phone && strategy !== "email" && !addPhone && h("button", {
          onClick: () => setAddPhone(true),
          style: {
            fontFamily: "Cinzel,serif",
            fontSize: "9px",
            letterSpacing: ".1em",
            padding: "3px 8px",
            background: "transparent",
            border: "1px solid " + C.dimmer,
            borderRadius: "3px",
            color: C.dim,
            cursor: "pointer",
            textTransform: "uppercase",
          },
        }, "+ Add Phone"),
      ),

      // Add phone inline
      addPhone && h("div", {
        style: { display: "flex", gap: "6px", marginTop: "8px", alignItems: "center" },
      },
        h("input", {
          type: "tel",
          placeholder: "(xxx) xxx-xxxx",
          value: phoneVal,
          onChange: (e) => setPhoneVal(e.target.value),
          onKeyDown: (e) => { if (e.key === "Enter") savePhone(); if (e.key === "Escape") setAddPhone(false); },
          style: {
            background: "rgba(245,240,232,.05)",
            border: "1px solid rgba(245,240,232,.15)",
            borderRadius: "3px",
            padding: "5px 10px",
            fontFamily: "JetBrains Mono,monospace",
            fontSize: "11px",
            color: C.alabaster,
            outline: "none",
            width: "160px",
          },
        }),
        h("button", {
          onClick: savePhone,
          disabled: saving,
          style: {
            fontFamily: "Cinzel,serif",
            fontSize: "9px",
            letterSpacing: ".1em",
            padding: "5px 10px",
            background: "rgba(61,214,140,.1)",
            border: "1px solid rgba(61,214,140,.3)",
            borderRadius: "3px",
            color: C.green,
            cursor: "pointer",
            textTransform: "uppercase",
          },
        }, saving ? "…" : "Save"),
        h("button", {
          onClick: () => setAddPhone(false),
          style: {
            fontFamily: "Cinzel,serif",
            fontSize: "9px",
            letterSpacing: ".1em",
            padding: "5px 8px",
            background: "transparent",
            border: "1px solid " + C.dimmer,
            borderRadius: "3px",
            color: C.dim,
            cursor: "pointer",
          },
        }, "✕"),
      ),

      // Call script (expandable)
      strategy === "call" && phone && h("div", { style: { marginTop: "8px" } },
        h("button", {
          onClick: () => setOpen(!open),
          style: {
            fontFamily: "Cinzel,serif",
            fontSize: "9px",
            letterSpacing: ".12em",
            padding: "3px 8px",
            background: "transparent",
            border: "1px solid " + C.border,
            borderRadius: "3px",
            color: C.dim,
            cursor: "pointer",
            textTransform: "uppercase",
          },
        }, open ? "▲ Hide Script" : "▼ Call Script"),
        open && h("pre", {
          style: {
            marginTop: "8px",
            padding: "10px 12px",
            background: "rgba(245,240,232,.03)",
            border: "1px solid " + C.border,
            borderRadius: "3px",
            fontFamily: "JetBrains Mono,monospace",
            fontSize: "10px",
            color: C.dim,
            whiteSpace: "pre-wrap",
            lineHeight: "1.7",
          },
        }, makeScript(vendor)),
      ),
    );
  }

  // ── Empty state ──────────────────────────────────────────────────────
  function EmptyState({ msg }) {
    return h("div", {
      style: {
        padding: "40px 24px",
        textAlign: "center",
        fontFamily: "Cinzel,serif",
        fontSize: "11px",
        letterSpacing: ".1em",
        color: C.dim,
        textTransform: "uppercase",
      },
    }, msg);
  }

  // ── Main tab ─────────────────────────────────────────────────────────
  function CallListTab() {
    const [vendors, setVendors] = useState(null); // null = not loaded, [] = empty
    const [loading, setLoading] = useState(false);
    const [error,   setError]   = useState("");

    const build = useCallback(async () => {
      setLoading(true);
      setError("");
      try {
        const rows = await window.SCC_DB.dbGetAll();
        const list = await buildOutreachList(rows || []);
        setVendors(list);
      } catch (e) {
        setError("Failed to build outreach list: " + e.message);
      }
      setLoading(false);
    }, []);

    // Auto-build on mount
    useEffect(() => { build(); }, []);

    // When a phone is saved inline, update the vendor entry
    const handlePhoneSave = useCallback((cage, phone) => {
      setVendors((prev) =>
        (prev || []).map((v) =>
          v.cage === cage
            ? { ...v, contact: { ...v.contact, phone, strategy: "call" } }
            : v
        )
      );
    }, []);

    const callVendors   = (vendors || []).filter((v) => v.contact.strategy === "call");
    const emailVendors  = (vendors || []).filter((v) => v.contact.strategy === "email");
    const lookupVendors = (vendors || []).filter((v) => v.contact.strategy === "lookup");

    return h("div", {
      style: {
        padding: "20px 24px",
        maxWidth: "780px",
        margin: "0 auto",
        fontFamily: "Cinzel,serif",
      },
    },
      // Header
      h("div", {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "20px",
          paddingBottom: "14px",
          borderBottom: "1px solid " + C.border,
        },
      },
        h("div", null,
          h("div", {
            style: {
              fontFamily: "Cinzel,serif",
              fontSize: "16px",
              letterSpacing: ".16em",
              color: C.gold,
              textTransform: "uppercase",
              marginBottom: "4px",
            },
          }, "Outreach Command"),
          h("div", {
            style: {
              fontFamily: "JetBrains Mono,monospace",
              fontSize: "10px",
              color: C.dim,
              letterSpacing: ".06em",
            },
          }, "Approved source contacts from active pipeline · Call list + email queue"),
        ),
        h("button", {
          onClick: build,
          disabled: loading,
          style: {
            fontFamily: "Cinzel,serif",
            fontSize: "10px",
            letterSpacing: ".12em",
            padding: "8px 16px",
            background: loading ? "rgba(201,168,76,.05)" : "rgba(201,168,76,.1)",
            border: "1px solid rgba(201,168,76,.3)",
            borderRadius: "4px",
            color: C.gold,
            cursor: loading ? "default" : "pointer",
            textTransform: "uppercase",
          },
        }, loading ? "Building…" : "↻ Refresh"),
      ),

      // Error
      error && h("div", {
        style: {
          padding: "10px 14px",
          background: "rgba(232,116,116,.08)",
          border: "1px solid rgba(232,116,116,.25)",
          borderRadius: "4px",
          fontFamily: "JetBrains Mono,monospace",
          fontSize: "11px",
          color: C.red,
          marginBottom: "16px",
        },
      }, error),

      // Loading
      loading && h("div", {
        style: {
          padding: "30px 0",
          textAlign: "center",
          fontFamily: "JetBrains Mono,monospace",
          fontSize: "11px",
          color: C.dim,
          letterSpacing: ".08em",
        },
      }, "Fetching approved sources from pipeline…"),

      // Results
      !loading && vendors !== null && h(Fragment, null,

        // Summary chips
        vendors.length > 0 && h("div", {
          style: {
            display: "flex",
            gap: "10px",
            marginBottom: "20px",
            flexWrap: "wrap",
          },
        },
          [
            { label: "Call Now",   count: callVendors.length,   color: C.green },
            { label: "Email Queue", count: emailVendors.length,  color: C.blue  },
            { label: "Needs Lookup", count: lookupVendors.length, color: C.amber },
          ].map(({ label, count, color }) =>
            count > 0 && h("div", {
              key: label,
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: "10px",
                letterSpacing: ".12em",
                padding: "5px 12px",
                background: color + "12",
                border: "1px solid " + color + "35",
                borderRadius: "4px",
                color,
                textTransform: "uppercase",
              },
            }, count + " " + label)
          )
        ),

        // CALL NOW
        callVendors.length > 0 && h("div", { style: { marginBottom: "24px" } },
          h(SectionHeader, { label: "Call Now", count: callVendors.length, color: C.green, icon: "📞" }),
          ...callVendors.map((v) => h(VendorCard, { key: v.cage, vendor: v, onPhoneSave: handlePhoneSave }))
        ),

        // EMAIL QUEUE
        emailVendors.length > 0 && h("div", { style: { marginBottom: "24px" } },
          h(SectionHeader, { label: "Email Queue", count: emailVendors.length, color: C.blue, icon: "✉" }),
          ...emailVendors.map((v) => h(VendorCard, { key: v.cage, vendor: v, onPhoneSave: handlePhoneSave }))
        ),

        // NEEDS LOOKUP
        lookupVendors.length > 0 && h("div", { style: { marginBottom: "24px" } },
          h(SectionHeader, { label: "Needs Lookup", count: lookupVendors.length, color: C.amber, icon: "⊕" }),
          h("div", {
            style: {
              fontFamily: "JetBrains Mono,monospace",
              fontSize: "10px",
              color: C.dim,
              marginBottom: "10px",
              letterSpacing: ".06em",
            },
          }, "No phone on file. Click 'Look Up SAM.gov' or use '+ Add Phone' to save the number."),
          ...lookupVendors.map((v) => h(VendorCard, { key: v.cage, vendor: v, onPhoneSave: handlePhoneSave }))
        ),

        vendors.length === 0 && h(EmptyState, {
          msg: "No actionable pipeline sols with approved source data. Add sols to pipeline and run NSN Intel first.",
        }),
      ),
    );
  }

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.CallListTab = CallListTab;
})();
