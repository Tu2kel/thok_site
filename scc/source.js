(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — SOURCE TAB + DRAWER SOURCE PANEL
  //  Pre-compiled React · No Babel · No JSX
  // ═══════════════════════════════════════════════════════════════════════

  const {
    createElement: hS,
    useState: useSourceState,
    useEffect: useSourceEffect,
    Fragment: SFragment,
  } = React;

  const VI_STATUS_STYLE = {
    confirmed: {
      bg: "rgba(61,214,140,.12)",
      border: "rgba(61,214,140,.3)",
      color: "var(--accent-green)",
    },
    quoted: {
      bg: "rgba(201,168,76,.12)",
      border: "rgba(201,168,76,.3)",
      color: "var(--gold-solid)",
    },
    pending: {
      bg: "rgba(90,120,200,.12)",
      border: "rgba(90,120,200,.3)",
      color: "var(--accent-blue-bright)",
    },
    no_stock: {
      bg: "rgba(255,107,122,.12)",
      border: "rgba(255,107,122,.3)",
      color: "var(--accent-red-soft)",
    },
  };

  // ── BLOCKED MANUFACTURERS ─────────────────────────────────────────────
  const LS_BLOCKED = "imperio_scc_blocked_mfr";
  function loadBlocked() {
    try {
      return JSON.parse(localStorage.getItem(LS_BLOCKED) || "[]");
    } catch (e) {
      return [];
    }
  }
  function saveBlocked(arr) {
    try {
      localStorage.setItem(LS_BLOCKED, JSON.stringify(arr));
    } catch (e) {}
  }

  // Check if a string matches any blocked entry (case-insensitive partial match)
  function isBlocked(name) {
    if (!name) return null;
    const n = name.toLowerCase();
    return (
      loadBlocked().find(
        (b) =>
          n.includes(b.name.toLowerCase()) || b.name.toLowerCase().includes(n),
      ) || null
    );
  }

  // ── BLOCKED MFR MANAGER PANEL ─────────────────────────────────────────
  function BlockedMfrPanel() {
    const [list, setList] = useSourceState(loadBlocked);
    const [input, setInput] = useSourceState("");
    const [reason, setReason] = useSourceState("");
    const [flash, setFlash] = useSourceState("");

    const add = () => {
      const name = input.trim();
      if (!name) return;
      if (list.find((b) => b.name.toLowerCase() === name.toLowerCase())) {
        setFlash("Already on list.");
        setTimeout(() => setFlash(""), 2000);
        return;
      }
      const updated = [
        ...list,
        { name, reason: reason.trim(), added: new Date().toLocaleDateString() },
      ];
      saveBlocked(updated);
      setList(updated);
      setInput("");
      setReason("");
      setFlash("Added — " + name);
      setTimeout(() => setFlash(""), 2500);
    };

    const remove = (name) => {
      const updated = list.filter((b) => b.name !== name);
      saveBlocked(updated);
      setList(updated);
    };

    const warnBox = {
      background: "rgba(231,76,60,.06)",
      border: "1px solid rgba(231,76,60,.25)",
      borderLeft: "3px solid #e74c3c",
      padding: "12px 16px",
      marginBottom: "8px",
      display: "flex",
      alignItems: "flex-start",
      gap: "12px",
      flexWrap: "wrap",
    };

    return hS(
      "div",
      { style: { marginBottom: "28px" } },
      // Header
      hS(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: "10px",
            marginBottom: "16px",
          },
        },
        hS(
          "div",
          {
            style: {
              fontFamily: "Cinzel,serif",
              fontSize: "13px",
              letterSpacing: ".16em",
              textTransform: "uppercase",
              background: "linear-gradient(to right,#e74c3c,#ff6b7a)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            },
          },
          "⚠ Blocked Manufacturers",
        ),
        hS(
          "span",
          {
            style: {
              fontFamily: "JetBrains Mono,monospace",
              fontSize: "10px",
              padding: "2px 8px",
              background: "rgba(231,76,60,.1)",
              border: "1px solid rgba(231,76,60,.25)",
              color: "var(--red)",
              borderRadius: "2px",
            },
          },
          list.length + " blocked",
        ),
      ),

      // Blocked list
      list.length === 0
        ? hS(
            "div",
            {
              style: {
                fontFamily: "Cormorant Garamond,serif",
                fontSize: "14px",
                fontStyle: "italic",
                color: "var(--body-faint)",
                marginBottom: "16px",
                padding: "12px 16px",
                border: "1px solid rgba(231,76,60,.1)",
              },
            },
            "No blocked manufacturers yet. Add any company that refuses to quote direct or sells through authorized distributors only.",
          )
        : hS(
            "div",
            {
              style: {
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                marginBottom: "16px",
              },
            },
            ...list.map((b) =>
              hS(
                "div",
                { key: b.name, style: warnBox },
                hS(
                  "div",
                  { style: { flex: "1", minWidth: "180px" } },
                  hS(
                    "div",
                    {
                      style: {
                        fontFamily: "Cinzel,serif",
                        fontSize: "13px",
                        letterSpacing: ".06em",
                        color: "var(--accent-red-soft)",
                        marginBottom: "3px",
                      },
                    },
                    b.name,
                  ),
                  b.reason &&
                    hS(
                      "div",
                      {
                        style: {
                          fontFamily: "Cormorant Garamond,serif",
                          fontSize: "13px",
                          fontStyle: "italic",
                          color: "var(--body-dim)",
                        },
                      },
                      "↳ " + b.reason,
                    ),
                  hS(
                    "div",
                    {
                      style: {
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "9px",
                        color: "var(--body-faint)",
                        marginTop: "3px",
                      },
                    },
                    "Added " + b.added,
                  ),
                ),
                hS(
                  "button",
                  {
                    onClick: () => remove(b.name),
                    style: {
                      background: "transparent",
                      border: "1px solid rgba(231,76,60,.2)",
                      color: "var(--accent-red-dim)",
                      fontFamily: "Cinzel,serif",
                      fontSize: "9px",
                      letterSpacing: ".08em",
                      padding: "3px 10px",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      transition: "all .2s",
                    },
                    onMouseEnter: (e) => {
                      e.target.style.background = "rgba(231,76,60,.1)";
                      e.target.style.color = "#e74c3c";
                    },
                    onMouseLeave: (e) => {
                      e.target.style.background = "transparent";
                      e.target.style.color = "rgba(231,76,60,.4)";
                    },
                  },
                  "Remove",
                ),
              ),
            ),
          ),

      // Add form
      hS(
        "div",
        {
          style: {
            background: "var(--inset-bg)",
            border: "1px solid rgba(231,76,60,.15)",
            borderTop: "2px solid rgba(231,76,60,.35)",
            padding: "16px 18px",
          },
        },
        hS(
          "div",
          {
            style: {
              fontFamily: "Cinzel,serif",
              fontSize: "9px",
              letterSpacing: ".16em",
              textTransform: "uppercase",
              color: "var(--accent-red-dim)",
              marginBottom: "12px",
            },
          },
          "+ Add Blocked Manufacturer",
        ),
        hS(
          "div",
          {
            style: {
              display: "grid",
              gridTemplateColumns: "1fr 1fr auto",
              gap: "10px",
              alignItems: "flex-end",
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
                  fontSize: "9px",
                  letterSpacing: ".14em",
                  textTransform: "uppercase",
                  color: "var(--body-faint)",
                  marginBottom: "5px",
                },
              },
              "Company Name",
            ),
            hS("input", {
              value: input,
              onChange: (e) => setInput(e.target.value),
              onKeyDown: (e) => e.key === "Enter" && add(),
              placeholder: "e.g. Donaldson Company",
              style: {
                width: "100%",
                padding: "9px 12px",
                background: "var(--inset-bg)",
                border: "1px solid rgba(231,76,60,.2)",
                color: "var(--alabaster)",
                fontFamily: "JetBrains Mono,monospace",
                fontSize: "13px",
                outline: "none",
                boxSizing: "border-box",
              },
            }),
          ),
          hS(
            "div",
            null,
            hS(
              "div",
              {
                style: {
                  fontFamily: "Cinzel,serif",
                  fontSize: "9px",
                  letterSpacing: ".14em",
                  textTransform: "uppercase",
                  color: "var(--body-faint)",
                  marginBottom: "5px",
                },
              },
              "Reason (optional)",
            ),
            hS("input", {
              value: reason,
              onChange: (e) => setReason(e.target.value),
              onKeyDown: (e) => e.key === "Enter" && add(),
              placeholder: "e.g. Authorized distributors only",
              style: {
                width: "100%",
                padding: "9px 12px",
                background: "var(--inset-bg)",
                border: "1px solid rgba(231,76,60,.2)",
                color: "var(--alabaster)",
                fontFamily: "JetBrains Mono,monospace",
                fontSize: "13px",
                outline: "none",
                boxSizing: "border-box",
              },
            }),
          ),
          hS(
            "button",
            {
              onClick: add,
              style: {
                padding: "9px 20px",
                background: "rgba(231,76,60,.1)",
                border: "1px solid rgba(231,76,60,.4)",
                color: "var(--accent-red-soft)",
                fontFamily: "Cinzel,serif",
                fontSize: "10px",
                letterSpacing: ".1em",
                cursor: "pointer",
                whiteSpace: "nowrap",
                transition: "all .2s",
              },
              onMouseEnter: (e) => {
                e.target.style.background = "rgba(231,76,60,.2)";
              },
              onMouseLeave: (e) => {
                e.target.style.background = "rgba(231,76,60,.1)";
              },
            },
            "⚠ Block",
          ),
        ),
        flash &&
          hS(
            "div",
            {
              style: {
                fontFamily: "JetBrains Mono,monospace",
                fontSize: "11px",
                color: "var(--red)",
                marginTop: "8px",
                letterSpacing: ".06em",
              },
            },
            flash,
          ),
      ),
    );
  }

  // ── DRAWER SOURCE PANEL (used inside pipeline drawer too) ─────────────
  function DrawerSourcePanel({ record }) {
    const { FSC_LANES_MAP, DISTRIBUTORS, getDistsByFSC } = window.SCC_DIST;
    const fsc = record.fsc || "";
    const nsn = record.nsn || "";
    const part = record.ref_part_number || "";
    const mfr = record.ref_supplier || "";
    const dists = getDistsByFSC(fsc).slice(0, 12);
    const lane = FSC_LANES_MAP[String(fsc)] || "FSC " + fsc;

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
  function SourceTab({ preload, onPreloadConsumed }) {
    const {
      FSC_LANES_MAP,
      DISTRIBUTORS,
      getDistsByFSC,
      scoreAndRank,
      extractPrefix,
      toConfidence,
    } = window.SCC_DIST;
    const nsnLookup = (nsn) =>
      window.SCC_NSN ? window.SCC_NSN.nsnLookup(nsn) : null;
    const { viGetByNSN } = window.SCC_DB;

    const [query, setQuery] = useSourceState("");
    const [fscFilter, setFscFilter] = useSourceState("");
    const [partInput, setPartInput] = useSourceState("");
    const [results, setResults] = useSourceState([]);
    const [searched, setSearched] = useSourceState(false);
    const [nsnIntel, setNsnIntel] = useSourceState([]);
    const [nsnRecord, setNsnRecord] = useSourceState(null);
    const [preloadBanner, setPreloadBanner] = useSourceState(null);

    // ── Extract NSN from a string — returns {nsn, fsc} or null ──────────
    const extractNSN = (str) => {
      const m = (str || "").match(/(\d{4})-(\d{2}-\d{3}-\d{4})/);
      if (!m) return null;
      return { nsn: m[0], fsc: m[1] };
    };

    // ── Core search — always call with resolved values ───────────────────
    const doSearch = (q, f, p) => {
      const qq = (q !== undefined ? q : query).trim();
      const pp = (p !== undefined ? p : partInput).trim();
      let ff = (f !== undefined ? f : fscFilter).trim();

      // Auto-extract FSC when user pastes a full NSN into the keyword field
      const nsnHit = extractNSN(qq);
      if (nsnHit && !ff) {
        ff = nsnHit.fsc;
        setFscFilter(ff); // reflect in the UI input
      }

      // Resolve NSN string for scoring and intel lookup
      const nsnStr = nsnHit
        ? nsnHit.nsn
        : (qq.match(/\d{4}-\d{2}-\d{3}-\d{4}/) || [])[0] || "";

      const r = scoreAndRank(qq, ff, pp, nsnStr);
      setResults(r);
      setSearched(true);
      if (nsnStr) {
        viGetByNSN(nsnStr).then(setNsnIntel);
        setNsnRecord(nsnLookup(nsnStr));
      } else {
        setNsnIntel([]);
        setNsnRecord(null);
      }
    };

    // Fire automatically when preload arrives from pipeline row
    useSourceEffect(() => {
      if (!preload) return;
      const { nsn, fsc, part } = preload;
      setQuery(nsn || "");
      setFscFilter(fsc || "");
      setPartInput(part || "");
      setPreloadBanner({ nsn, fsc, part });
      // Use resolved values directly — state hasn't updated yet
      const r = scoreAndRank(nsn || "", fsc || "", part || "", nsn || "");
      setResults(r);
      setSearched(true);
      if (nsn) {
        viGetByNSN(nsn).then(setNsnIntel);
        setNsnRecord(nsnLookup(nsn));
      }
      if (onPreloadConsumed) onPreloadConsumed();
    }, [preload]);

    const topFSCs = [
      "5305",
      "5310",
      "6515",
      "5961",
      "9510",
      "8415",
      "8465",
      "7930",
      "4240",
      "5935",
      "5110",
      "4910",
    ];

    // Check if queried manufacturer/keyword is blocked
    const activeBlockedHit = query.trim() ? isBlocked(query) : null;

    return hS(
      "div",
      { style: { animation: "fadeUp .4s ease both" } },
      // Header
      hS(
        "div",
        { style: { marginBottom: "24px" } },
        hS(
          "div",
          {
            style: {
              fontFamily: "Cinzel,serif",
              fontSize: "28px",
              letterSpacing: ".12em",
              color: "var(--gold-solid)",
              marginBottom: "6px",
            },
          },
          "◆ Distributor Source Engine",
        ),
        hS(
          "div",
          {
            style: {
              fontFamily: "Cormorant Garamond,serif",
              fontStyle: "italic",
              fontSize: "15px",
              color: "var(--gold-dim)",
            },
          },
          "120 vendors · 47 FSC lanes mapped · Ranked by fit · Global intel layer",
        ),
      ),

      // Blocked manufacturer panel
      hS(BlockedMfrPanel, {}),

      // ── Blocked hit warning when keyword matches a blocked entry ──
      activeBlockedHit &&
        hS(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "flex-start",
              gap: "12px",
              padding: "14px 18px",
              marginBottom: "16px",
              background: "rgba(231,76,60,.08)",
              border: "1px solid rgba(231,76,60,.5)",
              borderLeft: "4px solid #e74c3c",
              animation: "fadeUp .25s ease both",
            },
          },
          hS("span", { style: { fontSize: "22px", lineHeight: "1" } }, "⚠"),
          hS(
            "div",
            null,
            hS(
              "div",
              {
                style: {
                  fontFamily: "Cinzel,serif",
                  fontSize: "13px",
                  letterSpacing: ".1em",
                  color: "var(--accent-red-soft)",
                  marginBottom: "4px",
                },
              },
              "BLOCKED MANUFACTURER — " + activeBlockedHit.name,
            ),
            activeBlockedHit.reason &&
              hS(
                "div",
                {
                  style: {
                    fontFamily: "Cormorant Garamond,serif",
                    fontSize: "14px",
                    fontStyle: "italic",
                    color: "var(--red)",
                    marginBottom: "3px",
                  },
                },
                "↳ " + activeBlockedHit.reason,
              ),
            hS(
              "div",
              {
                style: {
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "10px",
                  color: "var(--accent-red-dim)",
                },
              },
              "Do not contact direct — source through authorized distributors only.",
            ),
          ),
        ),

      // Preload banner
      preloadBanner &&
        hS(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: "10px",
              flexWrap: "wrap",
              padding: "10px 16px",
              marginBottom: "16px",
              background: "rgba(201,168,76,.06)",
              border: "1px solid rgba(201,168,76,.3)",
              borderLeft: "3px solid #C9A84C",
            },
          },
          hS(
            "span",
            {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: "9px",
                letterSpacing: ".15em",
                textTransform: "uppercase",
                color: "var(--gold-dim)",
              },
            },
            "Loaded from Pipeline →",
          ),
          preloadBanner.nsn &&
            hS(
              "span",
              {
                style: {
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "12px",
                  padding: "3px 9px",
                  borderRadius: "3px",
                  background: "rgba(201,168,76,.12)",
                  border: "1px solid rgba(201,168,76,.2)",
                  color: "var(--gold-solid)",
                },
              },
              "NSN " + preloadBanner.nsn,
            ),
          preloadBanner.fsc &&
            hS(
              "span",
              {
                style: {
                  fontFamily: "Cinzel,serif",
                  fontSize: "9px",
                  letterSpacing: ".1em",
                  padding: "3px 9px",
                  borderRadius: "3px",
                  background: "var(--surface-inset)",
                  border: "1px solid rgba(201,168,76,.15)",
                  color: "var(--gold-mid)",
                },
              },
              "FSC " +
                preloadBanner.fsc +
                " — " +
                (FSC_LANES_MAP[String(preloadBanner.fsc)] || ""),
            ),
          preloadBanner.part &&
            hS(
              "span",
              {
                style: {
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "12px",
                  padding: "3px 9px",
                  borderRadius: "3px",
                  background: "rgba(61,214,140,.08)",
                  border: "1px solid rgba(61,214,140,.2)",
                  color: "var(--accent-green-bright)",
                },
              },
              "P/N " + preloadBanner.part,
            ),
          hS(
            "button",
            {
              onClick: () => setPreloadBanner(null),
              style: {
                marginLeft: "auto",
                background: "transparent",
                border: "none",
                color: "var(--body-faint)",
                cursor: "pointer",
                fontSize: "12px",
              },
            },
            "✕",
          ),
        ),

      // Local NSN DB hit
      nsnRecord &&
        hS(
          "div",
          {
            style: {
              padding: "12px 16px",
              marginBottom: "16px",
              background: "rgba(61,214,140,.05)",
              border: "1px solid rgba(61,214,140,.25)",
              borderLeft: "3px solid #3dd68c",
              display: "flex",
              gap: "16px",
              flexWrap: "wrap",
              alignItems: "center",
            },
          },
          hS(
            "span",
            {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: "9px",
                letterSpacing: ".15em",
                textTransform: "uppercase",
                color: "var(--accent-green)",
              },
            },
            "◈ In Local DB",
          ),
          hS(
            "span",
            {
              style: {
                fontFamily: "JetBrains Mono,monospace",
                fontSize: "13px",
                color: "var(--gold-solid)",
              },
            },
            nsnRecord.nsn,
          ),
          hS(
            "span",
            {
              style: {
                fontFamily: "Cormorant Garamond,serif",
                fontSize: "15px",
                color: "var(--alabaster)",
              },
            },
            nsnRecord.item,
          ),
          nsnRecord.price &&
            hS(
              "span",
              {
                style: {
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "13px",
                  fontWeight: "700",
                  color: "var(--accent-yellow)",
                },
              },
              "Ref $" + parseFloat(nsnRecord.price).toFixed(2),
            ),
        ),

      // Search bar
      hS(
        "div",
        {
          style: {
            background: "var(--surface-sheen)",
            border: "1px solid rgba(201,168,76,.25)",
            borderTop: "2px solid rgba(201,168,76,.5)",
            padding: "20px 24px",
            marginBottom: "20px",
          },
        },
        hS(
          "div",
          {
            style: {
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr auto",
              gap: "12px",
              alignItems: "flex-end",
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
                  fontSize: "9px",
                  letterSpacing: ".18em",
                  textTransform: "uppercase",
                  color: "var(--gold-dim)",
                  marginBottom: "6px",
                },
              },
              "Keyword / NSN",
            ),
            hS("input", {
              value: query,
              onChange: (e) => setQuery(e.target.value),
              onKeyDown: (e) => e.key === "Enter" && doSearch(),
              placeholder: "e.g. medline, 6515-01-129-5436…",
              style: {
                width: "100%",
                padding: "10px 12px",
                background: "var(--inset-bg)",
                border: "1px solid rgba(201,168,76,.2)",
                color: "var(--alabaster)",
                fontFamily: "JetBrains Mono,monospace",
                fontSize: "13px",
                outline: "none",
              },
            }),
          ),
          hS(
            "div",
            null,
            hS(
              "div",
              {
                style: {
                  fontFamily: "Cinzel,serif",
                  fontSize: "9px",
                  letterSpacing: ".18em",
                  textTransform: "uppercase",
                  color: "var(--gold-dim)",
                  marginBottom: "6px",
                },
              },
              "FSC Code",
            ),
            hS("input", {
              value: fscFilter,
              onChange: (e) => setFscFilter(e.target.value),
              onKeyDown: (e) => e.key === "Enter" && doSearch(),
              placeholder: "e.g. 6515, 5305…",
              style: {
                width: "100%",
                padding: "10px 12px",
                background: "var(--inset-bg)",
                border: "1px solid rgba(201,168,76,.2)",
                color: "var(--alabaster)",
                fontFamily: "JetBrains Mono,monospace",
                fontSize: "13px",
                outline: "none",
              },
            }),
          ),
          hS(
            "div",
            null,
            hS(
              "div",
              {
                style: {
                  fontFamily: "Cinzel,serif",
                  fontSize: "9px",
                  letterSpacing: ".18em",
                  textTransform: "uppercase",
                  color: "var(--gold-dim)",
                  marginBottom: "6px",
                },
              },
              "Part Number",
            ),
            hS("input", {
              value: partInput,
              onChange: (e) => setPartInput(e.target.value),
              onKeyDown: (e) => e.key === "Enter" && doSearch(),
              placeholder: "e.g. MDS093945, MS21250-06",
              style: {
                width: "100%",
                padding: "10px 12px",
                background: "var(--inset-bg)",
                border: "1px solid rgba(201,168,76,.2)",
                color: "var(--alabaster)",
                fontFamily: "JetBrains Mono,monospace",
                fontSize: "13px",
                outline: "none",
              },
            }),
          ),
          hS(
            "button",
            {
              className: "btn btn-primary",
              onClick: () => doSearch(),
              style: {
                padding: "10px 28px",
                fontSize: "11px",
                whiteSpace: "nowrap",
              },
            },
            hS("span", { className: "glint" }),
            "Search",
          ),
        ),
        hS(
          "div",
          {
            style: {
              marginTop: "14px",
              display: "flex",
              gap: "6px",
              flexWrap: "wrap",
            },
          },
          hS(
            "span",
            {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: "8px",
                letterSpacing: ".12em",
                textTransform: "uppercase",
                color: "var(--gold-dim)",
                alignSelf: "center",
                marginRight: "4px",
              },
            },
            "Quick FSC:",
          ),
          ...topFSCs.map((f) =>
            hS(
              "button",
              {
                key: f,
                onClick: () => {
                  setFscFilter(f);
                  doSearch(query, f, partInput);
                },
                style: {
                  fontFamily: "Cinzel,serif",
                  fontSize: "8px",
                  letterSpacing: ".1em",
                  padding: "4px 10px",
                  background:
                    fscFilter === f ? "rgba(201,168,76,.15)" : "transparent",
                  border:
                    "1px solid " +
                    (fscFilter === f
                      ? "rgba(201,168,76,.5)"
                      : "rgba(201,168,76,.15)"),
                  color:
                    fscFilter === f
                      ? "var(--gold-solid)"
                      : "rgba(201,168,76,.5)",
                  cursor: "pointer",
                  transition: "all .15s",
                },
              },
              f,
            ),
          ),
        ),
      ),

      // Prior vendor intel
      nsnIntel.length > 0 &&
        hS(
          "div",
          {
            style: {
              marginBottom: "20px",
              background: "rgba(61,214,140,.04)",
              border: "1px solid rgba(61,214,140,.2)",
              borderTop: "2px solid #3dd68c",
              padding: "16px 20px",
            },
          },
          hS(
            "div",
            {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: "9px",
                letterSpacing: ".2em",
                textTransform: "uppercase",
                color: "var(--accent-green)",
                marginBottom: "12px",
              },
            },
            "★ Prior Vendor Intel — " + (nsnIntel[0]?.nsn || ""),
          ),
          hS(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: "8px" } },
            ...nsnIntel.map((e, i) => {
              const ss = VI_STATUS_STYLE[e.status] || VI_STATUS_STYLE.pending;
              return hS(
                "div",
                {
                  key: e.id,
                  style: {
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    flexWrap: "wrap",
                    padding: "8px 12px",
                    background: "var(--inset-bg)",
                    borderLeft:
                      "3px solid " +
                      (i === 0 ? "#3dd68c" : "rgba(201,168,76,.2)"),
                  },
                },
                hS(
                  "span",
                  {
                    style: {
                      fontFamily: "Cinzel,serif",
                      fontSize: "13px",
                      color: "var(--gold-solid)",
                      minWidth: "140px",
                    },
                  },
                  e.vendor_name,
                ),
                e.part_number &&
                  hS(
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
                  hS(
                    "span",
                    {
                      style: {
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "13px",
                        fontWeight: "700",
                        background:
                          "linear-gradient(to bottom,#cf972d,#f9f295)",
                        WebkitBackgroundClip: "text",
                        WebkitTextFillColor: "transparent",
                      },
                    },
                    "$" + parseFloat(e.unit_price).toFixed(2) + "/ea",
                  ),
                hS(
                  "span",
                  {
                    style: {
                      fontFamily: "Cinzel,serif",
                      fontSize: "8px",
                      letterSpacing: ".08em",
                      textTransform: "uppercase",
                      padding: "2px 8px",
                      borderRadius: "2px",
                      background: ss.bg,
                      border: "1px solid " + ss.border,
                      color: ss.color,
                    },
                  },
                  e.status,
                ),
                e.notes &&
                  hS(
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
              );
            }),
          ),
        ),

      // Results grid
      searched &&
        hS(
          "div",
          null,
          hS(
            "div",
            {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: "10px",
                letterSpacing: ".2em",
                textTransform: "uppercase",
                color: "var(--gold-dim)",
                marginBottom: "14px",
              },
            },
            results.length +
              " Distributors Matched" +
              (fscFilter
                ? " · FSC " +
                  fscFilter +
                  " — " +
                  (FSC_LANES_MAP[String(fscFilter)] || "")
                : ""),
          ),
          results.length === 0 &&
            hS(
              "div",
              {
                style: {
                  padding: "24px",
                  border: "1px solid rgba(201,168,76,.1)",
                  background: "var(--inset-bg)",
                  fontFamily: "Cormorant Garamond,serif",
                  fontSize: "15px",
                  fontStyle: "italic",
                  color: "var(--body-faint)",
                },
              },
              "No distributor matches found. Try entering an FSC code, a part number prefix (e.g. MS, MDS, AN), or a distributor name keyword.",
            ),
          hS(
            "div",
            {
              style: {
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))",
                gap: "12px",
              },
            },
            ...results.map((d) =>
              hS(
                "div",
                {
                  key: d.id,
                  style: {
                    background: "var(--surface-sheen)",
                    border: "1px solid rgba(201,168,76,.18)",
                    borderTop:
                      "2px solid " +
                      (d.confidence >= 75
                        ? "rgba(201,168,76,.6)"
                        : d.confidence >= 45
                          ? "rgba(201,168,76,.35)"
                          : "rgba(201,168,76,.15)"),
                    padding: "16px 18px",
                    position: "relative",
                    overflow: "hidden",
                    transition: "all .2s",
                  },
                },
                hS(
                  "div",
                  {
                    style: {
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      marginBottom: "8px",
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
                          fontSize: "14px",
                          letterSpacing: ".08em",
                          color: "var(--gold-solid)",
                          marginBottom: "3px",
                        },
                      },
                      d.name,
                    ),
                    hS(
                      "div",
                      {
                        style: {
                          fontFamily: "JetBrains Mono,monospace",
                          fontSize: "9px",
                          color: "var(--body-faint)",
                        },
                      },
                      d.id,
                    ),
                  ),
                  hS(
                    "div",
                    {
                      style: {
                        display: "flex",
                        gap: "5px",
                        flexWrap: "wrap",
                        justifyContent: "flex-end",
                      },
                    },
                    hS(
                      "span",
                      {
                        style: {
                          fontFamily: "Cinzel,serif",
                          fontSize: "7px",
                          letterSpacing: ".1em",
                          padding: "2px 6px",
                          background: "rgba(201,168,76,.1)",
                          border: "1px solid rgba(201,168,76,.2)",
                          color: "var(--gold-dim)",
                        },
                      },
                      "T" + d.tier,
                    ),
                    hS(
                      "span",
                      {
                        style: {
                          fontFamily: "Cinzel,serif",
                          fontSize: "7px",
                          letterSpacing: ".1em",
                          padding: "2px 6px",
                          background: "var(--inset-bg)",
                          border: "1px solid rgba(201,168,76,.1)",
                          color:
                            d.friction === "low"
                              ? "#3dd68c"
                              : d.friction === "medium"
                                ? "#f5c542"
                                : "#ff6b7a",
                        },
                      },
                      d.friction,
                    ),
                    hS(
                      "span",
                      {
                        style: {
                          fontFamily: "Cinzel,serif",
                          fontSize: "11px",
                          fontWeight: "700",
                          padding: "2px 8px",
                          background:
                            d.confidence >= 75
                              ? "rgba(201,168,76,.18)"
                              : d.confidence >= 45
                                ? "rgba(201,168,76,.10)"
                                : "rgba(201,168,76,.05)",
                          border: "1px solid rgba(201,168,76,.3)",
                          color: "var(--gold-solid)",
                          letterSpacing: ".04em",
                        },
                      },
                      d.confidence + "%",
                    ),
                  ),
                ),
                d.tags &&
                  d.tags.length > 0 &&
                  hS(
                    "div",
                    {
                      style: {
                        display: "flex",
                        gap: "4px",
                        flexWrap: "wrap",
                        marginBottom: "10px",
                      },
                    },
                    ...d.tags.slice(0, 5).map((t) =>
                      hS(
                        "span",
                        {
                          key: t,
                          style: {
                            fontFamily: "JetBrains Mono,monospace",
                            fontSize: "8px",
                            padding: "2px 6px",
                            background: "var(--inset-bg)",
                            border: "1px solid rgba(201,168,76,.08)",
                            color: "var(--body-color)",
                            borderRadius: "2px",
                          },
                        },
                        t,
                      ),
                    ),
                  ),
                hS(
                  "div",
                  { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
                  hS(
                    "a",
                    {
                      href:
                        d.search_url +
                        (query
                          ? encodeURIComponent(query)
                          : fscFilter
                            ? encodeURIComponent(fscFilter)
                            : ""),
                      target: "_blank",
                      style: {
                        fontFamily: "Cinzel,serif",
                        fontSize: "8px",
                        letterSpacing: ".08em",
                        textTransform: "uppercase",
                        padding: "6px 14px",
                        background: "var(--gold-gradient)",
                        color: "var(--body-color)",
                        border: "none",
                        cursor: "pointer",
                        textDecoration: "none",
                        borderRadius: "2px",
                        fontWeight: "700",
                      },
                    },
                    "Search ↗",
                  ),
                  d.website &&
                    hS(
                      "a",
                      {
                        href: "https://" + d.website,
                        target: "_blank",
                        style: {
                          fontFamily: "Cinzel,serif",
                          fontSize: "8px",
                          letterSpacing: ".08em",
                          textTransform: "uppercase",
                          padding: "6px 14px",
                          background: "var(--surface-sheen)",
                          border: "1px solid rgba(201,168,76,.3)",
                          color: "var(--gold-solid)",
                          cursor: "pointer",
                          textDecoration: "none",
                          borderRadius: "2px",
                        },
                      },
                      "Website",
                    ),
                ),
              ),
            ),
          ),
        ),

      // Empty state
      !searched &&
        hS(
          "div",
          { style: { textAlign: "center", padding: "60px 24px" } },
          hS(
            "div",
            {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: "40px",
                opacity: 0.1,
                background: "linear-gradient(to bottom,#cf972d,#f9f295)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                marginBottom: "16px",
              },
            },
            "◈",
          ),
          hS(
            "div",
            {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: "16px",
                color: "var(--gold-dim)",
                marginBottom: "8px",
              },
            },
            "120 Distributors Ready",
          ),
          hS(
            "div",
            {
              style: {
                fontFamily: "Cormorant Garamond,serif",
                fontSize: "15px",
                color: "var(--body-faint)",
                maxWidth: "400px",
                margin: "0 auto",
              },
            },
            "Enter an FSC code, part number, or distributor name — or click a quick FSC chip to see ranked matches.",
          ),
        ),
    );
  }

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.SourceTab = SourceTab;
  window.SCC_TABS.DrawerSourcePanel = DrawerSourcePanel;
  window.SCC_TABS.VI_STATUS_STYLE = VI_STATUS_STYLE;
  window.SCC_TABS.isBlocked = isBlocked;
})();
