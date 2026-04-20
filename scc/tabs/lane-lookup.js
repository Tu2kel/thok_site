(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — LANE LOOKUP TAB
  //  Reads live from window.SCC_DIST.DISTRIBUTORS (MongoDB cache)
  //  PSC / NIGP → FSC → supplier match
  //  Pre-compiled React · No Babel · No JSX
  //  Exports: window.SCC_TABS.LaneLookupTab
  // ═══════════════════════════════════════════════════════════════════════

  const { createElement: h, useState, useEffect, useCallback } = React;

  // ── PSC → FSC mappings ────────────────────────────────────────────────
  const PSC_TO_FSC = {
    3030: ["3030"],
    3110: ["3110"],
    4110: ["4110"],
    4120: ["4120"],
    4130: ["4110", "4120", "4130"],
    4240: ["4240"],
    4320: ["4320"],
    4330: ["4330"],
    4730: ["4730"],
    4820: ["4820"],
    4910: ["4910"],
    4940: ["4940"],
    5110: ["5110"],
    5120: ["5120"],
    5305: ["5305"],
    5306: ["5306"],
    5307: ["5305", "5306", "5307"],
    5310: ["5310"],
    5315: ["5315"],
    5320: ["5320"],
    5330: ["5330"],
    5340: ["5340"],
    6110: ["6110"],
    6115: ["6115"],
    6120: ["6110", "6115", "6120"],
    6150: ["6150"],
    6230: ["6230"],
    6630: ["6630"],
    6640: ["6640"],
    6510: ["6510"],
    6515: ["6515"],
    7110: ["7110"],
    7125: ["7125"],
    7930: ["7930"],
    8415: ["8415"],
    8465: ["8465"],
    8470: ["8470"],
    9150: ["9150"],
    9510: ["9510"],
    9520: ["9520"],
    9535: ["9510", "9520", "9535"],
    2320: ["2320"],
    2530: ["2530"],
    2540: ["2540"],
    2910: ["2910"],
    2940: ["2940"],
    1005: ["1005"],
    1095: ["1095"],
  };

  // ── NIGP → FSC mappings ───────────────────────────────────────────────
  const NIGP_TO_FSC = {
    345: ["4110", "4120", "4130", "4330"],
    400: ["6110", "6115", "6120", "6150", "6230"],
    450: ["3030", "3110", "4320", "4330", "4910", "4940"],
    475: [
      "5305",
      "5306",
      "5307",
      "5310",
      "5315",
      "5320",
      "5330",
      "5340",
      "4730",
    ],
    490: ["6630", "6640", "6510", "6515"],
    615: ["4730", "4820", "9510", "9520", "9535"],
    680: ["4320", "4330"],
    760: ["4240", "8415", "8465", "8470", "7930"],
    835: ["2320", "2530", "2540", "2910", "2940", "3030", "3110"],
  };

  const PSC_LABELS = {
    3030: "Bearings - Plain",
    3110: "Bearings - Antifriction",
    4110: "Refrigeration Equip",
    4120: "Air Conditioning Equip",
    4130: "Refrigeration Components",
    4240: "Safety/Rescue Equip",
    4320: "Power Driven Pumps",
    4330: "Compressors",
    4730: "Hose, Pipe, Tube Fittings",
    4820: "Valves",
    4910: "Shop Equipment",
    4940: "Maintenance Equipment",
    5110: "Hand Tools - Edged",
    5120: "Hand Tools - Non-Edged",
    5305: "Screws",
    5306: "Bolts",
    5307: "Studs",
    5310: "Nuts & Washers",
    5315: "Nails, Keys, Pins",
    5320: "Rivets",
    5330: "Packing & Gasket Materials",
    5340: "Hardware",
    6110: "Electrical Control Equip",
    6115: "Generators",
    6120: "Power Distribution Equip",
    6150: "Misc Electrical Wire",
    6230: "Electric Lighting Equip",
    6630: "Chemical Analysis Instruments",
    6640: "Lab Equip",
    6510: "Medical/Surgical",
    6515: "Medical/EMS/Field",
    7110: "Office Furniture",
    7125: "Storage/Shelving",
    7930: "Cleaning Compounds",
    8415: "Individual Equipment",
    8465: "Carrying Equipment",
    8470: "Armor",
    9150: "Oils & Greases",
    9510: "Ferrous Metal Bars",
    9520: "Ferrous Metal Sheet",
    9535: "Iron & Steel Structural Shapes",
    2320: "Military Trucks/Vehicles",
    2530: "Vehicle Brake/Steering/Axle",
    2540: "Motor Vehicle Components",
    2910: "Engine Fuel System",
    2940: "Engine Cooling/Filters",
    1005: "Guns Through 30mm",
    1095: "Misc Weapons",
  };

  const NIGP_LABELS = {
    345: "Compressors & HVAC",
    400: "Electrical & Electronics",
    450: "Industrial Machinery & Equip",
    475: "Hardware & Fasteners",
    490: "Lab Equip & Supplies",
    615: "Plumbing, Pipe & Fittings",
    680: "Pumps & Compressors",
    760: "Safety & PPE",
    835: "Vehicles & Auto Parts",
  };

  // ── Status helpers ────────────────────────────────────────────────────
  function statusInfo(d) {
    if (d.responded && String(d.responded).trim())
      return { color: "var(--green, #4ade80)", label: "RESPONDED" };
    if (d.contacted && String(d.contacted).trim())
      return { color: "#facc15", label: "CONTACTED" };
    return { color: "#6b7280", label: "COLD" };
  }

  function frictionColor(f) {
    if (f === "low") return "#4ade80";
    if (f === "medium") return "#facc15";
    if (f === "high") return "#f87171";
    return "rgba(201,168,76,0.4)";
  }

  // ── Field component ───────────────────────────────────────────────────
  function Field({ label, value, href }) {
    if (!value || value === "--") return null;
    return h(
      "div",
      null,
      h(
        "div",
        {
          style: {
            fontSize: "13px",
            letterSpacing: ".2em",
            color: "rgba(201,168,76,0.35)",
            marginBottom: "3px",
          },
        },
        label,
      ),
      href
        ? h(
            "a",
            {
              href,
              target: "_blank",
              rel: "noopener noreferrer",
              style: {
                fontSize: "16px",
                color: "var(--gold-solid,#c9a84c)",
                textDecoration: "none",
                borderBottom: "1px solid rgba(201,168,76,0.25)",
              },
            },
            value,
          )
        : h(
            "div",
            {
              style: {
                fontSize: "16px",
                color: "rgba(201,168,76,0.8)",
                lineHeight: "1.4",
              },
            },
            value,
          ),
    );
  }

  // ── Supplier card ─────────────────────────────────────────────────────
  function SupplierCard({ d }) {
    const [open, setOpen] = useState(false);
    const { color, label } = statusInfo(d);
    const fscList = (d.fsc || []).join(", ");
    const tags = (d.tags || []).join(" · ") || null;

    return h(
      "div",
      {
        style: {
          border: open
            ? "1px solid rgba(201,168,76,0.35)"
            : "1px solid rgba(201,168,76,0.1)",
          borderRadius: "4px",
          background: open ? "rgba(201,168,76,0.04)" : "rgba(201,168,76,0.01)",
          marginBottom: "8px",
          overflow: "hidden",
          transition: "border-color .15s",
        },
      },
      // Header row
      h(
        "div",
        {
          onClick: () => setOpen(!open),
          style: {
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "11px 16px",
            cursor: "pointer",
          },
        },
        h("div", {
          style: {
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: color,
            boxShadow: `0 0 6px ${color}`,
            flexShrink: 0,
          },
        }),
        h(
          "div",
          { style: { flex: 1 } },
          h(
            "div",
            {
              style: {
                fontSize: "18px",
                fontWeight: "bold",
                letterSpacing: ".04em",
              },
            },
            d.name,
          ),
          h(
            "div",
            {
              style: {
                fontSize: "14px",
                color: "rgba(201,168,76,0.45)",
                letterSpacing: ".1em",
                marginTop: "2px",
              },
            },
            `Tier ${d.tier || "?"} · FSC ${fscList || "—"}`,
          ),
        ),
        d.friction &&
          h(
            "div",
            {
              style: {
                fontSize: "13px",
                color: frictionColor(d.friction),
                letterSpacing: ".12em",
                marginRight: "6px",
              },
            },
            d.friction.toUpperCase(),
          ),
        h(
          "div",
          {
            style: {
              fontSize: "13px",
              letterSpacing: ".12em",
              color,
              padding: "3px 8px",
              border: `1px solid ${color}33`,
              borderRadius: "2px",
              flexShrink: 0,
            },
          },
          label,
        ),
        h(
          "div",
          {
            style: {
              color: "rgba(201,168,76,0.3)",
              fontSize: "16px",
              marginLeft: "6px",
            },
          },
          open ? "▲" : "▼",
        ),
      ),
      // Detail grid
      open &&
        h(
          "div",
          {
            style: {
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "12px",
              padding: "14px 16px 16px",
              borderTop: "1px solid rgba(201,168,76,0.08)",
            },
          },
          h(Field, {
            label: "PHONE",
            value: d.phone,
            href: d.phone ? `tel:${(d.phone || "").replace(/\D/g, "")}` : null,
          }),
          h(Field, {
            label: "EMAIL",
            value: d.email,
            href: d.email ? `mailto:${d.email}` : null,
          }),
          h(Field, {
            label: "WEBSITE",
            value: d.website ? d.website.replace(/^https?:\/\//, "") : null,
            href: d.website || null,
          }),
          h(Field, { label: "FRICTION", value: d.friction || null }),
          d.contacted && h(Field, { label: "CONTACTED", value: d.contacted }),
          d.responded && h(Field, { label: "RESPONDED", value: d.responded }),
          tags &&
            h(
              "div",
              { style: { gridColumn: "1/-1" } },
              h(Field, { label: "TAGS", value: tags }),
            ),
          d.notes &&
            h(
              "div",
              { style: { gridColumn: "1/-1" } },
              h(Field, { label: "NOTES", value: d.notes }),
            ),
        ),
    );
  }

  // ── Quick pick button grid ─────────────────────────────────────────────
  function QuickPick({ mode, activeCode, onPick, distributors }) {
    const map = mode === "PSC" ? PSC_LABELS : NIGP_LABELS;
    const codeToFsc = mode === "PSC" ? PSC_TO_FSC : NIGP_TO_FSC;

    const codes = Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));

    return h(
      "div",
      {
        style: {
          display: "flex",
          flexWrap: "wrap",
          gap: "6px",
          marginBottom: "28px",
        },
      },
      codes.map(([code, label]) => {
        const fscs = codeToFsc[code] || [];
        const count = distributors.filter((d) =>
          (d.fsc || []).some((f) => fscs.includes(f)),
        ).length;
        if (!count) return null;
        const words = label.split(" ").slice(0, 3).join(" ");
        const active = code === activeCode;
        return h(
          "button",
          {
            key: code,
            onClick: () => onPick(code),
            style: {
              padding: "5px 10px",
              background: active
                ? "rgba(201,168,76,0.15)"
                : "rgba(201,168,76,0.04)",
              border: active
                ? "1px solid rgba(201,168,76,0.5)"
                : "1px solid rgba(201,168,76,0.1)",
              color: active
                ? "var(--gold-solid,#c9a84c)"
                : "rgba(201,168,76,0.55)",
              fontFamily: "var(--font-mono,'Courier New',monospace)",
              fontSize: "15px",
              cursor: "pointer",
              borderRadius: "3px",
              transition: "all .1s",
              whiteSpace: "nowrap",
            },
          },
          code,
          h(
            "span",
            { style: { color: "rgba(201,168,76,0.4)", marginLeft: "4px" } },
            `· ${words}`,
          ),
          h(
            "span",
            {
              style: { color: "#4ade80", fontSize: "14px", marginLeft: "6px" },
            },
            count,
          ),
        );
      }),
    );
  }

  // ── Main tab ──────────────────────────────────────────────────────────
  function LaneLookupTab() {
    const [mode, setMode] = useState("PSC");
    const [query, setQuery] = useState("");
    const [activeCode, setActiveCode] = useState(null);
    const [results, setResults] = useState(null); // { code, label, matches }
    const [distributors, setDistributors] = useState([]);
    const [loading, setLoading] = useState(true);

    // Load from SCC_DIST cache on mount + when dist cache updates
    useEffect(() => {
      function load() {
        const dists = window.SCC_DIST ? [...window.SCC_DIST.DISTRIBUTORS] : [];
        setDistributors(dists);
        setLoading(false);
      }
      if (window.SCC_DIST) {
        window.SCC_DIST.onReady(load);
      } else {
        setLoading(false);
      }
    }, []);

    const runSearch = useCallback(
      (code) => {
        if (!code) return;
        const codeToFsc = mode === "PSC" ? PSC_TO_FSC : NIGP_TO_FSC;
        const labelMap = mode === "PSC" ? PSC_LABELS : NIGP_LABELS;
        const fscs = codeToFsc[code] || [];
        const matches = distributors.filter((d) =>
          (d.fsc || []).some((f) => fscs.includes(f)),
        );
        setResults({ code, label: labelMap[code] || "UNKNOWN", fscs, matches });
        setActiveCode(code);
      },
      [mode, distributors],
    );

    const handlePick = (code) => {
      setQuery(code);
      runSearch(code);
    };

    const switchMode = (m) => {
      setMode(m);
      setQuery("");
      setActiveCode(null);
      setResults(null);
    };

    const s = (obj) => obj; // style passthrough

    return h(
      "div",
      { style: { padding: "20px" } },

      // Mode toggle
      h(
        "div",
        { style: { display: "flex", gap: "8px", marginBottom: "20px" } },
        ["PSC", "NIGP"].map((m) =>
          h(
            "button",
            {
              key: m,
              onClick: () => switchMode(m),
              style: {
                padding: "7px 20px",
                background:
                  mode === m ? "rgba(201,168,76,0.15)" : "transparent",
                border:
                  mode === m
                    ? "1px solid rgba(201,168,76,0.5)"
                    : "1px solid rgba(201,168,76,0.15)",
                color:
                  mode === m
                    ? "var(--gold-solid,#c9a84c)"
                    : "rgba(201,168,76,0.4)",
                fontFamily: "var(--font-mono,'Courier New',monospace)",
                fontSize: "16px",
                letterSpacing: ".15em",
                cursor: "pointer",
                borderRadius: "3px",
              },
            },
            `${m} MODE`,
          ),
        ),
      ),

      // Search row
      h(
        "div",
        { style: { display: "flex", gap: "8px", marginBottom: "16px" } },
        h("input", {
          value: query,
          onChange: (e) => setQuery(e.target.value),
          onKeyDown: (e) => {
            if (e.key === "Enter") runSearch(query.trim());
          },
          placeholder:
            mode === "PSC" ? "e.g. 5305  or  6115" : "e.g. 475  or  680",
          style: {
            flex: 1,
            background: "rgba(201,168,76,0.04)",
            border: "1px solid rgba(201,168,76,0.25)",
            color: "var(--gold-solid,#c9a84c)",
            fontFamily: "var(--font-mono,'Courier New',monospace)",
            fontSize: "19px",
            padding: "10px 14px",
            borderRadius: "3px",
            outline: "none",
          },
        }),
        h(
          "button",
          {
            onClick: () => runSearch(query.trim()),
            style: {
              padding: "10px 22px",
              background: "rgba(201,168,76,0.12)",
              border: "1px solid rgba(201,168,76,0.4)",
              color: "var(--gold-solid,#c9a84c)",
              fontFamily: "var(--font-mono,'Courier New',monospace)",
              fontSize: "16px",
              letterSpacing: ".15em",
              cursor: "pointer",
              borderRadius: "3px",
            },
          },
          "SEARCH",
        ),
      ),

      // Loading state
      loading &&
        h(
          "div",
          {
            style: {
              color: "rgba(201,168,76,0.4)",
              fontSize: "16px",
              letterSpacing: ".1em",
              marginBottom: "16px",
            },
          },
          "LOADING DISTRIBUTOR DB…",
        ),

      // Empty DB warning
      !loading &&
        distributors.length === 0 &&
        h(
          "div",
          {
            style: {
              padding: "16px",
              border: "1px solid rgba(201,168,76,0.1)",
              borderRadius: "4px",
              color: "rgba(201,168,76,0.4)",
              fontSize: "16px",
              letterSpacing: ".1em",
              marginBottom: "16px",
            },
          },
          "NO DISTRIBUTORS IN DB — SEED REQUIRED VIA SOURCE TAB",
        ),

      // Quick pick
      !loading &&
        distributors.length > 0 &&
        h(
          "div",
          { style: { marginBottom: "8px" } },
          h(
            "div",
            {
              style: {
                fontSize: "14px",
                letterSpacing: ".2em",
                color: "rgba(201,168,76,0.35)",
                marginBottom: "10px",
              },
            },
            `QUICK PICK — ${mode} LANES WITH DB COVERAGE`,
          ),
          h(QuickPick, { mode, activeCode, onPick: handlePick, distributors }),
        ),

      // Results
      results &&
        h(
          "div",
          null,
          h(
            "div",
            {
              style: {
                fontSize: "14px",
                letterSpacing: ".2em",
                color: "rgba(201,168,76,0.4)",
                borderTop: "1px solid rgba(201,168,76,0.1)",
                paddingTop: "16px",
                marginBottom: "14px",
              },
            },
            `${mode} ${results.code} — ${results.label}`,
            "   ·   ",
            h(
              "span",
              {
                style: {
                  color: results.matches.length > 0 ? "#4ade80" : "#ef4444",
                },
              },
              `${results.matches.length} SUPPLIER${results.matches.length !== 1 ? "S" : ""} MATCHED`,
            ),
            results.fscs.length &&
              h(
                "span",
                {
                  style: { color: "rgba(201,168,76,0.3)", marginLeft: "12px" },
                },
                `FSC → ${results.fscs.join(", ")}`,
              ),
          ),

          results.matches.length === 0
            ? h(
                "div",
                {
                  style: {
                    padding: "24px",
                    textAlign: "center",
                    border: "1px solid rgba(201,168,76,0.1)",
                    borderRadius: "4px",
                    color: "rgba(201,168,76,0.3)",
                    fontSize: "17px",
                    letterSpacing: ".1em",
                  },
                },
                "NO DB MATCH — SOURCING REQUIRED FOR THIS LANE",
              )
            : results.matches.map((d, i) =>
                h(SupplierCard, { key: d.id || i, d }),
              ),
        ),

      // Legend
      h(
        "div",
        {
          style: {
            marginTop: "32px",
            paddingTop: "16px",
            borderTop: "1px solid rgba(201,168,76,0.08)",
            display: "flex",
            gap: "20px",
          },
        },
        [
          ["#4ade80", "RESPONDED"],
          ["#facc15", "CONTACTED"],
          ["#6b7280", "COLD"],
        ].map(([c, l]) =>
          h(
            "div",
            {
              key: l,
              style: { display: "flex", alignItems: "center", gap: "6px" },
            },
            h("div", {
              style: {
                width: "7px",
                height: "7px",
                borderRadius: "50%",
                background: c,
                boxShadow: c !== "#6b7280" ? `0 0 5px ${c}` : "none",
              },
            }),
            h(
              "span",
              {
                style: {
                  fontSize: "14px",
                  letterSpacing: ".12em",
                  color: "rgba(201,168,76,0.35)",
                },
              },
              l,
            ),
          ),
        ),
      ),
    );
  }

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.LaneLookupTab = LaneLookupTab;
})();
