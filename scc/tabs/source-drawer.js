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

  // ── CAGE phone helpers ────────────────────────────────────────────────
  async function cagePhoneGet(cage) {
    try {
      const res = await fetch("/.netlify/functions/cage-phones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cagePhoneGet", payload: { cage } }),
      });
      const data = await res.json();
      return data.result || null;
    } catch {
      return null;
    }
  }

  async function cagePhoneSave(cage, name, phone) {
    try {
      await fetch("/.netlify/functions/cage-phones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "cagePhoneSave",
          payload: { cage, name, phone },
        }),
      });
    } catch {}
  }

  async function fetchPhoneFromUrl(url) {
    try {
      const res = await fetch("/.netlify/functions/fetch-phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      return data.phone || null;
    } catch {
      return null;
    }
  }

  // ── RFQ URL builder ───────────────────────────────────────────────────
  function buildRfqUrl(
    record,
    vendorName,
    vendorCage,
    vendorPn,
    vendorEmail,
    vendorPhone,
  ) {
    const p = new URLSearchParams();
    if (record.sol_number) p.set("sol", record.sol_number);
    if (record.item_name) p.set("item", record.item_name);
    if (record.nsn) p.set("nsn", record.nsn);
    if (vendorPn || record.ref_part_number)
      p.set("part", vendorPn || record.ref_part_number);
    if (record.qty) p.set("qty", record.qty);
    if (record.unit_issue) p.set("unit", record.unit_issue);
    if (record.delivery_days) p.set("delivery", record.delivery_days);
    if (record.quote_due) p.set("quotedue", record.quote_due);
    // cost ceiling: derive from unit_price (hist) at 27.5% margin — round down
    if (record.unit_price) {
      const ceiling = (parseFloat(record.unit_price) * 0.725).toFixed(2);
      p.set("ceiling", ceiling);
    }
    if (vendorName) p.set("vendor", vendorName);
    if (vendorCage) p.set("cage", vendorCage);
    if (vendorEmail) p.set("email", vendorEmail);
    if (vendorPhone) p.set("phone", vendorPhone);
    return "supplier-rfq-template.html?" + p.toString();
  }

  // ── SUPPLIER CARD (DLA Approved Source) ──────────────────────────────
  function SupplierCard({ s, isBlocked, gsaUrl, record }) {
    const blocked = isBlocked(s.name);
    const [phone, setPhone] = useSourceState(null);
    const [fetchSt, setFetchSt] = useSourceState("idle");

    // On mount — check cage_phones collection
    useSourceEffect(() => {
      cagePhoneGet(s.cage).then((rec) => {
        if (rec && rec.phone) setPhone(rec.phone);
      });
    }, [s.cage]);

    const handleFetch = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      setFetchSt("loading");
      // Open Google search as immediate fallback so user always gets something
      window.open(
        "https://www.google.com/search?q=" +
          encodeURIComponent(s.name + " " + s.cage + " phone number"),
        "_blank",
      );
      // Hit DLA CAGE lookup — real HTML, no auth required
      const dlaUrl =
        "https://cage.dla.mil/Search/CageSearchResults?searchType=cage&cageCode=" +
        encodeURIComponent(s.cage);
      const found = await fetchPhoneFromUrl(dlaUrl);
      if (found) {
        setPhone(found);
        await cagePhoneSave(s.cage, s.name, found);
        setFetchSt("idle");
      } else {
        setFetchSt("fail");
      }
    };

    return hS(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: "4px",
        },
      },
      hS(
        "a",
        {
          href: blocked ? undefined : gsaUrl,
          target: blocked ? undefined : "_blank",
          style: {
            display: "block",
            padding: "10px 12px",
            background: blocked
              ? "rgba(231,76,60,.08)"
              : "rgba(61,214,140,.06)",
            border:
              "1px solid " +
              (blocked ? "rgba(231,76,60,.4)" : "rgba(61,214,140,.25)"),
            borderRadius: "3px",
            textDecoration: "none",
            cursor: blocked ? "default" : "pointer",
            transition: "background .15s",
          },
        },
        hS(
          "div",
          {
            style: {
              fontFamily: "Cinzel,serif",
              fontSize: "9px",
              letterSpacing: ".06em",
              color: blocked ? "var(--accent-red-soft)" : "var(--accent-green)",
              marginBottom: "3px",
              fontWeight: "700",
            },
          },
          s.name,
        ),
        hS(
          "div",
          {
            style: {
              fontFamily: "JetBrains Mono,monospace",
              fontSize: "10px",
              color: "var(--body-faint)",
            },
          },
          "CAGE " + s.cage + " · " + s.pn,
        ),
        !blocked &&
          hS(
            "div",
            {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: "8px",
                letterSpacing: ".08em",
                color: "var(--gold-dim)",
                marginTop: "3px",
              },
            },
            "Search →",
          ),
        blocked &&
          hS(
            "div",
            {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: "8px",
                letterSpacing: ".08em",
                color: "rgba(231,76,60,.7)",
                marginTop: "3px",
              },
            },
            "BLOCKED — do not contact direct",
          ),
      ),
      // ── Phone row ──
      !blocked &&
        hS(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: "5px",
              minHeight: "20px",
            },
          },
          phone
            ? hS(
                "a",
                {
                  href: "tel:" + phone.replace(/\D/g, ""),
                  style: {
                    fontFamily: "JetBrains Mono,monospace",
                    fontSize: "11px",
                    color: "var(--accent-green)",
                    textDecoration: "none",
                    letterSpacing: ".04em",
                    flex: 1,
                  },
                },
                "📞 " + phone,
              )
            : hS(
                "span",
                {
                  style: {
                    fontFamily: "JetBrains Mono,monospace",
                    fontSize: "10px",
                    color: "var(--body-faint)",
                    fontStyle: "italic",
                    flex: 1,
                  },
                },
                fetchSt === "fail" ? "No # found" : "No phone",
              ),
          !phone &&
            hS(
              "button",
              {
                onClick: handleFetch,
                disabled: fetchSt === "loading",
                title: "Find phone for " + s.name,
                style: {
                  padding: "2px 6px",
                  fontSize: "10px",
                  background: "rgba(201,168,76,.12)",
                  border: "1px solid rgba(201,168,76,.3)",
                  color:
                    fetchSt === "loading"
                      ? "var(--gold-dim)"
                      : "var(--gold-solid)",
                  cursor: fetchSt === "loading" ? "wait" : "pointer",
                  borderRadius: "2px",
                  flexShrink: 0,
                },
              },
              fetchSt === "loading" ? "…" : "📞?",
            ),
        ),
      // ── RFQ button ──
      !blocked &&
        record &&
        hS(
          "a",
          {
            href: buildRfqUrl(record, s.name, s.cage, s.pn, "", phone || ""),
            target: "_blank",
            title: "Open RFQ template pre-filled for " + s.name,
            style: {
              display: "block",
              textAlign: "center",
              padding: "4px 8px",
              background: "rgba(201,168,76,.08)",
              border: "1px solid rgba(201,168,76,.25)",
              borderRadius: "3px",
              fontFamily: "Cinzel,serif",
              fontSize: "8px",
              letterSpacing: ".12em",
              textTransform: "uppercase",
              color: "var(--gold-solid)",
              textDecoration: "none",
              cursor: "pointer",
            },
          },
          "📄 Open RFQ",
        ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  CATALOG CHECK PANEL — inject into DrawerSourcePanel above distributor list
  //  Fires catalog-search Netlify function against Zoro, Grainger, MSC in parallel
  //  Surfaces: Primary (best FSC+price fit) · Backup · Benchmark (everybody's first stop)
  //
  //  PASTE THIS BLOCK into source-drawer.js immediately after the
  //  "Quick Search" section (after the SAM.gov button block closes ~line 611)
  //  and before the distributor IIFE that starts (() => { const allDists = ...
  // ═══════════════════════════════════════════════════════════════════════════

  // ── CATALOG CHECK COMPONENT ──────────────────────────────────────────────────
  // Drop this function definition ABOVE the DrawerSourcePanel function definition
  // (around line 296 in source-drawer.js), after the fetchDistPhone helper.

  /*
  INJECT POINT A — function definition (before DrawerSourcePanel):
  ─────────────────────────────────────────────────────────────────
*/

  function CatalogCheckPanel({ record, dists }) {
    const { useState, useEffect, useRef } = React;

    const nsn = (record.nsn || "").replace(/-/g, "");
    const pn = record.ref_part_number || "";
    const unitPrice = parseFloat(record.unit_price) || 0;

    const [status, setStatus] = useState("idle"); // idle | loading | done | error
    const [results, setResults] = useState([]);
    const [routing, setRouting] = useState(null);
    const hasFired = useRef(false);
    const [gsaStatus, setGsaStatus] = useState("idle"); // idle | loading | done | empty | error
    const [gsaResults, setGsaResults] = useState([]);
    const [scoutStatus, setScoutStatus] = useState("idle"); // idle | loading | done | empty | error
    const [scoutData, setScoutData] = useState(null);

    // ── Price-tier routing ────────────────────────────────────────────────────
    // Slot each distributor into Primary / Backup / Benchmark based on min_unit/max_unit
    // and whether benchmark:true is set. Benchmark always goes to slot 3.
    function buildRouting(distList, price) {
      const inRange = distList.filter((d) => {
        const min = d.min_unit != null ? d.min_unit : 0;
        const max = d.max_unit != null ? d.max_unit : Infinity;
        return price >= min && price <= max && !d.benchmark;
      });
      const benchmarks = distList.filter((d) => d.benchmark);
      // Sort in-range by priority (lower = better), then tier
      inRange.sort(
        (a, b) =>
          (a.priority || 9) - (b.priority || 9) ||
          (a.tier || 9) - (b.tier || 9),
      );
      return {
        primary: inRange[0] || null,
        backup: inRange[1] || null,
        benchmark: benchmarks[0] || null,
      };
    }

    // ── Fire catalog search ───────────────────────────────────────────────────
    async function runSearch() {
      if (!nsn && !pn) return;
      setStatus("loading");
      setGsaStatus("idle");
      setGsaResults([]);
      try {
        const res = await fetch("/.netlify/functions/catalog-search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pn: pn || "", nsn: nsn || "" }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Search failed");
        setResults(data.results || []);
        setStatus("done");

        // ── GSA CASCADE — auto-fires when all 3 catalogs return NOT FOUND
        if (data.allNotFound) {
          const mfrName =
            record.suppliers && record.suppliers[0]
              ? record.suppliers[0].name
              : record.item_name || "";
          if (mfrName) {
            setGsaStatus("loading");
            try {
              const gsaRes = await fetch("/.netlify/functions/gsa-search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ manufacturer: mfrName }),
              });
              const gsaData = await gsaRes.json();
              setGsaResults(gsaData.results || []);
              setGsaStatus(gsaData.found ? "done" : "empty");
            } catch {
              setGsaStatus("error");
            }
          }

          // ── SUPPLIER SCOUT — fires in parallel on all-NOT FOUND
          setScoutStatus("loading");
          setScoutData(null);
          try {
            const scoutRes = await fetch("/.netlify/functions/supplier-scout", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                pn: pn || "",
                nsn: nsn || "",
                fsc: record.fsc || "",
                item_name: record.item_name || "",
                approved_sources: (record.suppliers || []).map((s) => s.name),
              }),
            });
            const scoutJson = await scoutRes.json();
            setScoutData(scoutJson);
            setScoutStatus(
              (scoutJson.claude && scoutJson.claude.length) ||
                (scoutJson.web && scoutJson.web.length)
                ? "done"
                : "empty",
            );
          } catch {
            setScoutStatus("error");
          }
        }
      } catch (err) {
        setStatus("error");
      }
    }

    // Auto-fire on mount if NSN or P/N present
    useEffect(() => {
      if (!hasFired.current && (nsn || pn)) {
        hasFired.current = true;
        runSearch();
      }
      // Routing is sync — build from dists whenever they're available
      if (dists && dists.length && unitPrice >= 0) {
        setRouting(buildRouting(dists, unitPrice));
      }
    }, []);

    // ── Styles ────────────────────────────────────────────────────────────────
    const S = {
      section: {
        marginBottom: "18px",
        background: "rgba(0,0,0,.18)",
        border: "1px solid rgba(201,168,76,.12)",
        borderRadius: "4px",
        overflow: "hidden",
      },
      header: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 12px",
        borderBottom: "1px solid rgba(201,168,76,.1)",
        background: "rgba(201,168,76,.04)",
      },
      headerLabel: {
        fontFamily: "Cinzel,serif",
        fontSize: "8px",
        letterSpacing: ".18em",
        textTransform: "uppercase",
        color: "var(--gold-dim)",
      },
      body: {
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      },
      slot: (accent) => ({
        display: "flex",
        flexDirection: "column",
        gap: "3px",
        padding: "8px 10px",
        borderLeft: "3px solid " + accent,
        background: "rgba(0,0,0,.12)",
      }),
      slotLabel: (accent) => ({
        fontFamily: "Cinzel,serif",
        fontSize: "7px",
        letterSpacing: ".18em",
        textTransform: "uppercase",
        color: accent,
        marginBottom: "1px",
      }),
      slotName: {
        fontFamily: "Cinzel,serif",
        fontSize: "10px",
        letterSpacing: ".04em",
        color: "var(--gold-solid)",
      },
      slotMeta: {
        fontFamily: "JetBrains Mono,monospace",
        fontSize: "9px",
        color: "var(--body-faint)",
      },
      resultRow: (found) => ({
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "6px 10px",
        background: found ? "rgba(61,214,140,.04)" : "rgba(0,0,0,.1)",
        border:
          "1px solid " +
          (found ? "rgba(61,214,140,.15)" : "rgba(255,255,255,.05)"),
        borderRadius: "3px",
      }),
      badge: (found) => ({
        fontFamily: "JetBrains Mono,monospace",
        fontSize: "9px",
        padding: "2px 6px",
        borderRadius: "2px",
        background: found ? "rgba(61,214,140,.15)" : "rgba(255,107,122,.1)",
        color: found ? "#3dd68c" : "#ff6b7a",
        flexShrink: 0,
      }),
      price: {
        fontFamily: "JetBrains Mono,monospace",
        fontSize: "11px",
        color: "var(--gold-solid)",
        flexShrink: 0,
      },
      link: {
        fontFamily: "Cinzel,serif",
        fontSize: "8px",
        letterSpacing: ".06em",
        color: "var(--gold-dim)",
        textDecoration: "none",
        marginLeft: "auto",
      },
      supplierName: {
        fontFamily: "Cinzel,serif",
        fontSize: "9px",
        letterSpacing: ".04em",
        color: "var(--body-muted)",
        flex: 1,
      },
      rerunBtn: {
        padding: "2px 8px",
        fontFamily: "Cinzel,serif",
        fontSize: "7px",
        letterSpacing: ".1em",
        background: "transparent",
        border: "1px solid rgba(201,168,76,.25)",
        color: "var(--gold-dim)",
        cursor: "pointer",
        borderRadius: "2px",
      },
    };

    // ── Routing slots ─────────────────────────────────────────────────────────
    const RoutingSlots = () => {
      if (!routing) return null;
      const slots = [
        {
          key: "primary",
          label: "Primary",
          accent: "#3dd68c",
          dist: routing.primary,
        },
        {
          key: "backup",
          label: "Backup",
          accent: "var(--gold-solid)",
          dist: routing.backup,
        },
        {
          key: "benchmark",
          label: "Benchmark — Everyone Goes Here",
          accent: "rgba(160,160,160,.5)",
          dist: routing.benchmark,
        },
      ];
      return hS(
        "div",
        { style: S.section },
        hS(
          "div",
          { style: S.header },
          hS(
            "span",
            { style: S.headerLabel },
            "Sourcing Target — by Price Tier",
          ),
          unitPrice > 0 &&
            hS(
              "span",
              {
                style: {
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "9px",
                  color: "var(--body-faint)",
                },
              },
              "Hist. $" + unitPrice.toFixed(2),
            ),
        ),
        hS(
          "div",
          { style: S.body },
          ...slots.map(({ key, label, accent, dist }) =>
            hS(
              "div",
              { key, style: S.slot(accent) },
              hS("span", { style: S.slotLabel(accent) }, label),
              dist
                ? hS(
                    React.Fragment,
                    null,
                    hS("span", { style: S.slotName }, dist.name),
                    hS(
                      "span",
                      { style: S.slotMeta },
                      [
                        dist.min_unit != null && dist.max_unit != null
                          ? "$" +
                            dist.min_unit +
                            "–$" +
                            dist.max_unit +
                            " range"
                          : null,
                        dist.phone || null,
                        dist.fsc && dist.fsc.includes(record.fsc)
                          ? "FSC " + record.fsc + " ✓"
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · "),
                    ),
                  )
                : hS(
                    "span",
                    { style: { ...S.slotMeta, fontStyle: "italic" } },
                    "No distributor matched this price range — add one in Source tab",
                  ),
            ),
          ),
        ),
      );
    };

    // ── Live catalog results ──────────────────────────────────────────────────
    const CatalogResults = () => {
      const query = pn || nsn;
      return hS(
        "div",
        { style: S.section },
        hS(
          "div",
          { style: S.header },
          hS(
            "span",
            { style: S.headerLabel },
            status === "loading"
              ? "Checking catalogs…"
              : status === "done"
                ? "Catalog Check — " + query
                : status === "error"
                  ? "Catalog Check — Error"
                  : "Catalog Check",
          ),
          status !== "loading" &&
            hS(
              "button",
              {
                style: S.rerunBtn,
                onClick: runSearch,
              },
              status === "idle" ? "Run Check" : "Recheck",
            ),
        ),
        status === "loading" &&
          hS(
            "div",
            {
              style: {
                padding: "16px 12px",
                fontFamily: "JetBrains Mono,monospace",
                fontSize: "9px",
                color: "var(--gold-dim)",
                letterSpacing: ".08em",
              },
            },
            "Querying Zoro · Grainger · MSC…",
          ),
        status === "done" &&
          hS(
            "div",
            { style: S.body },
            ...results.map((r) =>
              hS(
                "div",
                { key: r.supplier, style: S.resultRow(r.found) },
                hS(
                  "span",
                  { style: S.badge(r.found) },
                  r.found ? "FOUND" : "NOT FOUND",
                ),
                hS("span", { style: S.supplierName }, r.supplier),
                r.found && r.price
                  ? hS("span", { style: S.price }, "$" + r.price.toFixed(2))
                  : r.found
                    ? hS(
                        "span",
                        { style: { ...S.slotMeta, flexShrink: 0 } },
                        r.stock || "Check site",
                      )
                    : null,
                r.found && r.url
                  ? hS(
                      "a",
                      { href: r.url, target: "_blank", style: S.link },
                      "View →",
                    )
                  : r.url
                    ? hS(
                        "a",
                        { href: r.url, target: "_blank", style: S.link },
                        "Search →",
                      )
                    : null,
              ),
            ),
          ),
        status === "error" &&
          hS(
            "div",
            {
              style: {
                padding: "12px",
                fontFamily: "JetBrains Mono,monospace",
                fontSize: "9px",
                color: "#ff6b7a",
              },
            },
            "Search failed — check Netlify function logs.",
          ),
        status === "idle" &&
          !nsn &&
          !pn &&
          hS(
            "div",
            {
              style: {
                padding: "12px",
                fontFamily: "JetBrains Mono,monospace",
                fontSize: "9px",
                color: "var(--body-faint)",
                fontStyle: "italic",
              },
            },
            "No P/N or NSN on this record — nothing to search.",
          ),
      );
    };

    return hS(
      React.Fragment,
      null,
      hS(RoutingSlots, null),
      hS(CatalogResults, null),
      // ── GSA CASCADE PANEL — auto-renders on all-NOT FOUND
      gsaStatus !== "idle" &&
        hS(
          "div",
          {
            style: {
              marginBottom: "18px",
              background: "rgba(0,0,0,.18)",
              border: "1px solid rgba(100,160,255,.2)",
              borderRadius: "4px",
              overflow: "hidden",
            },
          },
          hS(
            "div",
            {
              style: {
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 12px",
                borderBottom: "1px solid rgba(100,160,255,.12)",
                background: "rgba(100,160,255,.04)",
              },
            },
            hS(
              "span",
              {
                style: {
                  fontFamily: "Cinzel,serif",
                  fontSize: "8px",
                  letterSpacing: ".18em",
                  textTransform: "uppercase",
                  color: "rgba(100,160,255,.8)",
                },
              },
              gsaStatus === "loading"
                ? "GSA Advantage — Searching..."
                : gsaStatus === "done"
                  ? "GSA Advantage — Schedule Items Found"
                  : gsaStatus === "empty"
                    ? "GSA Advantage — Not On Schedule"
                    : "GSA Advantage — Error",
            ),
            hS(
              "a",
              {
                href:
                  "https://www.gsaadvantage.gov/advantage/ws/search/advantage_search?q=0:8" +
                  encodeURIComponent(
                    (
                      (record.suppliers && record.suppliers[0]
                        ? record.suppliers[0].name
                        : record.item_name) || ""
                    )
                      .toLowerCase()
                      .split(" ")[0],
                  ) +
                  "&db=0&searchType=0",
                target: "_blank",
                style: {
                  fontFamily: "Cinzel,serif",
                  fontSize: "7px",
                  letterSpacing: ".1em",
                  color: "rgba(100,160,255,.6)",
                  textDecoration: "none",
                },
              },
              "Open GSA →",
            ),
          ),
          gsaStatus === "loading" &&
            hS(
              "div",
              {
                style: {
                  padding: "16px 12px",
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "9px",
                  color: "rgba(100,160,255,.6)",
                  letterSpacing: ".08em",
                },
              },
              "Querying GSA Schedule...",
            ),
          gsaStatus === "done" &&
            gsaResults.length > 0 &&
            hS(
              "div",
              {
                style: {
                  padding: "10px 12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                },
              },
              ...gsaResults.map((r, i) =>
                hS(
                  "div",
                  {
                    key: i,
                    style: {
                      display: "flex",
                      flexDirection: "column",
                      gap: "3px",
                      padding: "8px 10px",
                      background: "rgba(100,160,255,.04)",
                      border: "1px solid rgba(100,160,255,.12)",
                      borderRadius: "3px",
                    },
                  },
                  hS(
                    "div",
                    {
                      style: {
                        fontFamily: "Cinzel,serif",
                        fontSize: "9px",
                        color: "rgba(180,210,255,.9)",
                        letterSpacing: ".04em",
                      },
                    },
                    r.name,
                  ),
                  hS(
                    "div",
                    {
                      style: {
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                      },
                    },
                    r.price &&
                      hS(
                        "span",
                        {
                          style: {
                            fontFamily: "JetBrains Mono,monospace",
                            fontSize: "11px",
                            color: "var(--gold-solid)",
                          },
                        },
                        "from $" + r.price.toFixed(2),
                      ),
                    r.partNo &&
                      hS(
                        "span",
                        {
                          style: {
                            fontFamily: "JetBrains Mono,monospace",
                            fontSize: "9px",
                            color: "var(--body-faint)",
                          },
                        },
                        r.partNo,
                      ),
                    r.sources &&
                      hS(
                        "span",
                        {
                          style: {
                            fontFamily: "JetBrains Mono,monospace",
                            fontSize: "9px",
                            color: "rgba(100,160,255,.6)",
                          },
                        },
                        r.sources,
                      ),
                    r.url &&
                      hS(
                        "a",
                        {
                          href: r.url,
                          target: "_blank",
                          style: {
                            fontFamily: "Cinzel,serif",
                            fontSize: "8px",
                            letterSpacing: ".06em",
                            color: "rgba(100,160,255,.7)",
                            textDecoration: "none",
                            marginLeft: "auto",
                          },
                        },
                        "View →",
                      ),
                  ),
                ),
              ),
            ),
          gsaStatus === "empty" &&
            hS(
              "div",
              {
                style: {
                  padding: "12px",
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "9px",
                  color: "var(--body-faint)",
                  fontStyle: "italic",
                },
              },
              "Not on GSA schedule — OEM likely sells direct or unlisted.",
            ),
          gsaStatus === "error" &&
            hS(
              "div",
              {
                style: {
                  padding: "12px",
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "9px",
                  color: "#ff6b7a",
                },
              },
              "GSA search failed — check Netlify logs.",
            ),
        ),
      // ── SUPPLIER SCOUT PANEL — named distributor leads + filtered web hits
      scoutStatus !== "idle" &&
        hS(
          "div",
          {
            style: {
              marginBottom: "18px",
              background: "rgba(0,0,0,.18)",
              border: "1px solid rgba(201,168,76,.2)",
              borderRadius: "4px",
              overflow: "hidden",
            },
          },
          hS(
            "div",
            {
              style: {
                display: "flex",
                alignItems: "center",
                padding: "8px 12px",
                borderBottom: "1px solid rgba(201,168,76,.12)",
                background: "rgba(201,168,76,.04)",
              },
            },
            hS(
              "span",
              {
                style: {
                  fontFamily: "Cinzel,serif",
                  fontSize: "8px",
                  letterSpacing: ".18em",
                  textTransform: "uppercase",
                  color: "var(--gold-dim)",
                },
              },
              scoutStatus === "loading"
                ? "Supplier Scout — Searching..."
                : scoutStatus === "done"
                  ? "Supplier Scout — " +
                    ((scoutData &&
                      scoutData.claude &&
                      scoutData.claude.length) ||
                      0) +
                    " AI leads found"
                  : scoutStatus === "empty"
                    ? "Supplier Scout — No leads found"
                    : "Supplier Scout — Error",
            ),
          ),
          scoutStatus === "loading" &&
            hS(
              "div",
              {
                style: {
                  padding: "16px 12px",
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "9px",
                  color: "var(--gold-dim)",
                  letterSpacing: ".08em",
                },
              },
              "Scanning distributors + web sources...",
            ),
          scoutStatus === "done" &&
            scoutData &&
            hS(
              "div",
              {
                style: {
                  padding: "10px 12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                },
              },
              // ── AI leads
              scoutData.claude &&
                scoutData.claude.length > 0 &&
                hS(
                  "div",
                  null,
                  hS(
                    "div",
                    {
                      style: {
                        fontFamily: "Cinzel,serif",
                        fontSize: "7px",
                        letterSpacing: ".18em",
                        textTransform: "uppercase",
                        color: "var(--gold-dim)",
                        marginBottom: "6px",
                      },
                    },
                    "AI Sourcing Leads",
                  ),
                  hS(
                    "div",
                    {
                      style: {
                        display: "grid",
                        gridTemplateColumns:
                          "repeat(auto-fill,minmax(200px,1fr))",
                        gap: "8px",
                      },
                    },
                    ...scoutData.claude.map((c, i) =>
                      hS(
                        "div",
                        {
                          key: i,
                          style: {
                            padding: "8px 10px",
                            background: "rgba(201,168,76,.04)",
                            border: "1px solid rgba(201,168,76,.15)",
                            borderRadius: "3px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "3px",
                          },
                        },
                        hS(
                          "div",
                          {
                            style: {
                              fontFamily: "Cinzel,serif",
                              fontSize: "9px",
                              color: "var(--gold-solid)",
                              letterSpacing: ".04em",
                            },
                          },
                          c.name,
                        ),
                        c.website &&
                          hS(
                            "a",
                            {
                              href:
                                "https://" +
                                c.website.replace(/^https?:\/\//, ""),
                              target: "_blank",
                              style: {
                                fontFamily: "JetBrains Mono,monospace",
                                fontSize: "8px",
                                color: "var(--gold-dim)",
                                textDecoration: "none",
                              },
                            },
                            c.website,
                          ),
                        hS(
                          "div",
                          {
                            style: {
                              fontFamily: "JetBrains Mono,monospace",
                              fontSize: "8px",
                              color: "var(--body-faint)",
                              lineHeight: "1.4",
                              marginTop: "2px",
                            },
                          },
                          c.reason,
                        ),
                        hS(
                          "div",
                          {
                            style: {
                              fontFamily: "Cinzel,serif",
                              fontSize: "7px",
                              letterSpacing: ".1em",
                              color: "rgba(201,168,76,.4)",
                              marginTop: "2px",
                            },
                          },
                          (c.type || "distributor").toUpperCase(),
                        ),
                      ),
                    ),
                  ),
                ),
              // ── Web hits
              scoutData.web &&
                scoutData.web.length > 0 &&
                hS(
                  "div",
                  null,
                  hS(
                    "div",
                    {
                      style: {
                        fontFamily: "Cinzel,serif",
                        fontSize: "7px",
                        letterSpacing: ".18em",
                        textTransform: "uppercase",
                        color: "var(--body-faint)",
                        margin: "8px 0 6px",
                      },
                    },
                    "Web Hits — Nationals Excluded",
                  ),
                  hS(
                    "div",
                    {
                      style: {
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                      },
                    },
                    ...scoutData.web.slice(0, 6).map((w, i) =>
                      hS(
                        "div",
                        {
                          key: i,
                          style: {
                            padding: "6px 8px",
                            background: "rgba(0,0,0,.15)",
                            border: "1px solid rgba(255,255,255,.05)",
                            borderRadius: "3px",
                          },
                        },
                        hS(
                          "div",
                          {
                            style: {
                              fontFamily: "JetBrains Mono,monospace",
                              fontSize: "9px",
                              color: "var(--body-muted)",
                              marginBottom: "2px",
                            },
                          },
                          w.title,
                        ),
                        w.url &&
                          hS(
                            "a",
                            {
                              href: w.url.startsWith("http")
                                ? w.url
                                : "https://" + w.url,
                              target: "_blank",
                              style: {
                                fontFamily: "JetBrains Mono,monospace",
                                fontSize: "8px",
                                color: "var(--gold-dim)",
                                textDecoration: "none",
                              },
                            },
                            w.url,
                          ),
                        w.snippet &&
                          hS(
                            "div",
                            {
                              style: {
                                fontFamily: "JetBrains Mono,monospace",
                                fontSize: "8px",
                                color: "var(--body-faint)",
                                marginTop: "2px",
                                lineHeight: "1.4",
                              },
                            },
                            w.snippet.slice(0, 120) +
                              (w.snippet.length > 120 ? "..." : ""),
                          ),
                      ),
                    ),
                  ),
                ),
            ),
          scoutStatus === "empty" &&
            hS(
              "div",
              {
                style: {
                  padding: "12px",
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "9px",
                  color: "var(--body-faint)",
                  fontStyle: "italic",
                },
              },
              "No leads found. Try direct manufacturer outreach.",
            ),
          scoutStatus === "error" &&
            hS(
              "div",
              {
                style: {
                  padding: "12px",
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "9px",
                  color: "#ff6b7a",
                },
              },
              "Scout failed — check Netlify logs.",
            ),
        ),
    );
  }

  /*
  INJECT POINT B — usage inside DrawerSourcePanel render return
  ──────────────────────────────────────────────────────────────
  After the "Quick Search" block (~line 611) and before the distributor IIFE,
  add this line inside the return hS(...) chain:

      hS(CatalogCheckPanel, { record, dists }),

  Where `dists` is the already-computed array from:
      const dists = getDistsByFSC(fsc).slice(0, 20);
*/

  // ── MAIN PANEL ────────────────────────────────────────────────────────
  function DrawerSourcePanel({ record }) {
    const { FSC_LANES_MAP, DISTRIBUTORS, getDistsByFSC, distSave } =
      window.SCC_DIST;
    const isBlocked = window.SCC_TABS.isBlocked || (() => null);
    const fsc = record.fsc || "";
    const nsn = record.nsn || "";
    const part = record.ref_part_number || "";
    const mfr = record.ref_supplier || "";
    const dists = getDistsByFSC(fsc).slice(0, 20);
    const lane = FSC_LANES_MAP[String(fsc)] || "FSC " + fsc;

    const [fetchState, setFetchState] = useSourceState({});

    const fetchDistPhone = async (d) => {
      if (!d.website) return;
      setFetchState((s) => ({ ...s, [d.id]: "loading" }));
      try {
        const res = await fetch("/.netlify/functions/fetch-phone", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: d.website }),
        });
        const data = await res.json();
        if (data.phone) {
          await distSave({ ...d, phone: data.phone });
          d.phone = data.phone;
          setFetchState((s) => ({ ...s, [d.id]: "done" }));
        } else {
          setFetchState((s) => ({ ...s, [d.id]: "fail" }));
        }
      } catch {
        setFetchState((s) => ({ ...s, [d.id]: "fail" }));
      }
    };

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

    const allSuppliers = (() => {
      if (!record.all_suppliers) return [];
      const matches = [
        ...record.all_suppliers.matchAll(
          /([^(]+)\s+\(([A-Z0-9]{5})\)\s+P\/N:\s+([^\s·]+)/g,
        ),
      ];
      return matches.map((m) => ({
        name: m[1].trim(),
        cage: m[2].trim(),
        pn: m[3].trim(),
      }));
    })();

    const blockedHit = isBlocked(mfr);

    return hS(
      "div",
      null,
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
      // ── Sourcing Action Bar ──────────────────────────────────────────
      hS(
        "div",
        {
          style: {
            display: "flex",
            gap: "6px",
            flexWrap: "wrap",
            marginBottom: "16px",
            paddingBottom: "14px",
            borderBottom: "1px solid rgba(201,168,76,.1)",
          },
        },
        nsn &&
          hS(
            "button",
            {
              title: "Search NSN on Google — distributor results",
              onClick: () => {
                const SA = window.SCC_SOURCE_ACTIONS || {};
                SA.searchNSN && SA.searchNSN(nsn, record.item_name);
              },
              style: {
                background: "transparent",
                border: "1px solid rgba(201,168,76,.3)",
                color: "var(--gold-dim)",
                fontFamily: "Cinzel,serif",
                fontSize: "8px",
                letterSpacing: ".12em",
                textTransform: "uppercase",
                padding: "5px 12px",
                cursor: "pointer",
              },
            },
            "⌕ NSN Search",
          ),
        hS(
          "button",
          {
            title: "Local/regional supplier search — Texas + government/DLA",
            onClick: () => {
              const SA = window.SCC_SOURCE_ACTIONS || {};
              SA.searchLocal && SA.searchLocal(record.item_name, fsc);
            },
            style: {
              background: "transparent",
              border: "1px solid rgba(201,168,76,.3)",
              color: "var(--gold-dim)",
              fontFamily: "Cinzel,serif",
              fontSize: "8px",
              letterSpacing: ".12em",
              textTransform: "uppercase",
              padding: "5px 12px",
              cursor: "pointer",
            },
          },
          "⌕ Local Source",
        ),
        nsn &&
          hS(
            "button",
            {
              title: "DIBBS quote history for this NSN",
              onClick: () => {
                const SA = window.SCC_SOURCE_ACTIONS || {};
                SA.searchDIBBS && SA.searchDIBBS(nsn);
              },
              style: {
                background: "transparent",
                border: "1px solid rgba(255,255,255,.12)",
                color: "var(--body-faint)",
                fontFamily: "Cinzel,serif",
                fontSize: "8px",
                letterSpacing: ".12em",
                textTransform: "uppercase",
                padding: "5px 12px",
                cursor: "pointer",
              },
            },
            "⌕ DIBBS History",
          ),
      ),
      // ── DLA Approved Sources ──
      allSuppliers.length > 0 &&
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
            "DLA Approved Sources — " + allSuppliers.length + " Listed",
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
            ...allSuppliers.map((s) =>
              hS(SupplierCard, {
                key: s.cage + s.pn,
                s,
                isBlocked,
                gsaUrl:
                  "https://www.google.com/search?q=" +
                  encodeURIComponent(s.name + " " + s.pn),
                record,
              }),
            ),
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
      hS(CatalogCheckPanel, { record, dists }),
      (() => {
        const allDists = dists.length ? dists : DISTRIBUTORS.slice(0, 20);
        const preferred = allDists.filter((d) =>
          (d.tags || []).includes("preferred-alt"),
        );
        const others = allDists.filter(
          (d) => !(d.tags || []).includes("preferred-alt"),
        );

        // Split preferred into priority tiers
        const p1 = preferred.filter((d) => (d.priority || 9) === 1);
        const p2 = preferred.filter((d) => (d.priority || 9) === 2);
        const p3 = preferred.filter((d) => (d.priority || 9) === 3);

        const sectionLabel = (text, count, accent, sub) =>
          hS(
            "div",
            {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: sub ? "7px" : "8px",
                letterSpacing: ".15em",
                textTransform: "uppercase",
                color: accent || "var(--gold-dim)",
                marginBottom: "8px",
                marginTop: sub ? "10px" : "14px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                paddingLeft: sub ? "2px" : "0",
                borderLeft: sub
                  ? "3px solid " + (accent || "rgba(201,168,76,.3)")
                  : "none",
              },
            },
            text,
            hS(
              "span",
              {
                style: {
                  fontFamily: "JetBrains Mono,monospace",
                  fontSize: "9px",
                  color: "var(--body-faint)",
                  letterSpacing: "0",
                },
              },
              "(" + count + ")",
            ),
          );

        const renderCard = (d) => {
          const fs = fetchState[d.id];
          const isPreferred = (d.tags || []).includes("preferred-alt");
          return hS(
            "div",
            {
              key: d.id,
              style: {
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                borderLeft: !isPreferred
                  ? "2px solid transparent"
                  : d.priority === 1
                    ? "2px solid rgba(61,214,140,.5)"
                    : d.priority === 2
                      ? "2px solid rgba(201,168,76,.4)"
                      : "2px solid rgba(160,160,160,.3)",
                paddingLeft: isPreferred ? "6px" : "0",
              },
            },
            hS(
              "a",
              {
                href: (() => {
                  // nsn_search: "full" → nsn_url + raw NSN with dashes
                  // nsn_search: "niin" → nsn_url + last 9 chars of NSN
                  // else: P/N first, NSN fallback
                  if (d.nsn_search === "full" && d.nsn_url && nsn) {
                    return d.nsn_url + nsn;
                  }
                  if (d.nsn_search === "niin" && d.nsn_url && nsn) {
                    const niin = nsn.length >= 9 ? nsn.slice(-9) : nsn;
                    return d.nsn_url + niin;
                  }
                  const query =
                    d.search_by === "nsn"
                      ? nsn || part || ""
                      : part || nsn || "";
                  if (!d.search_url) {
                    const site = d.website ? "site:" + d.website + " " : "";
                    return (
                      "https://www.google.com/search?q=" +
                      encodeURIComponent(site + (query || d.name))
                    );
                  }
                  return (
                    d.search_url + (query ? encodeURIComponent(query) : "")
                  );
                })(),
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
                "div",
                {
                  style: { display: "flex", gap: "4px", alignItems: "center" },
                },
                (d.nsn_search || d.search_by === "nsn") &&
                  hS(
                    "span",
                    {
                      style: {
                        fontSize: "7px",
                        fontFamily: "JetBrains Mono,monospace",
                        color:
                          d.nsn_search === "full"
                            ? "#3dd68c"
                            : d.nsn_search === "niin"
                              ? "#7eb8f7"
                              : "var(--gold-dim)",
                        letterSpacing: ".04em",
                        background:
                          d.nsn_search === "full"
                            ? "rgba(61,214,140,.12)"
                            : d.nsn_search === "niin"
                              ? "rgba(126,184,247,.12)"
                              : "rgba(201,168,76,.1)",
                        padding: "1px 4px",
                        borderRadius: "2px",
                        border:
                          d.nsn_search === "full"
                            ? "1px solid rgba(61,214,140,.3)"
                            : d.nsn_search === "niin"
                              ? "1px solid rgba(126,184,247,.3)"
                              : "none",
                      },
                    },
                    d.nsn_search === "full"
                      ? "NSN✓"
                      : d.nsn_search === "niin"
                        ? "NIIN"
                        : "NSN",
                  ),
                d.priority === 1 &&
                  hS(
                    "span",
                    {
                      style: {
                        fontSize: "8px",
                        color: "#3dd68c",
                        letterSpacing: ".04em",
                      },
                    },
                    "★",
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
            hS(
              "div",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                  minHeight: "22px",
                },
              },
              d.phone
                ? hS(
                    "a",
                    {
                      href: "tel:" + d.phone.replace(/\D/g, ""),
                      style: {
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "11px",
                        color: "var(--accent-green)",
                        textDecoration: "none",
                        letterSpacing: ".04em",
                        flex: 1,
                      },
                    },
                    "📞 " + d.phone,
                  )
                : hS(
                    "span",
                    {
                      style: {
                        fontFamily: "JetBrains Mono,monospace",
                        fontSize: "10px",
                        color: "var(--body-faint)",
                        flex: 1,
                        fontStyle: "italic",
                      },
                    },
                    fs === "fail" ? "No # found" : "No phone",
                  ),
              d.website &&
                !d.phone &&
                hS(
                  "button",
                  {
                    onClick: (e) => {
                      e.preventDefault();
                      fetchDistPhone(d);
                    },
                    disabled: fs === "loading",
                    title: "Fetch phone from " + d.website,
                    style: {
                      padding: "2px 6px",
                      fontSize: "10px",
                      background: "rgba(201,168,76,.12)",
                      border: "1px solid rgba(201,168,76,.3)",
                      color:
                        fs === "loading"
                          ? "var(--gold-dim)"
                          : "var(--gold-solid)",
                      cursor: fs === "loading" ? "wait" : "pointer",
                      borderRadius: "2px",
                      flexShrink: 0,
                    },
                  },
                  fs === "loading" ? "…" : "📞?",
                ),
            ),
            // ── RFQ button ──
            hS(
              "a",
              {
                href: buildRfqUrl(
                  record,
                  d.name,
                  d.cage || "",
                  "",
                  d.email || "",
                  d.phone || "",
                ),
                target: "_blank",
                title: "Open RFQ template pre-filled for " + d.name,
                style: {
                  display: "block",
                  textAlign: "center",
                  padding: "4px 8px",
                  background: "rgba(201,168,76,.08)",
                  border: "1px solid rgba(201,168,76,.25)",
                  borderRadius: "3px",
                  fontFamily: "Cinzel,serif",
                  fontSize: "8px",
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                  color: "var(--gold-solid)",
                  textDecoration: "none",
                  cursor: "pointer",
                },
              },
              "📄 Open RFQ",
            ),
          );
        };

        return hS(
          "div",
          null,
          // ── Preferred Sources — tiered ──
          preferred.length > 0 &&
            hS(
              "div",
              null,
              sectionLabel(
                "Preferred Sources — verified, drop-ship, no gatekeepers",
                preferred.length,
                "#3dd68c",
              ),

              // P1 — Broadest FSC coverage, lowest friction, hit first
              p1.length > 0 &&
                hS(
                  "div",
                  null,
                  sectionLabel(
                    "P1 — Broadest · Hit First",
                    p1.length,
                    "#3dd68c",
                    true,
                  ),
                  hS(
                    "div",
                    {
                      style: {
                        display: "grid",
                        gridTemplateColumns:
                          "repeat(auto-fill,minmax(200px,1fr))",
                        gap: "8px",
                        marginBottom: "4px",
                      },
                    },
                    ...p1.map(renderCard),
                  ),
                ),

              // P2 — Lane specialists + Texas-heavy
              p2.length > 0 &&
                hS(
                  "div",
                  null,
                  sectionLabel(
                    "P2 — Lane Specialists · Texas-Heavy",
                    p2.length,
                    "var(--gold-solid)",
                    true,
                  ),
                  hS(
                    "div",
                    {
                      style: {
                        display: "grid",
                        gridTemplateColumns:
                          "repeat(auto-fill,minmax(200px,1fr))",
                        gap: "8px",
                        marginBottom: "4px",
                      },
                    },
                    ...p2.map(renderCard),
                  ),
                ),

              // P3 — Need account or slower friction
              p3.length > 0 &&
                hS(
                  "div",
                  null,
                  sectionLabel(
                    "P3 — Need Account · Slower",
                    p3.length,
                    "var(--body-faint)",
                    true,
                  ),
                  hS(
                    "div",
                    {
                      style: {
                        display: "grid",
                        gridTemplateColumns:
                          "repeat(auto-fill,minmax(200px,1fr))",
                        gap: "8px",
                        opacity: "0.85",
                        marginBottom: "4px",
                      },
                    },
                    ...p3.map(renderCard),
                  ),
                ),
            ),
          // ── All Others ──
          others.length > 0 &&
            hS(
              "div",
              null,
              sectionLabel(
                preferred.length > 0
                  ? "Other Matched Distributors — FSC " + fsc
                  : "All Distributors — FSC " + fsc,
                others.length,
              ),
              hS(
                "div",
                {
                  style: {
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))",
                    gap: "8px",
                    opacity: 0.75,
                  },
                },
                ...others.map(renderCard),
              ),
            ),
          // ── Empty state ──
          allDists.length === 0 &&
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
              "No distributors matched FSC " + fsc,
            ),
        );
      })(),
    );
  }

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.DrawerSourcePanel = DrawerSourcePanel;
})();
