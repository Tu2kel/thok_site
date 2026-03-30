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

  // ── SUPPLIER CARD (DLA Approved Source) ──────────────────────────────
  function SupplierCard({ s, isBlocked, gsaUrl }) {
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
      const found = await fetchPhoneFromUrl(
        "https://www.google.com/search?q=" +
          encodeURIComponent(s.name + " phone number contact us"),
      );
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
    );
  }

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
        ...(dists.length ? dists : DISTRIBUTORS.slice(0, 12)).map((d) => {
          const fs = fetchState[d.id];
          return hS(
            "div",
            {
              key: d.id,
              style: { display: "flex", flexDirection: "column", gap: "4px" },
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
          );
        }),
      ),
    );
  }

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.DrawerSourcePanel = DrawerSourcePanel;
})();
