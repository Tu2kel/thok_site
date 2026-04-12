(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — AWARDS INTEL PANEL
  //  USASpending.gov award history lookup per NSN/sol
  //  Scores competition concentration, price anchors, OEM flags
  //  Exposes: window.SCC_TABS.AwardsIntelPanel
  // ═══════════════════════════════════════════════════════════════════════

  const { createElement: h, useState, useEffect, useRef } = React;

  // ── OEM BLOCK LIST (manufacturer-controlled CAGEs — never dealer channel) ──
  const OEM_BLOCK_CAGES = new Set([
    "07482",
    "062W0", // GE
    "81SA7",
    "R9004", // Falcom
    "75Q65", // Oshkosh Defense (unrestricted direct bids)
  ]);

  // ── USASPENDING API ────────────────────────────────────────────────────
  const USA_SPENDING_URL =
    "https://api.usaspending.gov/api/v2/search/spending_by_award/";

  const AWARD_FIELDS = [
    "Award ID",
    "Recipient Name",
    "recipient_id",
    "Award Amount",
    "Start Date",
    "End Date",
    "Award Type",
    "Awarding Agency",
    "Awarding Sub Agency",
    "Description",
    "Period of Performance Current End Date",
  ];

  // FSC → PSC is a direct 1:1 mapping for DLA (FSC == PSC for supply items)
  function fscToPsc(nsn) {
    const raw = nsn.replace(/-/g, "");
    return raw.slice(0, 4); // first 4 digits = FSC = PSC
  }

  async function postAwards(body) {
    const res = await fetch(USA_SPENDING_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("USASpending API returned " + res.status);
    const data = await res.json();
    return data.results || [];
  }

  async function fetchAwardHistory(nsn) {
    if (!nsn) return { results: [], mode: "none" };

    // ── Stage 1: NSN keyword search ──────────────────────────────────────
    const nsnDashed = nsn.includes("-")
      ? nsn
      : nsn.replace(/(\d{4})(\d{2})(\d{3})(\d{4})/, "$1-$2-$3-$4");
    const nsnRaw = nsn.replace(/-/g, "");

    const nsnResults = await postAwards({
      filters: {
        keywords: [nsnDashed, nsnRaw],
        award_type_codes: ["A", "B", "C", "D"],
      },
      fields: AWARD_FIELDS,
      page: 1,
      limit: 10,
      sort: "Start Date",
      order: "desc",
    });

    if (nsnResults.length > 0) {
      return { results: nsnResults, mode: "nsn" };
    }

    // ── Stage 2: PSC + DLA awarding agency fallback ──────────────────────
    const psc = fscToPsc(nsn);
    const pscResults = await postAwards({
      filters: {
        award_type_codes: ["A", "B", "C", "D"],
        program_activities: [],
        // DLA awarding agency toptier code
        awarding_agency_codes: ["97"], // DoD / DLA rolls under 97
        psc_codes: {
          require: [[psc]],
        },
        time_period: [{ start_date: "2020-01-01", end_date: "2026-12-31" }],
      },
      fields: AWARD_FIELDS,
      page: 1,
      limit: 15,
      sort: "Start Date",
      order: "desc",
    });

    return {
      results: pscResults,
      mode: pscResults.length > 0 ? "psc" : "none",
    };
  }

  // ── SCORING ENGINE ─────────────────────────────────────────────────────
  function scoreAwards(awards, histPrice) {
    if (!awards.length) {
      return {
        grade: "UNKNOWN",
        color: "var(--body-faint)",
        headline: "No award history found",
        detail:
          "This NSN has no prior contract awards in USASpending. No price anchor available — you set the baseline.",
        priceAnchor: null,
        concentration: null,
        oemFlag: false,
        setAsideTypes: [],
      };
    }

    // Unique awardees
    const awardees = [
      ...new Set(awards.map((a) => (a["Recipient Name"] || "").toUpperCase())),
    ];
    const concentration =
      awardees.length === 1
        ? "sole"
        : awardees.length <= 3
          ? "concentrated"
          : "competitive";

    // Price anchor — median of award amounts (unit price not returned by API, use award amount as proxy)
    const amounts = awards
      .map((a) => parseFloat(a["Award Amount"] || 0))
      .filter((v) => v > 0);
    const priceAnchor = amounts.length
      ? amounts.reduce((s, v) => s + v, 0) / amounts.length
      : null;

    // OEM flag
    const oemFlag = false; // recipient_id CAGE extraction not reliable from this endpoint — flag manually via name check
    const oemNameFlag = awardees.some((name) =>
      [
        "OSHKOSH",
        "GENERAL ELECTRIC",
        "FALCOM",
        "BOEING",
        "LOCKHEED",
        "RAYTHEON",
        "NORTHROP",
        "L3 ",
        "BAE SYSTEMS",
      ].some((k) => name.includes(k)),
    );

    // Set-aside type signals from award type codes (description field)
    const typeDescs = [
      ...new Set(awards.map((a) => a["Award Type"] || "").filter(Boolean)),
    ];

    // Grade
    let grade, color, headline, detail;

    if (oemNameFlag && concentration === "sole") {
      grade = "BLOCK";
      color = "var(--red)";
      headline = "OEM-controlled — sole awardee is prime manufacturer";
      detail =
        "All prior awards went to a single OEM. No dealer channel visible. High probability of manufacturer-controlled NSN. Verify approved source list before sourcing.";
    } else if (concentration === "sole") {
      grade = "AMBER";
      color: "var(--amber)";
      color = "var(--amber)";
      headline = "Single awardee — concentrated but may have dealer path";
      detail =
        "One company has won all prior awards. Check if they distribute through resellers or if this is a direct-manufacture NSN.";
    } else if (concentration === "concentrated") {
      grade = "GREEN";
      color = "var(--accent-green)";
      headline = "2-3 prior awardees — competitive, dealer path likely";
      detail =
        "Multiple companies have won this NSN before. Strong signal that the approved source list includes resellers.";
    } else {
      grade = "GREEN";
      color = "var(--accent-green)";
      headline = "Open competition — " + awardees.length + " prior awardees";
      detail =
        "Wide competition history. Approved source list is open. Source from any qualified distributor.";
    }

    // Price delta vs Hist.
    let priceDelta = null;
    if (priceAnchor && histPrice) {
      priceDelta = ((histPrice - priceAnchor) / priceAnchor) * 100;
    }

    return {
      grade,
      color,
      headline,
      detail,
      priceAnchor,
      concentration,
      oemFlag: oemNameFlag,
      setAsideTypes: typeDescs,
      awardees,
      priceDelta,
    };
  }

  // ── PANEL COMPONENT ────────────────────────────────────────────────────
  function AwardsIntelPanel({ record }) {
    const [status, setStatus] = useState("idle"); // idle | loading | done | error
    const [awards, setAwards] = useState([]);
    const [score, setScore] = useState(null);
    const [errorMsg, setErrorMsg] = useState("");
    const [queryMode, setQueryMode] = useState(null); // "nsn" | "psc" | "none"
    const fetchedNsn = useRef(null);

    const nsn = record.nsn || "";
    const fsc = record.fsc || nsn.replace(/-/g, "").slice(0, 4);
    const histPrice = parseFloat(record.unit_price) || null;

    const runFetch = async () => {
      if (!nsn) return;
      setStatus("loading");
      setAwards([]);
      setScore(null);
      setQueryMode(null);
      setErrorMsg("");
      try {
        const { results, mode } = await fetchAwardHistory(nsn);
        setAwards(results);
        setQueryMode(mode);
        setScore(scoreAwards(results, histPrice));
        setStatus("done");
      } catch (e) {
        setErrorMsg(e.message);
        setStatus("error");
      }
    };
    // Auto-fetch when panel mounts with an NSN
    useEffect(() => {
      if (!nsn || fetchedNsn.current === nsn) return;
      fetchedNsn.current = nsn;
      runFetch();
    }, [nsn]);
    // ── styles ──
    const S = {
      mono: { fontFamily: "JetBrains Mono,monospace" },
      cinzel: { fontFamily: "Cinzel,serif" },
      cormorant: { fontFamily: "Cormorant Garamond,serif" },
      label: {
        fontFamily: "Cinzel,serif",
        fontSize: "9px",
        letterSpacing: ".18em",
        textTransform: "uppercase",
        color: "var(--gold-dim)",
        marginBottom: "4px",
        display: "block",
      },
      card: {
        background: "var(--surface-inset, rgba(0,0,0,.25))",
        border: "1px solid rgba(201,168,76,.12)",
        padding: "12px 14px",
        marginBottom: "8px",
      },
      row: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: "8px",
        flexWrap: "wrap",
      },
    };

    // ── Loading state ──
    if (status === "idle" || status === "loading") {
      return h(
        "div",
        { style: { padding: "32px 0", textAlign: "center" } },
        status === "loading"
          ? h(
              "div",
              null,
              h("div", {
                style: {
                  width: "32px",
                  height: "32px",
                  border: "2px solid rgba(201,168,76,.15)",
                  borderTop: "2px solid var(--gold-solid, #C9A84C)",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                  margin: "0 auto 12px",
                },
              }),
              h(
                "div",
                {
                  style: {
                    ...S.cormorant,
                    fontSize: "14px",
                    color: "var(--body-faint)",
                    fontStyle: "italic",
                  },
                },
                "Querying USASpending.gov…",
              ),
            )
          : h(
              "div",
              null,
              h(
                "div",
                {
                  style: {
                    ...S.cinzel,
                    fontSize: "13px",
                    color: "var(--gold-dim)",
                    marginBottom: "8px",
                  },
                },
                "Awards Intel",
              ),
              h(
                "div",
                {
                  style: {
                    ...S.cormorant,
                    fontSize: "14px",
                    color: "var(--body-faint)",
                    fontStyle: "italic",
                    marginBottom: "20px",
                  },
                },
                nsn ? "NSN " + nsn : "No NSN on this solicitation",
              ),
              nsn &&
                h(
                  "button",
                  {
                    onClick: runFetch,
                    style: {
                      background: "rgba(201,168,76,.1)",
                      border: "1px solid rgba(201,168,76,.35)",
                      color: "var(--gold-solid, #C9A84C)",
                      fontFamily: "Cinzel,serif",
                      fontSize: "9px",
                      letterSpacing: ".2em",
                      textTransform: "uppercase",
                      padding: "10px 24px",
                      cursor: "pointer",
                    },
                  },
                  "⬡ Pull Award History",
                ),
            ),
      );
    }

    // ── Error state ──
    if (status === "error") {
      return h(
        "div",
        { style: { padding: "20px 0" } },
        h(
          "div",
          {
            style: {
              color: "var(--red)",
              ...S.mono,
              fontSize: "12px",
              marginBottom: "12px",
            },
          },
          "USASpending fetch failed: " + errorMsg,
        ),
        h(
          "button",
          {
            onClick: runFetch,
            style: {
              background: "transparent",
              border: "1px solid var(--border-subtle)",
              color: "var(--body-dim)",
              fontFamily: "Cinzel,serif",
              fontSize: "9px",
              letterSpacing: ".16em",
              textTransform: "uppercase",
              padding: "8px 16px",
              cursor: "pointer",
            },
          },
          "Retry",
        ),
      );
    }

    // ── Done state ──
    return h(
      "div",
      { style: { animation: "fadeUp .4s ease both" } },

      // ── Query mode indicator ──
      queryMode &&
        h(
          "div",
          {
            style: {
              fontFamily: "JetBrains Mono,monospace",
              fontSize: "9px",
              letterSpacing: ".14em",
              textTransform: "uppercase",
              color:
                queryMode === "nsn"
                  ? "var(--accent-green)"
                  : queryMode === "psc"
                    ? "var(--amber)"
                    : "var(--body-faint)",
              marginBottom: "10px",
              opacity: 0.75,
            },
          },
          queryMode === "nsn"
            ? "● NSN match — exact history for " + nsn
            : queryMode === "psc"
              ? "◎ PSC fallback — FSC " +
                fsc +
                " lane (no NSN-specific history)"
              : "○ No award history found in either pass",
        ),

      // ── Score badge ──
      score &&
        h(
          "div",
          {
            style: {
              padding: "16px 18px",
              marginBottom: "16px",
              background: "var(--surface-inset, rgba(0,0,0,.25))",
              border: "1px solid " + (score.color || "rgba(201,168,76,.2)"),
              borderLeft: "4px solid " + (score.color || "rgba(201,168,76,.4)"),
            },
          },
          h(
            "div",
            { style: { ...S.row, marginBottom: "6px" } },
            h(
              "div",
              {
                style: {
                  ...S.cinzel,
                  fontSize: "11px",
                  letterSpacing: ".2em",
                  color: score.color,
                  fontWeight: "700",
                },
              },
              "◆ " + score.grade + " — " + score.headline,
            ),
            h(
              "div",
              {
                style: {
                  ...S.mono,
                  fontSize: "10px",
                  color: "var(--body-faint)",
                  whiteSpace: "nowrap",
                },
              },
              awards.length +
                " award" +
                (awards.length !== 1 ? "s" : "") +
                " found",
            ),
          ),
          h(
            "div",
            {
              style: {
                ...S.cormorant,
                fontSize: "13.5px",
                color: "var(--body-dim)",
                fontStyle: "italic",
                lineHeight: "1.6",
              },
            },
            score.detail,
          ),

          // Price anchor vs Hist.
          score.priceAnchor &&
            h(
              "div",
              {
                style: {
                  display: "flex",
                  gap: "24px",
                  marginTop: "14px",
                  paddingTop: "12px",
                  borderTop: "1px solid rgba(201,168,76,.1)",
                  flexWrap: "wrap",
                },
              },
              h(
                "div",
                null,
                h("span", { style: S.label }, "Avg Award Value"),
                h(
                  "span",
                  {
                    style: {
                      ...S.mono,
                      fontSize: "15px",
                      color: "var(--amber)",
                    },
                  },
                  "$" +
                    score.priceAnchor.toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    }),
                ),
              ),
              histPrice &&
                h(
                  "div",
                  null,
                  h("span", { style: S.label }, "Hist. Unit Price"),
                  h(
                    "span",
                    {
                      style: {
                        ...S.mono,
                        fontSize: "15px",
                        color: "var(--gold-solid, #C9A84C)",
                      },
                    },
                    "$" + histPrice.toFixed(2),
                  ),
                ),
              score.priceDelta !== null &&
                h(
                  "div",
                  null,
                  h("span", { style: S.label }, "Hist. vs Avg"),
                  h(
                    "span",
                    {
                      style: {
                        ...S.mono,
                        fontSize: "15px",
                        color:
                          score.priceDelta > 0
                            ? "var(--accent-green)"
                            : "var(--red)",
                        fontWeight: "700",
                      },
                    },
                    (score.priceDelta > 0 ? "+" : "") +
                      score.priceDelta.toFixed(1) +
                      "%",
                  ),
                ),
              score.concentration &&
                h(
                  "div",
                  null,
                  h("span", { style: S.label }, "Competition"),
                  h(
                    "span",
                    {
                      style: {
                        ...S.mono,
                        fontSize: "12px",
                        color:
                          score.concentration === "competitive"
                            ? "var(--accent-green)"
                            : score.concentration === "concentrated"
                              ? "var(--amber)"
                              : "var(--red)",
                        textTransform: "uppercase",
                        letterSpacing: ".1em",
                      },
                    },
                    score.concentration,
                  ),
                ),
            ),

          // Prior awardees list
          score.awardees &&
            score.awardees.length > 0 &&
            h(
              "div",
              { style: { marginTop: "12px" } },
              h("span", { style: S.label }, "Prior Awardees"),
              h(
                "div",
                {
                  style: {
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "6px",
                    marginTop: "4px",
                  },
                },
                ...score.awardees.map((name, i) =>
                  h(
                    "span",
                    {
                      key: i,
                      style: {
                        ...S.mono,
                        fontSize: "10px",
                        padding: "3px 8px",
                        background: "rgba(201,168,76,.08)",
                        border: "1px solid rgba(201,168,76,.18)",
                        color: "var(--body-dim)",
                      },
                    },
                    name,
                  ),
                ),
              ),
            ),
        ),

      // ── Award history table ──
      awards.length > 0 &&
        h(
          "div",
          null,
          h(
            "div",
            {
              style: {
                ...S.cinzel,
                fontSize: "9px",
                letterSpacing: ".2em",
                textTransform: "uppercase",
                color: "var(--gold-dim)",
                marginBottom: "10px",
                paddingBottom: "6px",
                borderBottom: "1px solid rgba(201,168,76,.1)",
              },
            },
            "◆ Award History",
          ),
          ...awards.map((award, i) =>
            h(
              "div",
              { key: i, style: { ...S.card, marginBottom: "6px" } },
              h(
                "div",
                { style: { ...S.row, marginBottom: "4px" } },
                h(
                  "div",
                  {
                    style: {
                      ...S.mono,
                      fontSize: "11px",
                      color: "var(--alabaster)",
                      fontWeight: "700",
                      flex: "1",
                    },
                  },
                  (award["Recipient Name"] || "Unknown").toUpperCase(),
                ),
                h(
                  "div",
                  {
                    style: {
                      ...S.mono,
                      fontSize: "12px",
                      color: "var(--amber)",
                      whiteSpace: "nowrap",
                    },
                  },
                  award["Award Amount"]
                    ? "$" +
                        parseFloat(award["Award Amount"]).toLocaleString(
                          "en-US",
                          {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          },
                        )
                    : "—",
                ),
              ),
              h(
                "div",
                { style: { display: "flex", gap: "16px", flexWrap: "wrap" } },
                h(
                  "span",
                  {
                    style: {
                      ...S.mono,
                      fontSize: "10px",
                      color: "var(--body-faint)",
                    },
                  },
                  (award["Start Date"] || "").slice(0, 7),
                ),
                h(
                  "span",
                  {
                    style: {
                      ...S.mono,
                      fontSize: "10px",
                      color: "var(--body-faint)",
                    },
                  },
                  award["Award Type"] || "",
                ),
                h(
                  "span",
                  {
                    style: {
                      ...S.mono,
                      fontSize: "10px",
                      color: "var(--body-faint)",
                    },
                  },
                  award["Awarding Sub Agency"] ||
                    award["Awarding Agency"] ||
                    "",
                ),
              ),
              award["Description"] &&
                h(
                  "div",
                  {
                    style: {
                      ...S.cormorant,
                      fontSize: "12px",
                      color: "var(--body-faint)",
                      fontStyle: "italic",
                      marginTop: "4px",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    },
                  },
                  award["Description"],
                ),
            ),
          ),
        ),

      // No results
      awards.length === 0 &&
        h(
          "div",
          {
            style: {
              ...S.card,
              textAlign: "center",
              padding: "24px",
            },
          },
          h(
            "div",
            {
              style: {
                ...S.cinzel,
                fontSize: "11px",
                color: "var(--gold-dim)",
                marginBottom: "8px",
              },
            },
            "No Awards Found",
          ),
          h(
            "div",
            {
              style: {
                ...S.cormorant,
                fontSize: "14px",
                color: "var(--body-faint)",
                fontStyle: "italic",
              },
            },
            "NSN " +
              nsn +
              " has no contract history in USASpending. This is either a new NSN or awards are not yet reported. No price anchor — you set the baseline.",
          ),
        ),

      // Refresh button
      h(
        "div",
        { style: { marginTop: "16px" } },
        h(
          "button",
          {
            onClick: () => {
              fetchedNsn.current = null;
              runFetch();
            },
            style: {
              background: "transparent",
              border: "1px solid rgba(201,168,76,.2)",
              color: "var(--body-faint)",
              fontFamily: "Cinzel,serif",
              fontSize: "9px",
              letterSpacing: ".14em",
              textTransform: "uppercase",
              padding: "6px 14px",
              cursor: "pointer",
            },
          },
          "↻ Refresh",
        ),
      ),
    );
  }

  // ── Expose ──
  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.AwardsIntelPanel = AwardsIntelPanel;
})();
