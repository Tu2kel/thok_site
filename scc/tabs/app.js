(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — APP ROOT
  //  Pre-compiled React · No Babel · No JSX
  //  All modules loaded via index.html script tags before this file.
  // ═══════════════════════════════════════════════════════════════════════

  const {
    createElement: hA,
    useState,
    useEffect,
    useCallback,
    Fragment: AFrag,
  } = React;

  // ── TOAST ────────────────────────────────────────────────────────────
  function Toast({ msg, err }) {
    return hA(
      "div",
      {
        className: "toast show",
        style: {
          borderColor: err ? "#e74c3c" : "rgba(201,168,76,.45)",
          color: err ? "#e74c3c" : "#C9A84C",
        },
      },
      msg,
    );
  }

  // ── ARCHIVE TAB ──────────────────────────────────────────────────────
  function ArchiveTab({ showToast, onRestored }) {
    const { dbGetArchive, dbRestoreFromArchive, dbDeleteFromArchive } =
      window.SCC_DB;
    const { fmt, TIER_MARGINS, calcBidMath } = window.SCC_MATH;

    const [rows, setRows] = useState([]);
    const [search, setSearch] = useState("");

    useEffect(() => {
      dbGetArchive().then(setRows);
    }, []);

    const handleRestore = async (sol_number) => {
      if (!confirm("Restore " + sol_number + " to active pipeline?")) return;
      await dbRestoreFromArchive(sol_number);
      setRows((r) => r.filter((x) => x.sol_number !== sol_number));
      showToast(sol_number + " restored to pipeline");
      if (onRestored) onRestored();
    };

    const handleDelete = async (sol_number) => {
      if (
        !confirm(
          "Permanently delete " +
            sol_number +
            " from archive?\n\nThis cannot be undone.",
        )
      )
        return;
      await dbDeleteFromArchive(sol_number);
      setRows((r) => r.filter((x) => x.sol_number !== sol_number));
      showToast(sol_number + " permanently deleted");
    };

    const filtered = rows.filter((r) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        (r.sol_number || "").toLowerCase().includes(q) ||
        (r.item_name || "").toLowerCase().includes(q) ||
        (r.nsn || "").includes(q) ||
        (r.fsc || "").includes(q) ||
        (r.ref_part_number || "").toLowerCase().includes(q)
      );
    });

    return hA(
      "div",
      { style: { animation: "fadeUp .5s ease both" } },

      // ── Header ──
      hA(
        "div",
        { className: "pipe-header" },
        hA(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: "4px" } },
          hA("div", { className: "pipe-title" }, "Archive"),
          hA(
            "div",
            {
              style: {
                fontFamily: "Cormorant Garamond,serif",
                fontSize: "14px",
                fontStyle: "italic",
                color: "var(--body-faint)",
              },
            },
            "Expired & closed solicitations — intel preserved, NSN data permanent",
          ),
        ),
        hA(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "12px" } },
          hA("input", {
            value: search,
            onChange: (e) => setSearch(e.target.value),
            placeholder: "Search sol #, item, NSN, FSC, part…",
            style: {
              padding: "8px 14px",
              background: "var(--inset-bg)",
              border: "1px solid rgba(201,168,76,.2)",
              color: "var(--alabaster)",
              fontFamily: "JetBrains Mono,monospace",
              fontSize: "12px",
              outline: "none",
              width: "280px",
              letterSpacing: ".04em",
            },
          }),
          hA(
            "div",
            {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: "10px",
                letterSpacing: ".14em",
                color: "var(--gold-dim)",
                textTransform: "uppercase",
                padding: "6px 14px",
                border: "1px solid rgba(201,168,76,.12)",
                background: "rgba(201,168,76,.04)",
              },
            },
            filtered.length + " record" + (filtered.length !== 1 ? "s" : ""),
          ),
        ),
      ),

      // ── Empty state ──
      filtered.length === 0 &&
        hA(
          "div",
          { className: "empty" },
          rows.length === 0
            ? "No archived solicitations yet — use ⬇ Arc on any pipeline row to preserve it here."
            : 'No records match "' + search + '".',
        ),

      // ── Archive table ──
      filtered.length > 0 &&
        hA(
          "div",
          { className: "tbl-wrap" },
          hA(
            "table",
            null,
            hA(
              "thead",
              null,
              hA(
                "tr",
                null,
                hA("th", null, "Sol Number"),
                hA("th", null, "Item"),
                hA("th", null, "NSN"),
                hA("th", null, "FSC"),
                hA("th", null, "Part #"),
                hA("th", null, "Qty"),
                hA("th", null, "Gov Ref $"),
                hA("th", null, "Ext Price"),
                hA("th", null, "Est Net $"),
                hA("th", null, "Quote Due"),
                hA("th", null, "Archived"),
                hA("th", null, "Reason"),
                hA("th", null, "Notes"),
                hA("th", null, "Actions"),
              ),
            ),
            hA(
              "tbody",
              null,
              ...filtered.map((r) => {
                const qty = parseFloat(r.quantity) || 1;
                const govUnit = parseFloat(r.unit_price) || 0;
                const tier = r.tier || "Standard";
                const costUnit = r.supplier_quote_price
                  ? parseFloat(r.supplier_quote_price)
                  : govUnit * 0.7;
                const m = calcBidMath(
                  costUnit,
                  qty,
                  TIER_MARGINS[tier] || 0.3,
                  0,
                  0,
                  0,
                );

                return hA(
                  "tr",
                  {
                    key: r.sol_number,
                    style: { opacity: ".72", transition: "opacity .15s" },
                    onMouseEnter: (e) => (e.currentTarget.style.opacity = "1"),
                    onMouseLeave: (e) =>
                      (e.currentTarget.style.opacity = ".72"),
                  },
                  hA(
                    "td",
                    null,
                    hA("span", { className: "sol-link" }, r.sol_number || "—"),
                  ),
                  hA(
                    "td",
                    { className: "iname" },
                    r.item_name || r.item_name_ai || "—",
                  ),
                  hA("td", null, r.nsn || "—"),
                  hA("td", null, r.fsc || "—"),
                  hA(
                    "td",
                    null,
                    r.ref_part_number
                      ? hA(
                          "span",
                          {
                            style: {
                              fontFamily: "JetBrains Mono,monospace",
                              fontSize: "11px",
                              color: "var(--accent-green-bright)",
                            },
                          },
                          r.ref_part_number,
                        )
                      : hA(
                          "span",
                          { style: { color: "var(--body-faint)" } },
                          "—",
                        ),
                  ),
                  hA(
                    "td",
                    null,
                    (r.quantity || "—") +
                      (r.unit_of_issue ? " " + r.unit_of_issue : ""),
                  ),
                  hA(
                    "td",
                    null,
                    hA(
                      "span",
                      { style: { color: "var(--body-dim)" } },
                      fmt(r.unit_price),
                    ),
                    r.price_is_hist &&
                      hA(
                        "span",
                        {
                          style: {
                            fontSize: "10px",
                            display: "block",
                            color: "var(--body-faint)",
                          },
                        },
                        "hist.",
                      ),
                  ),
                  hA(
                    "td",
                    {
                      style: {
                        color: "var(--accent-yellow)",
                        fontWeight: "600",
                      },
                    },
                    fmt(govUnit * qty),
                    hA(
                      "span",
                      {
                        style: {
                          fontSize: "10px",
                          display: "block",
                          color: "var(--accent-yellow-dim)",
                          letterSpacing: ".04em",
                        },
                      },
                      "ext",
                    ),
                  ),
                  hA(
                    "td",
                    {
                      style: {
                        color: "var(--accent-green)",
                        fontWeight: "700",
                      },
                    },
                    fmt(m.net),
                  ),
                  hA(
                    "td",
                    null,
                    hA(
                      "div",
                      {
                        style: {
                          fontFamily: "JetBrains Mono,monospace",
                          fontSize: "12px",
                          color: "var(--body-dim)",
                        },
                      },
                      r.quote_due || "—",
                    ),
                  ),
                  hA(
                    "td",
                    null,
                    hA(
                      "div",
                      {
                        style: {
                          fontFamily: "JetBrains Mono,monospace",
                          fontSize: "11px",
                          color: "var(--gold-dim)",
                        },
                      },
                      r.archive_date || "—",
                    ),
                  ),
                  hA(
                    "td",
                    null,
                    hA(
                      "span",
                      {
                        style: {
                          fontFamily: "Cinzel,serif",
                          fontSize: "8px",
                          letterSpacing: ".1em",
                          textTransform: "uppercase",
                          padding: "2px 7px",
                          border: "1px solid rgba(201,168,76,.2)",
                          color: "var(--gold-dim)",
                          background: "rgba(201,168,76,.04)",
                        },
                      },
                      r.archive_reason || "expired",
                    ),
                  ),
                  hA(
                    "td",
                    {
                      style: {
                        maxWidth: "180px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        fontFamily: "Cormorant Garamond,serif",
                        fontSize: "12px",
                        fontStyle: "italic",
                        color: "var(--body-faint)",
                      },
                    },
                    r.win_loss_reason || r.notes || "—",
                  ),
                  hA(
                    "td",
                    null,
                    hA(
                      "div",
                      {
                        style: {
                          display: "flex",
                          gap: "6px",
                          alignItems: "center",
                        },
                      },
                      hA(
                        "button",
                        {
                          onClick: () => handleRestore(r.sol_number),
                          title: "Restore to active pipeline",
                          style: {
                            background: "transparent",
                            border: "1px solid rgba(61,214,140,.35)",
                            color: "var(--accent-green)",
                            fontFamily: "Cinzel,serif",
                            fontSize: "10px",
                            letterSpacing: ".06em",
                            padding: "4px 8px",
                            cursor: "pointer",
                            transition: "all .2s",
                            whiteSpace: "nowrap",
                          },
                          onMouseEnter: (e) => {
                            e.target.style.background = "rgba(61,214,140,.1)";
                            e.target.style.color = "#3ddc84";
                          },
                          onMouseLeave: (e) => {
                            e.target.style.background = "transparent";
                            e.target.style.color = "rgba(61,214,140,.7)";
                          },
                        },
                        "↑ Restore",
                      ),
                      hA(
                        "button",
                        {
                          className: "del-btn",
                          onClick: () => handleDelete(r.sol_number),
                          title: "Permanently delete",
                        },
                        "✕",
                      ),
                    ),
                  ),
                );
              }),
            ),
          ),
        ),
    );
  }

  // ── APP ROOT ─────────────────────────────────────────────────────────
  function App() {
    const { dbSave, dbGetAll, dbDelete, exportAllData, importAllData } =
      window.SCC_DB;
    const { isListing, parseListing, parseAIText } = window.SCC_PARSER;
    const { calcPricing } = window.SCC_MATH;
    const {
      DashboardTab,
      IntakeTab,
      PipelineTab,
      SourceTab,
      RFQTab,
      AwardsTab,
      MemoTab,
      FUTab,
      EsbdTab,
      LHFCheckTab,
    } = window.SCC_TABS;

    const [tab, setTab] = useState(
      () => localStorage.getItem("scc-active-tab") || "dashboard",
    );
    const [openGroup, setOpenGroup] = useState("workflow");
    const [boxA, setBoxA] = useState("");
    const [boxB, setBoxB] = useState("");
    const [parsed, setParsed] = useState(null);
    const [rows, setRows] = useState([]);
    const [filter, setFilter] = useState(
      () => localStorage.getItem("scc-pipeline-filter") || "All",
    );
    const [toast, setToast] = useState(null);
    const [openDrawer, setOpenDrawer] = useState(
      () => localStorage.getItem("scc-open-drawer") || null,
    );
    const [oopSet, setOopSet] = useState(new Set());
    const [sourcePreload, setSourcePreload] = useState(null);
    const [awardPrefill, setAwardPrefill] = useState(null);
    const [fuPrefill, setFuPrefill] = useState(null);
    const [highlightSol, setHighlightSol] = useState(null);

    const goPipeline = (sol_number) => {
      setFilter("All"); // ensure sol is visible regardless of active filter
      setHighlightSol(sol_number);
      setTab("pipeline");
    };
    const [theme, setTheme] = useState(
      () => localStorage.getItem("scc-theme") || "dark",
    );

    // Apply theme to <html> and persist
    useEffect(() => {
      document.documentElement.setAttribute("data-theme", theme);
      localStorage.setItem("scc-theme", theme);
    }, [theme]);

    useEffect(() => {
      localStorage.setItem("scc-active-tab", tab);
    }, [tab]);
    useEffect(() => {
      localStorage.setItem("scc-pipeline-filter", filter);
    }, [filter]);
    useEffect(() => {
      if (openDrawer) localStorage.setItem("scc-open-drawer", openDrawer);
      else localStorage.removeItem("scc-open-drawer");
    }, [openDrawer]);

    // 3-way cycle: dark (Imperial Red) → metallic → light (Ivory)
    const toggleTheme = () =>
      setTheme((t) =>
        t === "dark" ? "metallic" : t === "metallic" ? "light" : "dark",
      );

    const goSource = (r) => {
      setSourcePreload({
        nsn: r.nsn || "",
        fsc: r.fsc || "",
        part: r.ref_part_number || "",
      });
      setTab("source");
    };

    const goAward = (r) => {
      setAwardPrefill(r);
      setTab("awards");
    };

    const goFU = (r) => {
      setFuPrefill({
        sol: r.sol_number || "",
        nsn: r.nsn || "",
        item: r.item_name || "",
        qty: r.quantity || "",
        due: r.quote_due || "",
        delivery: r.delivery_days || "30",
        shipTo: r.ship_to || "",
      });
      setTab("fu");
    };

    const goEsbdAward = (bid) => {
      const prices = (bid.suppliers || [])
        .map((s) => ({
          price: parseFloat(s.unit_price),
          name: s.name,
          cage: s.cage || "",
        }))
        .filter((s) => s.price > 0);
      const best = prices.length
        ? prices.reduce((a, b) => (a.price < b.price ? a : b))
        : null;
      setAwardPrefill({
        sol_number: bid.sol_id || "",
        item_name: bid.title || "",
        quantity: bid.qty || "",
        unit_of_issue: bid.uom || "EA",
        unit_price: bid.bid_unit_price || "",
        bid_price: bid.bid_unit_price || "",
        fob: bid.fob || "Destination",
        ship_to: bid.delivery_addr || "",
        ref_part_number: bid.mfr_pn || "",
        supplier_name: best ? best.name : "",
        supplier_quote_price: best ? String(best.price) : "",
        funding_path: parseFloat(bid.bid_total) >= 10000 ? "factoring" : "self",
        source: bid.source || "esbd",
        esbd_id: bid.id || "",
        nigp_code: bid.nigp_code || "",
        naics_code: bid.naics_code || "",
        set_aside: bid.set_aside || "",
        agency: bid.agency || "",
        contact_name: bid.contact_name || "",
        contact_email: bid.contact_email || "",
      });
      setTab("awards");
    };

    useEffect(() => {
      setOopSet((prev) => {
        const n = new Set(prev);
        rows.forEach((r) => {
          if (!n.has("__removed__" + r.sol_number)) n.add(r.sol_number);
        });
        return n;
      });
    }, [rows]);

    const toggleOop = (sol) =>
      setOopSet((prev) => {
        const n = new Set(prev);
        if (n.has(sol)) {
          n.delete(sol);
          n.add("__removed__" + sol);
        } else {
          n.delete("__removed__" + sol);
          n.add(sol);
        }
        return n;
      });

    const showToast = (msg, err = false) => {
      setToast({ msg, err });
      setTimeout(() => setToast(null), 3000);
    };

    const loadPipeline = useCallback(async () => {
      const all = await dbGetAll();
      all.sort((a, b) => (a.quote_due || "").localeCompare(b.quote_due || ""));
      setRows(all);
    }, []);

    useEffect(() => {
      if (tab === "pipeline" || tab === "dashboard") loadPipeline();
      // Show THOK watermark only on dashboard
      const wm = document.getElementById("thok-watermark");
      if (wm) wm.style.display = tab === "dashboard" ? "block" : "none";
    }, [tab, loadPipeline]);

    const handleParse = () => {
      if (!boxA.trim() && !boxB.trim()) {
        showToast("Paste at least one input", true);
        return;
      }
      let listingText = "",
        aiText = "";
      if (isListing(boxA)) {
        listingText = boxA;
        aiText = boxB;
      } else if (isListing(boxB)) {
        listingText = boxB;
        aiText = boxA;
      } else {
        listingText = boxA;
        aiText = boxB;
      }
      // Run both parsers on both inputs, then merge:
      // listing parse wins; AI fills only missing/null fields.
      // If only one box has content, run both parsers on it.
      let data = listingText ? parseListing(listingText) : {};
      const aiSrc = aiText.trim() || listingText;
      if (aiSrc) {
        const ai = parseAIText(aiSrc);
        Object.entries(ai).forEach(([k, v]) => {
          if (v !== null && v !== undefined && v !== "" && !data[k])
            data[k] = v;
        });
      }
      if (data.unit_price && data.quote_due) {
        const pricing = calcPricing(
          data.unit_price,
          data.quote_due,
          data.posted_date,
        );
        data = { ...data, ...pricing };
      }
      setParsed(data);
    };

    const handleClear = () => {
      setBoxA("");
      setBoxB("");
      setParsed(null);
    };

    const handleSave = async () => {
      if (!parsed?.sol_number) {
        showToast("Sol number missing — cannot save", true);
        return;
      }
      await dbSave({
        ...parsed,
        status: "New",
        date_added: new Date().toLocaleDateString(),
        notes: "",
        // Pre-seed supplier intel drawer from parsed ref supplier
        supplier_poc: parsed.ref_supplier || "",
        supplier_moq: "",
        supplier_website: "",
        supplier_phone: "",
        supplier_email: "",
        supplier_quote_price: "",
        supplier_quote_date: "",
        supplier_quote_expires: "",
        supplier_lead_time: "",
      });
      showToast(parsed.sol_number + " saved to pipeline");
      setBoxA("");
      setBoxB("");
      setParsed(null);
    };

    return hA(
      AFrag,
      null,

      // ── NAV ──
      hA(
        "nav",
        null,
        hA(
          "div",
          null,
          hA(
            "div",
            { className: "brand gold-text" },
            "IMPERIO · SUPPLY CHAIN COMMAND",
          ),
          hA(
            "div",
            { className: "brand-sub" },
            "CAGE 152U4 · DLA Supplier Intelligence",
          ),
        ),

        // ── THEME TOGGLE ──
        hA(
          "button",
          {
            className: "theme-toggle-btn",
            onClick: toggleTheme,
            title:
              theme === "dark"
                ? "Switch to Metallic Dark"
                : theme === "metallic"
                  ? "Switch to Ivory Imperial"
                  : "Switch to Imperial Red",
            "aria-label": "Toggle theme",
          },
          hA(
            "span",
            { className: "toggle-label" },
            theme === "dark"
              ? "Imperial"
              : theme === "metallic"
                ? "Metallic"
                : "Ivory",
          ),
          hA(
            "div",
            { className: "toggle-track" },
            hA("span", { className: "toggle-icon toggle-icon-moon" }, "☽"),
            hA("span", { className: "toggle-icon toggle-icon-sun" }, "✦"),
            hA("div", { className: "toggle-thumb" }),
          ),
          hA(
            "span",
            { className: "toggle-label" },
            theme === "dark" ? "Red" : theme === "metallic" ? "Dark" : "Light",
          ),
        ),

        hA(
          "div",
          {
            className: "tabs",
            style: {
              display: "flex",
              alignItems: "center",
              gap: "1px",
              flexWrap: "nowrap",
              overflow: "visible",
            },
          },

          // ── TAB GROUPS DATA ──
          ...(() => {
            const GROUPS = [
              {
                id: "workflow",
                label: "Workflow",
                tabs: [
                  { id: "dashboard", label: "Dashboard", icon: "" },
                  { id: "intake", label: "Intake", icon: "" },
                  { id: "pipeline", label: "Pipeline", icon: "" },
                  { id: "source", label: "Source", icon: "◆ " },
                  { id: "rfq", label: "RFQ", icon: "⚡ " },
                  { id: "fu", label: "Follow-Up", icon: "✉ " },
                  { id: "esbd", label: "State/Fed", icon: "🏛 " },
                ],
              },
              {
                id: "intel",
                label: "Intel",
                tabs: [
                  { id: "awards", label: "Awards", icon: "🏆 " },
                  { id: "lhf", label: "LHF Check", icon: "◈ " },
                  { id: "lanelookup", label: "Lane Lookup", icon: "⬡ " },
                ],
              },
              {
                id: "admin",
                label: "Admin",
                tabs: [
                  { id: "rolodex", label: "Rolodex", icon: "☎ " },
                  { id: "memo", label: "Memo", icon: "📄 " },
                  { id: "archive", label: "Archive", icon: "⬇ " },
                  { id: "backup", label: "Backup", icon: "↓ " },
                ],
              },
            ];

            const chevronBase = {
              display: "flex",
              alignItems: "center",
              height: "32px",
              border: "none",
              outline: "none",
              cursor: "pointer",
              fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
              fontSize: "10px",
              letterSpacing: "0.05em",
              whiteSpace: "nowrap",
              flexShrink: 0,
            };

            const redBase =
              "linear-gradient(180deg,#5a0010 0%,#3a0008 50%,#4a000e 100%)";
            const redActive = "linear-gradient(180deg,#3a0008 0%,#1e0004 100%)";
            const redHover =
              "linear-gradient(180deg,#6e0015 0%,#4a000c 50%,#5c0012 100%)";

            const nodes = [];

            GROUPS.forEach((group, gi) => {
              const isOpen = openGroup === group.id;

              // ── GROUP HEADER ──
              nodes.push(
                hA(
                  "button",
                  {
                    key: "grp-" + group.id,
                    onClick: () => setOpenGroup(isOpen ? null : group.id),
                    style: {
                      ...chevronBase,
                      padding: "0 18px 0 14px",
                      clipPath:
                        "polygon(0 0,calc(100% - 9px) 0,100% 50%,calc(100% - 9px) 100%,0 100%)",
                      background: isOpen ? redActive : redBase,
                      color: isOpen
                        ? "var(--gold-solid)"
                        : "rgba(245,240,232,0.5)",
                      fontFamily: "Cinzel,serif",
                      fontSize: "9px",
                      letterSpacing: "0.15em",
                      textTransform: "uppercase",
                      fontWeight: isOpen ? "700" : "400",
                      marginRight: "1px",
                      gap: "6px",
                      transition: "background 0.12s,color 0.12s",
                    },
                    onMouseEnter: (e) => {
                      if (!isOpen) e.currentTarget.style.background = redHover;
                    },
                    onMouseLeave: (e) => {
                      if (!isOpen) e.currentTarget.style.background = redBase;
                    },
                  },
                  group.label,
                  hA(
                    "span",
                    {
                      style: {
                        fontSize: "8px",
                        opacity: 0.7,
                        display: "inline-block",
                        transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                        transition: "transform 0.15s",
                      },
                    },
                    "▶",
                  ),
                ),
              );

              // ── CHILD TABS (only when open) ──
              if (isOpen) {
                group.tabs.forEach((t, i, arr) => {
                  const isActive = tab === t.id;
                  const isFirst = i === 0;
                  const isLast = i === arr.length - 1;
                  const activeColor =
                    group.id === "workflow" ? "var(--gold-solid)" : "#F5F0E8";
                  const isBackup = t.id === "backup";

                  nodes.push(
                    hA(
                      "button",
                      {
                        key: t.id,
                        onClick: isBackup
                          ? exportAllData
                          : () => {
                              setTab(t.id);
                            },
                        title: isBackup ? "Export full backup" : undefined,
                        style: {
                          ...chevronBase,
                          padding: isFirst ? "0 16px 0 14px" : "0 16px 0 22px",
                          clipPath: isFirst
                            ? "polygon(0 0,calc(100% - 9px) 0,100% 50%,calc(100% - 9px) 100%,0 100%)"
                            : isLast
                              ? "polygon(0 0,100% 0,100% 100%,0 100%,9px 50%)"
                              : "polygon(0 0,calc(100% - 9px) 0,100% 50%,calc(100% - 9px) 100%,0 100%,9px 50%)",
                          background: isActive ? redActive : redBase,
                          color: isActive
                            ? activeColor
                            : "rgba(245,240,232,0.45)",
                          fontWeight: isActive ? "700" : "400",
                          marginRight: isLast ? "0" : "1px",
                          transition: "background 0.12s,color 0.12s",
                        },
                        onMouseEnter: (e) => {
                          if (!isActive) {
                            e.currentTarget.style.background = redHover;
                            e.currentTarget.style.color =
                              "rgba(245,240,232,0.8)";
                          }
                        },
                        onMouseLeave: (e) => {
                          if (!isActive) {
                            e.currentTarget.style.background = redBase;
                            e.currentTarget.style.color =
                              "rgba(245,240,232,0.45)";
                          }
                        },
                      },
                      t.icon + t.label,
                    ),
                  );
                });
              }

              // ── DIVIDER between groups ──
              if (gi < GROUPS.length - 1) {
                nodes.push(
                  hA("div", {
                    key: "div-" + gi,
                    style: {
                      width: "1px",
                      height: "32px",
                      background: "rgba(201,168,76,0.2)",
                      flexShrink: 0,
                      margin: "0 6px",
                    },
                  }),
                );
              }
            });

            // ── RESTORE (always visible) ──
            nodes.push(
              hA(
                "label",
                {
                  key: "restore",
                  style: {
                    ...chevronBase,
                    padding: "0 14px",
                    marginLeft: "6px",
                    background: redBase,
                    color: "var(--accent-blue)",
                    clipPath: "none",
                    borderRadius: "3px",
                    cursor: "pointer",
                  },
                  onMouseEnter: (e) => {
                    e.currentTarget.style.background = redHover;
                  },
                  onMouseLeave: (e) => {
                    e.currentTarget.style.background = redBase;
                  },
                },
                "↑ Restore",
                hA("input", {
                  type: "file",
                  accept: ".json",
                  style: { display: "none" },
                  onChange: (e) => {
                    const f = e.target.files[0];
                    if (!f) return;
                    const r = new FileReader();
                    r.onload = (ev) =>
                      importAllData(ev.target.result, (s, v) => {
                        showToast(
                          "Restored " +
                            s +
                            " solicitations + " +
                            v +
                            " vendor intel records",
                        );
                        loadPipeline();
                      });
                    r.readAsText(f);
                    e.target.value = "";
                  },
                }),
              ),
            );

            return nodes;
          })(),
        ),
      ),

      // ── DIVIDER ──
      hA(
        "div",
        { className: "divider", style: { margin: "0" } },
        hA("div", { className: "divider-line" }),
        hA("div", { className: "divider-diamond" }),
        hA("div", { className: "divider-line" }),
      ),

      // ── MAIN ──
      hA(
        "main",
        null,
        tab === "dashboard" && hA(DashboardTab, { rows, goPipeline }),

        tab === "intake" &&
          hA(IntakeTab, {
            boxA,
            setBoxA,
            boxB,
            setBoxB,
            parsed,
            onParse: handleParse,
            onClear: handleClear,
            onSave: handleSave,
          }),

        tab === "pipeline" &&
          hA(PipelineTab, {
            rows,
            setRows,
            filter,
            setFilter,
            openDrawer,
            setOpenDrawer,
            oopSet,
            toggleOop,
            goSource,
            goAward,
            goFU,
            showToast,
            loadPipeline,
            highlightSol,
            setHighlightSol,
          }),

        tab === "source" &&
          hA(SourceTab, {
            preload: sourcePreload,
            onPreloadConsumed: () => setSourcePreload(null),
          }),

        tab === "rfq" && hA(RFQTab, null),

        tab === "archive" &&
          hA(ArchiveTab, {
            showToast,
            onRestored: () => {
              loadPipeline();
              setTab("pipeline");
            },
          }),

        tab === "awards" &&
          hA(AwardsTab, {
            awardPrefill,
            onPrefillConsumed: () => setAwardPrefill(null),
            showToast,
          }),

        tab === "memo" && hA(MemoTab, null),

        tab === "lhf" && hA(LHFCheckTab, { onSendToIntake: null }),

        tab === "esbd" && hA(EsbdTab, { goAward: goEsbdAward }),

        tab === "rolodex" &&
          (window.SCC_TABS && window.SCC_TABS.SupplierRolodexTab
            ? hA(window.SCC_TABS.SupplierRolodexTab, null)
            : hA(
                "div",
                { style: { padding: "20px", color: "var(--body-dim)" } },
                "Rolodex loading...",
              )),

        tab === "lanelookup" &&
          (window.SCC_TABS && window.SCC_TABS.LaneLookupTab
            ? hA(window.SCC_TABS.LaneLookupTab, null)
            : hA(
                "div",
                { style: { padding: "20px", color: "var(--body-dim)" } },
                "Lane Lookup loading...",
              )),

        tab === "fu" &&
          hA(FUTab, {
            prefill: fuPrefill,
            onPrefillConsumed: () => setFuPrefill(null),
            showToast,
          }),
      ),

      // ── TOAST ──
      toast && hA(Toast, { msg: toast.msg, err: toast.err }),
    );
  }

  // ── MOUNT ──
  ReactDOM.createRoot(document.getElementById("root")).render(hA(App, null));
})();
