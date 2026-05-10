(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — BLAST TAB
  //  Pre-pipeline sourcing engine.
  //  Flow: Paste sols → FSC auto-sort → pull distributors from MongoDB
  //        → RFQ drafts per distributor → send → track response
  //        → quote received → push to pipeline
  //  Pre-compiled React · No Babel · No JSX
  //  Exposes: window.SCC_TABS.BlastTab
  // ═══════════════════════════════════════════════════════════════════════

  const {
    createElement: h,
    useState,
    useEffect,
    useCallback,
    useRef,
    Fragment: Frag,
  } = React;

  // ── FSC name map (shared with rest of SCC) ──────────────────────────
  const FSC_NAMES = {
    2510: "Vehicular Cab/Body/Frame",
    2530: "Brake/Steering/Axle",
    2540: "Vehicular Furniture",
    2910: "Engine Fuel System",
    2940: "Engine Filters",
    2990: "Engine Accessories",
    3020: "Gears/Pulleys/Sprockets",
    3030: "Belting/Drive Belts",
    3110: "Bearings",
    4110: "Refrigeration Equipment",
    4210: "Fire Fighting Equipment",
    4240: "Safety/PPE/Rescue Equipment",
    4320: "Power/Hand Pumps",
    4330: "Filters/Separators",
    4710: "Pipe/Tube",
    4730: "Hose/Pipe Fittings/Valves",
    4820: "Valves",
    4910: "Shop Equipment",
    4940: "Maintenance Equipment",
    5110: "Hand Tools",
    5120: "Power Tools",
    5305: "Screws",
    5306: "Bolts",
    5310: "Nuts/Washers",
    5315: "Pins/Rivets",
    5320: "Rivets",
    5330: "Packing/Gaskets",
    5331: "Seals/O-Rings",
    5340: "Commercial Hardware",
    5365: "Bushings/Bearings/Mountings",
    5920: "Fuses/Arrestors",
    5925: "Circuit Breakers",
    5935: "Electrical Connectors",
    5961: "Semiconductors",
    5962: "Electronic Components",
    5975: "Electrical Hardware",
    6110: "Electrical Control Equipment",
    6120: "Power Distribution Equipment",
    6135: "Primary Batteries",
    6140: "Secondary Batteries",
    6145: "Wire/Cable",
    6150: "Electrical Wire/Cable",
    6210: "Indoor/Outdoor Lighting Fixtures",
    6230: "Portable/Hand Lighting",
    6240: "Electric Lamps",
    6350: "Signal/Warning Devices",
    6505: "Drugs/Biologicals",
    6530: "Medical/Dental Instruments",
    6532: "Hospital/Surgical Equipment",
    6630: "Chemical Analysis Instruments",
    6640: "Laboratory Equipment",
    6810: "Chemicals",
    6840: "Pest Control",
    6850: "Misc Chemical Specialties",
    6910: "Training Aids",
    7110: "Office Furniture",
    7125: "Containers/Bins",
    7310: "Food Cooking Equipment",
    7320: "Kitchen Equipment",
    7330: "Food Service Equipment",
    7930: "Cleaning Compounds",
    8415: "Individual Equipment",
    8430: "Footwear",
    8455: "Badges/Insignia",
    8465: "Packs/Bags",
    8470: "Armor/Body Protection",
    9150: "Oils/Lubricants",
    9510: "Ferrous Metal Bar/Sheet",
    9520: "Nonferrous Metal Bar",
    9535: "Metal Plate/Sheet/Strip",
    9540: "Structural Metal",
  };

  // ── API call to SCC backend ─────────────────────────────────────────
  async function apiCall(action, payload = {}) {
    console.log("[Blast] →", action, JSON.stringify(payload));
    const res = await fetch("/.netlify/functions/scc-distributors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, payload }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => String(res.status));
      console.error("[Blast] HTTP", res.status, txt);
      throw new Error("API " + res.status + ": " + txt);
    }
    const data = await res.json();
    console.log("[Blast] ←", action, JSON.stringify(data).slice(0, 300));
    return data;
  }

  // ── Parse pasted sol lines ──────────────────────────────────────────
  // Accepts the standard SCC batch format:
  // SOL_ID | ITEM_NAME | DUE | FSC | EXT | STATUS
  function parseSolLines(raw) {
    const sols = [];
    const lines = raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    for (const line of lines) {
      // Skip comment/header lines
      if (line.startsWith("//") || line.startsWith("#")) continue;
      const parts = line.split("|").map((p) => p.trim());
      if (parts.length < 4) continue;
      const [id, nom, due, fsc, ext, status] = parts;
      if (!id || !nom || !fsc) continue;
      sols.push({
        id: id.toUpperCase(),
        nom: nom.toUpperCase(),
        due: due || "",
        fsc: fsc.trim(),
        ext: parseFloat((ext || "0").replace(/[$,]/g, "")) || 0,
        status: (status || "GO").trim().toUpperCase(),
      });
    }
    return sols;
  }

  // ── Group sols by FSC ───────────────────────────────────────────────
  function groupByFsc(sols) {
    const map = {};
    for (const sol of sols) {
      if (!map[sol.fsc]) map[sol.fsc] = [];
      map[sol.fsc].push(sol);
    }
    return map;
  }

  // ── Build RFQ email body ────────────────────────────────────────────
  // One email per distributor covers ALL sols in their FSC lane.
  // No SOL numbers, no NSNs per protocol.
  function buildRFQEmail(dist, sols) {
    const fscName = FSC_NAMES[sols[0].fsc] || "Industrial Supplies";
    const itemLines = sols
      .map(
        (s, i) =>
          `  ${i + 1}. ${s.nom}${s.ext > 0 ? " — Est. Value $" + s.ext.toLocaleString() : ""}`,
      )
      .join("\n");

    return `Subject: RFQ – ${fscName} | Government Requirement | Imperio Federal Logistics

Hi ${dist.name},

My name is Anthony Kelley with Imperio Federal Logistics. We are a government supply contractor supporting DLA requirements and I have an active government procurement need in your lane.

I need pricing and availability on the following items:

${itemLines}

Details:
- Destination: Government delivery address (continental US)
- Payment: Immediate PO upon award — we use third-party PO funding (Factoring Express) — supplier receives direct wire payment before shipment
- Delivery: Standard lead time acceptable; expedited preferred where available
- Compliance: BAA/TAA required — please confirm country of origin on all items
- Shipping: FOB Destination required

We are not looking for a one-time transaction. We are building a recurring government supplier relationship in this lane. We issue POs immediately upon award and have established government payment infrastructure.

Can you provide pricing on any or all of the above? If you need manufacturer part numbers or additional specs, I can provide those item by item.

Thank you,

Anthony K Kelley | Founder & CEO
Imperio Federal Logistics
The House of Kel LLC · CAGE 152U4
SDVOSB | ⭐ | VetHUB
anthony@ifedlog.com | ifedlog.com
(254) 226-5216`;
  }

  // ── BLAST LOG (localStorage) ────────────────────────────────────────
  const BLAST_LOG_KEY = "imperio_blast_log_v1";

  function loadBlastLog() {
    try {
      return JSON.parse(localStorage.getItem(BLAST_LOG_KEY) || "[]");
    } catch {
      return [];
    }
  }
  function saveBlastLog(log) {
    localStorage.setItem(BLAST_LOG_KEY, JSON.stringify(log));
  }
  function addBlastEntry(entry) {
    const log = loadBlastLog();
    log.unshift({
      ...entry,
      id: Date.now(),
      sent_at: new Date().toISOString(),
    });
    saveBlastLog(log.slice(0, 500)); // keep last 500
  }
  function updateBlastEntry(id, updates) {
    const log = loadBlastLog();
    const idx = log.findIndex((e) => e.id === id);
    if (idx === -1) return;
    log[idx] = { ...log[idx], ...updates };
    saveBlastLog(log);
  }

  // ── STYLES ──────────────────────────────────────────────────────────
  const S = {
    page: { animation: "fadeUp .5s ease both" },
    header: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: "20px",
      flexWrap: "wrap",
      gap: "12px",
    },
    title: {
      fontFamily: "Cinzel,serif",
      fontSize: "18px",
      letterSpacing: ".12em",
      color: "var(--gold-solid,#C9A84C)",
      textTransform: "uppercase",
    },
    sub: {
      fontFamily: "Cormorant Garamond,serif",
      fontSize: "13px",
      fontStyle: "italic",
      color: "var(--body-dim,rgba(245,240,232,.45))",
      marginTop: "4px",
    },
    card: {
      background: "var(--card-bg,rgba(42,0,10,.55))",
      border: "1px solid rgba(201,168,76,.15)",
      borderRadius: "4px",
      padding: "18px 20px",
      marginBottom: "14px",
    },
    cardTitle: {
      fontFamily: "Cinzel,serif",
      fontSize: "11px",
      letterSpacing: ".14em",
      color: "var(--gold-solid,#C9A84C)",
      textTransform: "uppercase",
      marginBottom: "10px",
    },
    textarea: {
      width: "100%",
      minHeight: "120px",
      background: "var(--inset-bg,rgba(0,0,0,.35))",
      border: "1px solid rgba(201,168,76,.2)",
      color: "var(--alabaster,#F5F0E8)",
      fontFamily: "JetBrains Mono,monospace",
      fontSize: "11px",
      padding: "10px 12px",
      borderRadius: "3px",
      outline: "none",
      resize: "vertical",
      boxSizing: "border-box",
      letterSpacing: ".03em",
    },
    btn: {
      fontFamily: "JetBrains Mono,monospace",
      fontSize: "10px",
      letterSpacing: ".08em",
      padding: "8px 18px",
      border: "1px solid rgba(201,168,76,.4)",
      background: "transparent",
      color: "var(--gold-solid,#C9A84C)",
      cursor: "pointer",
      borderRadius: "3px",
      textTransform: "uppercase",
      transition: "background .15s,color .15s",
    },
    btnPrimary: {
      fontFamily: "JetBrains Mono,monospace",
      fontSize: "10px",
      letterSpacing: ".08em",
      padding: "8px 18px",
      border: "none",
      background: "linear-gradient(135deg,#8a5c00,#c9930a,#7a5000)",
      color: "#111",
      cursor: "pointer",
      borderRadius: "3px",
      textTransform: "uppercase",
      fontWeight: "700",
    },
    btnDanger: {
      fontFamily: "JetBrains Mono,monospace",
      fontSize: "10px",
      letterSpacing: ".08em",
      padding: "6px 14px",
      border: "1px solid rgba(231,76,60,.3)",
      background: "transparent",
      color: "rgba(231,76,60,.7)",
      cursor: "pointer",
      borderRadius: "3px",
      textTransform: "uppercase",
    },
    btnSm: {
      fontFamily: "JetBrains Mono,monospace",
      fontSize: "9px",
      letterSpacing: ".06em",
      padding: "4px 10px",
      border: "1px solid rgba(201,168,76,.25)",
      background: "transparent",
      color: "rgba(245,240,232,.6)",
      cursor: "pointer",
      borderRadius: "3px",
    },
    badge: (color) => ({
      display: "inline-block",
      fontFamily: "JetBrains Mono,monospace",
      fontSize: "9px",
      padding: "2px 7px",
      borderRadius: "2px",
      letterSpacing: ".06em",
      background: color,
      color: "#111",
      fontWeight: "700",
    }),
    row: {
      display: "flex",
      gap: "8px",
      alignItems: "center",
      flexWrap: "wrap",
    },
    mono: {
      fontFamily: "JetBrains Mono,monospace",
      fontSize: "11px",
      color: "var(--alabaster,#F5F0E8)",
    },
    dim: {
      fontFamily: "JetBrains Mono,monospace",
      fontSize: "10px",
      color: "var(--body-dim,rgba(245,240,232,.45))",
    },
    divider: {
      height: "1px",
      background: "rgba(201,168,76,.12)",
      margin: "14px 0",
    },
    fscSection: {
      marginBottom: "20px",
      border: "1px solid rgba(201,168,76,.12)",
      borderRadius: "4px",
      overflow: "hidden",
    },
    fscHeader: {
      background: "rgba(201,168,76,.06)",
      padding: "10px 14px",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      borderBottom: "1px solid rgba(201,168,76,.1)",
    },
    distCard: {
      padding: "12px 14px",
      borderBottom: "1px solid rgba(201,168,76,.07)",
      background: "var(--card-bg,rgba(42,0,10,.35))",
    },
    emailBox: {
      background: "rgba(0,0,0,.4)",
      border: "1px solid rgba(201,168,76,.15)",
      borderRadius: "3px",
      padding: "12px 14px",
      fontFamily: "JetBrains Mono,monospace",
      fontSize: "10px",
      color: "rgba(245,240,232,.75)",
      whiteSpace: "pre-wrap",
      lineHeight: "1.65",
      maxHeight: "280px",
      overflowY: "auto",
      marginTop: "8px",
    },
    logRow: {
      padding: "10px 14px",
      borderBottom: "1px solid rgba(201,168,76,.07)",
      display: "flex",
      gap: "12px",
      alignItems: "flex-start",
      flexWrap: "wrap",
    },
  };

  // ── BLAST TAB COMPONENT ─────────────────────────────────────────────
  function BlastTab() {
    const [solInput, setSolInput] = useState("");
    const [parsedSols, setParsedSols] = useState([]);
    const [parseError, setParseError] = useState("");
    const [fscGroups, setFscGroups] = useState({}); // { fsc: { sols, dists } }
    const [loading, setLoading] = useState(false);
    const [loadingFsc, setLoadingFsc] = useState("");
    const [expandedFsc, setExpandedFsc] = useState({});
    const [expandedEmail, setExpandedEmail] = useState({}); // { fsc-distId: bool }
    const [blastLog, setBlastLog] = useState(loadBlastLog());
    const [activeView, setActiveView] = useState("blast"); // blast | log
    const [copiedKey, setCopiedKey] = useState("");
    const [status, setStatus] = useState("");

    const refreshLog = () => setBlastLog(loadBlastLog());

    // ── Parse sols from textarea ──
    const handleParse = useCallback(() => {
      setParseError("");
      const sols = parseSolLines(solInput);
      if (!sols.length) {
        setParseError(
          "No valid sol lines found. Format: SOL_ID | ITEM_NAME | DUE | FSC | EXT | STATUS",
        );
        return;
      }
      setParsedSols(sols);
      setFscGroups({});
      setExpandedFsc({});
      setStatus(
        sols.length +
          " sols parsed. " +
          Object.keys(groupByFsc(sols)).length +
          " FSC lanes. Ready to load distributors.",
      );
    }, [solInput]);

    // ── Load distributors for all FSC lanes from MongoDB ──
    const handleLoadDists = useCallback(async () => {
      if (!parsedSols.length) return;
      setLoading(true);
      setStatus("Loading distributors from DB...");
      const groups = groupByFsc(parsedSols);
      const result = {};
      for (const fsc of Object.keys(groups)) {
        setLoadingFsc(fsc);
        try {
          const raw = await apiCall("distGetByFSC", { fsc });
          // Backend returns result directly or wrapped in { result: [...] }
          const dists = Array.isArray(raw)
            ? raw
            : Array.isArray(raw.result)
              ? raw.result
              : [];
          console.log(
            "[Blast] FSC",
            fsc,
            "→",
            dists.length,
            "dists",
            dists.map((d) => d.name || d.id),
          );
          result[fsc] = { sols: groups[fsc], dists };
        } catch (e) {
          console.error("[Blast] FSC", fsc, "error:", e.message);
          result[fsc] = { sols: groups[fsc], dists: [], error: e.message };
        }
      }
      setFscGroups(result);
      setExpandedFsc(
        Object.fromEntries(Object.keys(result).map((f) => [f, true])),
      );
      setLoading(false);
      setLoadingFsc("");
      const totalDists = Object.values(result).reduce(
        (s, g) => s + g.dists.length,
        0,
      );
      setStatus(
        "Loaded. " +
          Object.keys(result).length +
          " lanes · " +
          totalDists +
          " distributor contacts ready.",
      );
    }, [parsedSols]);

    // ── Copy email to clipboard ──
    const handleCopy = useCallback((key, text) => {
      navigator.clipboard.writeText(text).then(() => {
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(""), 2000);
      });
    }, []);

    // ── Mark as sent → log entry ──
    const handleMarkSent = useCallback((fsc, dist, sols) => {
      const email = buildRFQEmail(dist, sols);
      addBlastEntry({
        fsc,
        fsc_name: FSC_NAMES[fsc] || fsc,
        dist_id: dist.id,
        dist_name: dist.name,
        dist_email: dist.email || "",
        sol_ids: sols.map((s) => s.id),
        sol_noms: sols.map((s) => s.nom),
        email_body: email,
        status: "sent",
        quoted: false,
        quote_note: "",
      });
      refreshLog();
      setStatus(
        "Logged blast to " +
          dist.name +
          " covering " +
          sols.length +
          " sol(s).",
      );
    }, []);

    // ── Update log entry status ──
    const handleLogUpdate = useCallback((id, field, value) => {
      updateBlastEntry(id, { [field]: value });
      refreshLog();
    }, []);

    // ── Clear log ──
    const handleClearLog = useCallback(() => {
      if (!confirm("Clear entire blast log? Cannot be undone.")) return;
      saveBlastLog([]);
      refreshLog();
    }, []);

    // ── RENDER ──
    return h(
      "div",
      { style: S.page },

      // ── Header ──
      h(
        "div",
        { style: S.header },
        h(
          "div",
          null,
          h("div", { style: S.title }, "⚡ Blast Engine"),
          h(
            "div",
            { style: S.sub },
            "Pre-pipeline sourcing · FSC routing · Distributor RFQ blast",
          ),
        ),
        h(
          "div",
          { style: S.row },
          h(
            "button",
            {
              style: {
                ...S.btn,
                borderColor:
                  activeView === "blast" ? "rgba(201,168,76,.7)" : undefined,
                color:
                  activeView === "blast"
                    ? "var(--gold-solid,#C9A84C)"
                    : undefined,
              },
              onClick: () => setActiveView("blast"),
            },
            "⚡ Blast",
          ),
          h(
            "button",
            {
              style: {
                ...S.btn,
                borderColor:
                  activeView === "log" ? "rgba(201,168,76,.7)" : undefined,
                color:
                  activeView === "log"
                    ? "var(--gold-solid,#C9A84C)"
                    : undefined,
              },
              onClick: () => {
                setActiveView("log");
                refreshLog();
              },
            },
            "📋 Blast Log (" + blastLog.length + ")",
          ),
        ),
      ),

      // ── STATUS BAR ──
      status &&
        h(
          "div",
          {
            style: {
              fontFamily: "JetBrains Mono,monospace",
              fontSize: "10px",
              color: "#2ecc71",
              background: "rgba(46,204,113,.08)",
              border: "1px solid rgba(46,204,113,.2)",
              borderRadius: "3px",
              padding: "7px 12px",
              marginBottom: "14px",
              letterSpacing: ".04em",
            },
          },
          "▶ " + status,
        ),

      // ═══════════════════════════════════════
      //  BLAST VIEW
      // ═══════════════════════════════════════
      activeView === "blast" &&
        h(
          Frag,
          null,

          // ── SOL INPUT ──
          h(
            "div",
            { style: S.card },
            h("div", { style: S.cardTitle }, "Step 1 — Paste Surviving Sols"),
            h(
              "div",
              { style: { ...S.dim, marginBottom: "8px" } },
              "Format: SOL_ID | ITEM_NAME | DUE | FSC | EXT | STATUS — one per line. Hard rejects already filtered.",
            ),
            h("textarea", {
              style: S.textarea,
              value: solInput,
              onChange: (e) => setSolInput(e.target.value),
              placeholder:
                "SPE4A7-26-R-0001 | BOLT HEX HEAD | 2026-05-15 | 5306 | 12450.00 | GO\nSPE4A7-26-R-0002 | VALVE GATE | 2026-05-20 | 4820 | 8200.00 | GO",
            }),
            parseError &&
              h(
                "div",
                {
                  style: {
                    color: "#e74c3c",
                    fontFamily: "JetBrains Mono,monospace",
                    fontSize: "10px",
                    marginTop: "6px",
                  },
                },
                "⚠ " + parseError,
              ),
            h(
              "div",
              { style: { ...S.row, marginTop: "10px" } },
              h(
                "button",
                { style: S.btnPrimary, onClick: handleParse },
                "Parse Sols",
              ),
              parsedSols.length > 0 &&
                h(
                  "span",
                  { style: S.dim },
                  parsedSols.length +
                    " sols · " +
                    Object.keys(groupByFsc(parsedSols)).length +
                    " lanes",
                ),
              parsedSols.length > 0 &&
                h(
                  "button",
                  {
                    style: S.btnDanger,
                    onClick: () => {
                      setParsedSols([]);
                      setFscGroups({});
                      setSolInput("");
                      setStatus("");
                    },
                  },
                  "Clear",
                ),
            ),
          ),

          // ── LOAD DISTRIBUTORS ──
          parsedSols.length > 0 &&
            h(
              "div",
              { style: S.card },
              h(
                "div",
                { style: S.cardTitle },
                "Step 2 — Load Distributor Blast Groups",
              ),
              h(
                "div",
                { style: { ...S.dim, marginBottom: "10px" } },
                "Pulls every distributor mapped to each FSC lane from the MongoDB distributor DB.",
              ),
              h(
                "button",
                {
                  style: { ...S.btnPrimary, opacity: loading ? 0.6 : 1 },
                  onClick: handleLoadDists,
                  disabled: loading,
                },
                loading
                  ? "Loading " + loadingFsc + "..."
                  : "Load Distributors by FSC",
              ),
            ),

          // ── FSC BLAST GROUPS ──
          Object.keys(fscGroups).length > 0 &&
            h(
              "div",
              null,
              h(
                "div",
                { style: { ...S.cardTitle, marginBottom: "12px" } },
                "Step 3 — Review & Fire RFQs",
              ),

              Object.keys(fscGroups)
                .sort()
                .map((fsc) => {
                  const { sols, dists, error } = fscGroups[fsc];
                  const isOpen = expandedFsc[fsc] !== false;
                  const fscLabel =
                    "FSC " + fsc + " — " + (FSC_NAMES[fsc] || fsc);
                  const totalExt = sols.reduce((s, d) => s + d.ext, 0);

                  return h(
                    "div",
                    { key: fsc, style: S.fscSection },

                    // FSC header
                    h(
                      "div",
                      {
                        style: { ...S.fscHeader, cursor: "pointer" },
                        onClick: () =>
                          setExpandedFsc((prev) => ({
                            ...prev,
                            [fsc]: !isOpen,
                          })),
                      },
                      h(
                        "div",
                        { style: S.row },
                        h(
                          "span",
                          {
                            style: {
                              fontFamily: "Cinzel,serif",
                              fontSize: "11px",
                              color: "var(--gold-solid,#C9A84C)",
                              letterSpacing: ".1em",
                            },
                          },
                          fscLabel,
                        ),
                        h(
                          "span",
                          { style: S.badge("rgba(201,168,76,.15)") },
                          sols.length + " sol" + (sols.length !== 1 ? "s" : ""),
                        ),
                        h(
                          "span",
                          { style: S.badge("rgba(46,204,113,.12)") },
                          "$" + totalExt.toLocaleString(),
                        ),
                        dists.length > 0 &&
                          h(
                            "span",
                            { style: S.badge("rgba(52,152,219,.15)") },
                            dists.length +
                              " dist" +
                              (dists.length !== 1 ? "s" : ""),
                          ),
                        error &&
                          h(
                            "span",
                            {
                              style: {
                                color: "#e74c3c",
                                fontSize: "10px",
                                fontFamily: "JetBrains Mono,monospace",
                              },
                            },
                            "⚠ " + error,
                          ),
                      ),
                      h(
                        "span",
                        {
                          style: {
                            color: "rgba(201,168,76,.5)",
                            fontSize: "12px",
                          },
                        },
                        isOpen ? "▲" : "▼",
                      ),
                    ),

                    // FSC body
                    isOpen &&
                      h(
                        "div",
                        null,

                        // Sol list
                        h(
                          "div",
                          {
                            style: {
                              padding: "10px 14px",
                              background: "rgba(0,0,0,.2)",
                              borderBottom: "1px solid rgba(201,168,76,.07)",
                            },
                          },
                          h(
                            "div",
                            { style: { ...S.dim, marginBottom: "6px" } },
                            "SOLICITATIONS IN THIS LANE:",
                          ),
                          sols.map((sol) =>
                            h(
                              "div",
                              {
                                key: sol.id,
                                style: { ...S.row, marginBottom: "4px" },
                              },
                              h(
                                "span",
                                {
                                  style: {
                                    fontFamily: "JetBrains Mono,monospace",
                                    fontSize: "10px",
                                    color: "var(--gold-solid,#C9A84C)",
                                    minWidth: "160px",
                                  },
                                },
                                sol.id,
                              ),
                              h(
                                "span",
                                {
                                  style: {
                                    fontFamily: "JetBrains Mono,monospace",
                                    fontSize: "10px",
                                    color: "rgba(245,240,232,.75)",
                                    flex: 1,
                                  },
                                },
                                sol.nom,
                              ),
                              sol.ext > 0 &&
                                h(
                                  "span",
                                  {
                                    style: {
                                      fontFamily: "JetBrains Mono,monospace",
                                      fontSize: "10px",
                                      color: "#2ecc71",
                                    },
                                  },
                                  "$" + sol.ext.toLocaleString(),
                                ),
                            ),
                          ),
                        ),

                        // No distributors state
                        dists.length === 0 &&
                          h(
                            "div",
                            {
                              style: {
                                padding: "16px 14px",
                                color: "rgba(231,76,60,.7)",
                                fontFamily: "JetBrains Mono,monospace",
                                fontSize: "10px",
                              },
                            },
                            "⚠ No distributors loaded for FSC " +
                              fsc +
                              ". Add contacts to the distributor DB first.",
                          ),

                        // Distributor cards
                        dists.map((dist) => {
                          const emailKey = fsc + "-" + dist.id;
                          const emailText = buildRFQEmail(dist, sols);
                          const isEmailOpen = expandedEmail[emailKey];
                          const isCopied = copiedKey === emailKey;

                          return h(
                            "div",
                            { key: dist.id, style: S.distCard },
                            h(
                              "div",
                              { style: { ...S.row, marginBottom: "8px" } },
                              h(
                                "span",
                                {
                                  style: {
                                    fontFamily: "JetBrains Mono,monospace",
                                    fontSize: "11px",
                                    color: "var(--alabaster,#F5F0E8)",
                                    fontWeight: "700",
                                    flex: 1,
                                  },
                                },
                                dist.name,
                              ),
                              h(
                                "span",
                                {
                                  style: S.badge(
                                    dist.tier === "L1"
                                      ? "rgba(201,168,76,.3)"
                                      : dist.tier === "L3"
                                        ? "rgba(231,76,60,.2)"
                                        : "rgba(52,152,219,.2)",
                                  ),
                                },
                                dist.tier || "L2",
                              ),
                            ),

                            h(
                              "div",
                              {
                                style: {
                                  ...S.row,
                                  marginBottom: "8px",
                                  gap: "16px",
                                },
                              },
                              dist.website &&
                                h(
                                  "a",
                                  {
                                    href: dist.website,
                                    target: "_blank",
                                    rel: "noopener",
                                    style: {
                                      fontFamily: "JetBrains Mono,monospace",
                                      fontSize: "10px",
                                      color: "rgba(52,152,219,.8)",
                                      textDecoration: "none",
                                    },
                                  },
                                  dist.website.replace("https://", ""),
                                ),
                              dist.email &&
                                h(
                                  "span",
                                  {
                                    style: {
                                      fontFamily: "JetBrains Mono,monospace",
                                      fontSize: "10px",
                                      color: "rgba(245,240,232,.5)",
                                    },
                                  },
                                  dist.email,
                                ),
                              dist.phone &&
                                h(
                                  "span",
                                  {
                                    style: {
                                      fontFamily: "JetBrains Mono,monospace",
                                      fontSize: "10px",
                                      color: "rgba(245,240,232,.5)",
                                    },
                                  },
                                  dist.phone,
                                ),
                            ),

                            dist.products &&
                              h(
                                "div",
                                {
                                  style: {
                                    ...S.dim,
                                    marginBottom: "8px",
                                    fontStyle: "italic",
                                  },
                                },
                                dist.products,
                              ),

                            h(
                              "div",
                              { style: S.row },
                              h(
                                "button",
                                {
                                  style: S.btnSm,
                                  onClick: () =>
                                    setExpandedEmail((prev) => ({
                                      ...prev,
                                      [emailKey]: !isEmailOpen,
                                    })),
                                },
                                isEmailOpen
                                  ? "Hide Email"
                                  : "Preview RFQ Email",
                              ),
                              dist.email &&
                                h(
                                  "a",
                                  {
                                    href:
                                      "https://mail.google.com/mail/?view=cm&to=" +
                                      encodeURIComponent(dist.email) +
                                      "&su=" +
                                      encodeURIComponent(
                                        "RFQ – " +
                                          (FSC_NAMES[fsc] || fsc) +
                                          " | Government Requirement | Imperio Federal Logistics",
                                      ) +
                                      "&body=" +
                                      encodeURIComponent(emailText),
                                    target: "_blank",
                                    rel: "noopener",
                                    style: {
                                      ...S.btn,
                                      textDecoration: "none",
                                      fontSize: "9px",
                                      padding: "4px 12px",
                                    },
                                  },
                                  "✉ Open in Gmail",
                                ),
                              h(
                                "button",
                                {
                                  style: {
                                    ...S.btnSm,
                                    color: isCopied ? "#2ecc71" : undefined,
                                    borderColor: isCopied
                                      ? "rgba(46,204,113,.4)"
                                      : undefined,
                                  },
                                  onClick: () =>
                                    handleCopy(emailKey, emailText),
                                },
                                isCopied ? "✓ Copied" : "Copy Email",
                              ),
                              h(
                                "button",
                                {
                                  style: {
                                    ...S.btnSm,
                                    color: "rgba(46,204,113,.8)",
                                    borderColor: "rgba(46,204,113,.3)",
                                  },
                                  onClick: () => {
                                    if (
                                      confirm(
                                        "Mark RFQ to " +
                                          dist.name +
                                          " as sent?",
                                      )
                                    )
                                      handleMarkSent(fsc, dist, sols);
                                  },
                                },
                                "✓ Mark Sent",
                              ),
                            ),

                            // Email preview
                            isEmailOpen &&
                              h("div", { style: S.emailBox }, emailText),
                          );
                        }),
                      ),
                  );
                }),
            ),
        ),

      // ═══════════════════════════════════════
      //  BLAST LOG VIEW
      // ═══════════════════════════════════════
      activeView === "log" &&
        h(
          "div",
          null,

          h(
            "div",
            { style: { ...S.row, marginBottom: "14px" } },
            h(
              "div",
              { style: { ...S.cardTitle, margin: 0 } },
              "Blast Log — " + blastLog.length + " entries",
            ),
            blastLog.length > 0 &&
              h(
                "button",
                { style: S.btnDanger, onClick: handleClearLog },
                "Clear Log",
              ),
          ),

          blastLog.length === 0 &&
            h(
              "div",
              { style: { ...S.dim, padding: "24px 0", textAlign: "center" } },
              "No blasts logged yet. Fire some RFQs and mark them sent.",
            ),

          blastLog.map((entry) =>
            h(
              "div",
              { key: entry.id, style: { ...S.card, padding: "12px 16px" } },
              h(
                "div",
                { style: { ...S.row, marginBottom: "8px" } },
                h(
                  "span",
                  {
                    style: {
                      fontFamily: "JetBrains Mono,monospace",
                      fontSize: "11px",
                      color: "var(--alabaster,#F5F0E8)",
                      fontWeight: "700",
                    },
                  },
                  entry.dist_name,
                ),
                h(
                  "span",
                  { style: S.badge("rgba(52,152,219,.2)") },
                  "FSC " + entry.fsc,
                ),
                h(
                  "span",
                  {
                    style: S.badge(
                      entry.quoted
                        ? "rgba(46,204,113,.25)"
                        : "rgba(201,168,76,.15)",
                    ),
                  },
                  entry.quoted ? "QUOTED ✓" : "AWAITING",
                ),
                h(
                  "span",
                  { style: S.dim },
                  new Date(entry.sent_at).toLocaleDateString(),
                ),
              ),

              h(
                "div",
                { style: { ...S.dim, marginBottom: "6px" } },
                "Sols: " + (entry.sol_ids || []).join(", "),
              ),

              entry.dist_email &&
                h(
                  "div",
                  { style: { ...S.dim, marginBottom: "8px" } },
                  "→ " + entry.dist_email,
                ),

              h(
                "div",
                { style: S.row },
                // Toggle quoted status
                h(
                  "button",
                  {
                    style: {
                      ...S.btnSm,
                      color: entry.quoted ? "rgba(46,204,113,.8)" : undefined,
                      borderColor: entry.quoted
                        ? "rgba(46,204,113,.4)"
                        : undefined,
                    },
                    onClick: () =>
                      handleLogUpdate(entry.id, "quoted", !entry.quoted),
                  },
                  entry.quoted ? "✓ Quoted" : "Mark Quoted",
                ),

                // Push to Pipeline
                entry.quoted &&
                  h(
                    "button",
                    {
                      style: {
                        ...S.btnSm,
                        color: "#2ecc71",
                        borderColor: "rgba(46,204,113,.5)",
                        background: "rgba(46,204,113,.08)",
                        fontWeight: "700",
                      },
                      onClick: () => {
                        if (window.SCC_TABS && window.SCC_TABS.goBlastIntake) {
                          window.SCC_TABS.goBlastIntake(entry);
                        } else {
                          alert(
                            "Navigation bridge not ready — refresh and try again.",
                          );
                        }
                      },
                    },
                    "→ Push to Intake",
                  ),
              ),

              // Quote note
              entry.quoted &&
                h("textarea", {
                  style: {
                    ...S.textarea,
                    minHeight: "50px",
                    marginTop: "8px",
                    fontSize: "10px",
                  },
                  placeholder:
                    "Quote details: price, lead time, COO, contact name...",
                  value: entry.quote_note || "",
                  onChange: (e) =>
                    handleLogUpdate(entry.id, "quote_note", e.target.value),
                }),
            ),
          ),
        ),
    );
  }

  // ── EXPOSE ──────────────────────────────────────────────────────────
  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.BlastTab = BlastTab;
})();
