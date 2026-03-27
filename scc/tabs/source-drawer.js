(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — SOURCE · DRAWER SOURCE PANEL
  //  Pre-compiled React · No Babel · No JSX
  //  Depends on: source-blocked.js (VI_STATUS_STYLE)
  //  Exports: window.SCC_TABS.DrawerSourcePanel
  // ═══════════════════════════════════════════════════════════════════════

  const {
    createElement: hS,
    useState: useSourceState,
    useEffect: useSourceEffect,
  } = React;

  // ── CAGE → search URL map (Tier 1 known suppliers) ───────────────────
  const CAGE_URL_MAP = {
    "0Y3H3": {
      name: "Fastenal",
      url: "https://www.fastenal.com/products/search?searchTerm=",
    },
    25795: {
      name: "Grainger",
      url: "https://www.grainger.com/search?searchQuery=",
    },
    56654: {
      name: "Streamlight",
      url: "https://www.streamlight.com/search#q=",
    },
    "1DL31": {
      name: "Batteries Plus",
      url: "https://www.batteriesplus.com/search#q=",
    },
    "0RJF7": {
      name: "MSC Industrial",
      url: "https://www.mscdirect.com/browse/tn/?searchterm=",
    },
    79679: { name: "McMaster-Carr", url: "https://www.mcmaster.com/#" },
    "6W466": { name: "Amazon Bus.", url: "https://www.amazon.com/s?k=" },
    "1YD06": { name: "Zoro Tools", url: "https://www.zoro.com/search?q=" },
    "75Q65": {
      name: "Oshkosh Def.",
      url: "https://www.oshkoshdefense.com/parts/?search=",
    },
    "1LJX3": {
      name: "W.B. Mason",
      url: "https://www.wbmason.com/search?query=",
    },
    27783: {
      name: "Office Depot",
      url: "https://www.officedepot.com/catalog/search.do?Ntt=",
    },
    "0VW91": {
      name: "Uline",
      url: "https://www.uline.com/Product_List.asp?search=",
    },
  };

  // Fallback: DIBBS approved sources page for that NSN
  function resolveSupplierUrl(cage, pn, nsn) {
    const known = CAGE_URL_MAP[cage.trim().toUpperCase()];
    if (known) return known.url + encodeURIComponent(pn || nsn || "");
    // Fallback: GSA Advantage search by P/N or NSN
    return (
      "https://www.gsaadvantage.gov/advantage/catalog/search.do?q=" +
      encodeURIComponent(pn || nsn || cage)
    );
  }

  // Parse pipe-delimited supplier string: "NAME|CAGE|PN;NAME|CAGE|PN;"
  function parseSuppliers(str) {
    if (!str) return [];
    return str
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((seg) => {
        const parts = seg.split("|");
        return {
          name: parts[0] || "",
          cage: parts[1] || "",
          pn: parts[2] || "",
        };
      })
      .filter((s) => s.name || s.cage);
  }

  function DrawerSourcePanel({ record }) {
    const { FSC_LANES_MAP, DISTRIBUTORS, getDistsByFSC } = window.SCC_DIST;
    const { isBlocked } = window.SCC_TABS;
    const fsc = record.fsc || "";
    const nsn = record.nsn || "";
    const part = record.ref_part_number || "";
    const mfr = record.ref_supplier || "";
    const dists = getDistsByFSC(fsc).slice(0, 12);
    const lane = FSC_LANES_MAP[String(fsc)] || "FSC " + fsc;
    const approvedSources = parseSuppliers(record.suppliers || "");

    const btnStyle = {
      display: "inline-flex",
      alignItems: "center",
      gap: "5px",
      fontFamily: "Cinzel,serif",
      fontSize: "8px",
      letterSpacing: ".08em",
      textTransform: "uppercase",
      padding: "6px 12px",
      borderRadius: "4px",
      cursor: "pointer",
      textDecoration: "none",
      transition: "all .15s",
      fontWeight: "600",
      background: "var(--surface-sheen)",
      border: "1px solid rgba(201,168,76,.25)",
      color: "var(--gold-solid)",
    };

    const blockedHit = isBlocked(mfr);

    return hS(
      "div",
      null,
      // ── Blocked manufacturer warning ──
      blockedHit &&
        hS(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "flex-start",
              gap: "12px",
              padding: "12px 16px",
              marginBottom: "14px",
              background: "rgba(231,76,60,.08)",
              border: "1px solid rgba(231,76,60,.4)",
              borderLeft: "4px solid #e74c3c",
            },
          },
          hS("span", { style: { fontSize: "18px", lineHeight: "1" } }, "⚠"),
          hS(
            "div",
            null,
            hS(
              "div",
              {
                style: {
                  fontFamily: "Cinzel,serif",
                  fontSize: "12px",
                  letterSpacing: ".1em",
                  color: "var(--accent-red-soft)",
                  marginBottom: "3px",
                },
              },
              "BLOCKED MANUFACTURER — " + blockedHit.name,
            ),
            blockedHit.reason &&
              hS(
                "div",
                {
                  style: {
                    fontFamily: "Cormorant Garamond,serif",
                    fontSize: "13px",
                    fontStyle: "italic",
                    color: "var(--accent-red-dim)",
                  },
                },
                blockedHit.reason,
              ),
            hS(
              "div",
              {
                style: {
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "10px",
                  color: "var(--accent-red-dim)",
                  marginTop: "3px",
                },
              },
              "Do not contact direct — source through authorized distributors only.",
            ),
          ),
        ),
      hS(
        "div",
        {
          style: {
            display: "flex",
            gap: "8px",
            flexWrap: "wrap",
            marginBottom: "16px",
          },
        },
        nsn &&
          hS(
            "span",
            {
              style: {
                fontFamily: "JetBrains Mono,monospace",
                fontSize: "12px",
                padding: "4px 10px",
                borderRadius: "4px",
                background: "rgba(201,168,76,.1)",
                border: "1px solid rgba(201,168,76,.2)",
                color: "var(--gold-solid)",
              },
            },
            "NSN " + nsn,
          ),
        fsc &&
          hS(
            "span",
            {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: "9px",
                letterSpacing: ".1em",
                padding: "4px 10px",
                borderRadius: "4px",
                background: "var(--surface-inset)",
                border: "1px solid rgba(201,168,76,.15)",
                color: "var(--gold-mid)",
              },
            },
            lane,
          ),
        part &&
          hS(
            "span",
            {
              style: {
                fontFamily: "JetBrains Mono,monospace",
                fontSize: "12px",
                padding: "4px 10px",
                borderRadius: "4px",
                background: "rgba(61,214,140,.08)",
                border: "1px solid rgba(61,214,140,.2)",
                color: "var(--accent-green-bright)",
              },
            },
            "P/N " + part,
          ),
        mfr &&
          hS(
            "span",
            {
              style: {
                fontFamily: "Cormorant Garamond,serif",
                fontSize: "13px",
                padding: "4px 10px",
                borderRadius: "4px",
                background: "var(--surface-inset)",
                border: "1px solid var(--border-subtle)",
                color: "var(--body-muted)",
              },
            },
            mfr,
          ),
      ),
      part &&
        hS(
          "div",
          { style: { marginBottom: "16px" } },
          hS(
            "div",
            {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: "8px",
                letterSpacing: ".15em",
                textTransform: "uppercase",
                color: "var(--gold-dim)",
                marginBottom: "8px",
              },
            },
            "Quick Search — " + part,
          ),
          hS(
            "div",
            { style: { display: "flex", gap: "6px", flexWrap: "wrap" } },
            hS(
              "a",
              {
                style: btnStyle,
                href:
                  "https://www.google.com/search?q=" +
                  encodeURIComponent(part + " military specification NSN"),
                target: "_blank",
              },
              "Google",
            ),
            hS(
              "a",
              {
                style: btnStyle,
                href:
                  "https://www.google.com/search?q=" +
                  encodeURIComponent(part) +
                  "&tbm=isch",
                target: "_blank",
              },
              "Images",
            ),
            hS(
              "a",
              {
                style: btnStyle,
                href: "https://www.dibbs.bsm.dla.mil/",
                target: "_blank",
              },
              "DLA DIBBS",
            ),
            hS(
              "a",
              {
                style: btnStyle,
                href:
                  "https://sam.gov/search/?keywords=" +
                  encodeURIComponent(nsn || part),
                target: "_blank",
              },
              "SAM.gov",
            ),
          ),
        ),
      // ── DLA Approved Sources (from parsed batch) ──────────────────────
      approvedSources.length > 0 &&
        hS(
          "div",
          { style: { marginBottom: "20px" } },
          hS(
            "div",
            {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: "8px",
                letterSpacing: ".15em",
                textTransform: "uppercase",
                color: "var(--accent-green-bright)",
                marginBottom: "10px",
                borderBottom: "1px solid rgba(61,214,140,.2)",
                paddingBottom: "6px",
              },
            },
            "DLA Approved Sources — " + approvedSources.length + " Listed",
          ),
          hS(
            "div",
            {
              style: {
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))",
                gap: "8px",
              },
            },
            ...approvedSources.map((s) =>
              hS(
                "a",
                {
                  key: s.cage,
                  href: resolveSupplierUrl(s.cage, s.pn, nsn),
                  target: "_blank",
                  style: {
                    display: "flex",
                    flexDirection: "column",
                    gap: "3px",
                    padding: "9px 13px",
                    background: "rgba(61,214,140,.06)",
                    border: "1px solid rgba(61,214,140,.25)",
                    borderLeft: "3px solid rgba(61,214,140,.6)",
                    textDecoration: "none",
                    transition: "all .15s",
                    cursor: "pointer",
                  },
                },
                hS(
                  "span",
                  {
                    style: {
                      fontFamily: "Cinzel,serif",
                      fontSize: "9px",
                      letterSpacing: ".08em",
                      color: "var(--accent-green-bright)",
                      fontWeight: "700",
                    },
                  },
                  s.name || "CAGE " + s.cage,
                ),
                hS(
                  "span",
                  {
                    style: {
                      fontFamily: "JetBrains Mono,monospace",
                      fontSize: "9px",
                      color: "var(--body-faint)",
                      letterSpacing: ".04em",
                    },
                  },
                  "CAGE " + s.cage + (s.pn ? " · " + s.pn : ""),
                ),
                CAGE_URL_MAP[s.cage.trim().toUpperCase()]
                  ? hS(
                      "span",
                      {
                        style: {
                          fontSize: "8px",
                          color: "#3dd68c",
                          letterSpacing: ".04em",
                        },
                      },
                      "Direct Catalog",
                    )
                  : hS(
                      "span",
                      {
                        style: {
                          fontSize: "8px",
                          color: "rgba(201,168,76,.5)",
                          letterSpacing: ".04em",
                        },
                      },
                      "GSA Fallback",
                    ),
              ),
            ),
          ),
        ),
      hS(
        "div",
        {
          style: {
            fontFamily: "Cinzel,serif",
            fontSize: "8px",
            letterSpacing: ".15em",
            textTransform: "uppercase",
            color: "var(--gold-dim)",
            marginBottom: "10px",
          },
        },
        dists.length
          ? dists.length + " Matched Distributors — FSC " + fsc + " · " + lane
          : "All Distributors",
      ),
      hS(
        "div",
        {
          style: {
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))",
            gap: "8px",
          },
        },
        ...(dists.length ? dists : DISTRIBUTORS.slice(0, 12)).map((d) =>
          hS(
            "a",
            {
              key: d.id,
              href:
                d.search_url +
                (part
                  ? encodeURIComponent(part)
                  : nsn
                    ? encodeURIComponent(nsn)
                    : ""),
              target: "_blank",
              style: {
                ...btnStyle,
                justifyContent: "space-between",
                padding: "8px 12px",
                textDecoration: "none",
              },
            },
            hS(
              "span",
              {
                style: {
                  fontFamily: "Cinzel,serif",
                  fontSize: "9px",
                  letterSpacing: ".06em",
                  color: "var(--gold-solid)",
                },
              },
              d.name,
            ),
            hS(
              "span",
              {
                style: {
                  fontSize: "8px",
                  color:
                    d.friction === "low"
                      ? "#3dd68c"
                      : d.friction === "medium"
                        ? "#f5c542"
                        : "#ff6b7a",
                  letterSpacing: ".04em",
                },
              },
              "T" + d.tier,
            ),
          ),
        ),
      ),
    );
  }

  // ── FULL SOURCE TAB ───────────────────────────────────────────────────

  // ── VENDOR ROLODEX ───────────────────────────────────────────────────

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.DrawerSourcePanel = DrawerSourcePanel;
})();
