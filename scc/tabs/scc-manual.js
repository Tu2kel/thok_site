(function () {
  const h = React.createElement;

  function SCCManualTab() {
    const [pinned, setPinned] = React.useState(false);
    const [hovered, setHovered] = React.useState(false);
    const show = pinned || hovered;

    const mono = (txt) =>
      h("code", {
        style: {
          fontFamily: "JetBrains Mono,monospace",
          background: "rgba(0,0,0,.3)",
          padding: "2px 7px",
          borderRadius: "2px",
          fontSize: "13px",
          color: "#a8d8a8",
        },
      }, txt);

    const tag = (color, txt) =>
      h("span", {
        style: {
          display: "inline-block",
          padding: "3px 10px",
          fontSize: "12px",
          fontFamily: "Cinzel,serif",
          letterSpacing: ".06em",
          borderRadius: "2px",
          border: "1px solid " + color + "44",
          color: color,
          background: color + "11",
          marginRight: "6px",
          verticalAlign: "middle",
        },
      }, txt);

    const secHead = (icon, title) =>
      h("div", {
        style: {
          background: "rgba(201,168,76,.07)",
          borderBottom: "1px solid rgba(201,168,76,.15)",
          padding: "14px 20px",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          fontFamily: "Cinzel,serif",
          fontSize: "13px",
          letterSpacing: ".1em",
          color: "var(--gold-solid)",
        },
      }, icon + "  " + title);

    const step = (n, label, body) =>
      h("div", {
        key: n,
        style: { display: "flex", gap: "14px", marginBottom: "18px", alignItems: "flex-start" },
      },
        h("div", {
          style: {
            minWidth: "28px", height: "28px", borderRadius: "2px",
            background: "rgba(201,168,76,.12)", border: "1px solid rgba(201,168,76,.3)",
            color: "var(--gold-solid)", fontFamily: "Cinzel,serif", fontSize: "12px",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          },
        }, String(n)),
        h("div", { style: { flex: 1, fontSize: "14px", color: "var(--body-faint)", lineHeight: "1.7" } },
          h("div", { style: { color: "var(--alabaster)", fontWeight: "600", marginBottom: "5px", fontSize: "14px" } }, label),
          body,
        ),
      );

    const divider = h("div", { style: { borderTop: "1px solid rgba(201,168,76,.1)", margin: "18px 0" } });

    const panel = h("div", {
      style: {
        position: "absolute",
        top: "calc(100% + 10px)",
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(860px, 90vw)",
        maxHeight: "80vh",
        overflowY: "auto",
        background: "#1a181b",
        border: "1px solid rgba(201,168,76,.25)",
        borderRadius: "6px",
        zIndex: 9999,
        boxShadow: "0 8px 48px rgba(0,0,0,.85)",
      },
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
    },

      // ── SECTION 1: ONE-TIME SETUP ──
      secHead("⚡", "ONE-TIME SETUP — START THE AUTONOMOUS FLOW"),
      h("div", { style: { padding: "18px 20px" } },
        h("div", {
          style: {
            background: "rgba(76,175,80,.06)", border: "1px solid rgba(76,175,80,.2)",
            borderLeft: "3px solid #4caf50", borderRadius: "2px", padding: "12px 16px",
            fontSize: "14px", color: "var(--alabaster)", lineHeight: "1.65", marginBottom: "20px",
          },
        }, "Once these three things are in place the system runs on its own every day."),

        step(1, "Add G-Fast Distribution to the Distributor DB",
          "Source tab → Distributor DB → Add New. Name must contain 'G-Fast' exactly. Add Steve's email. This is the vendor that receives AN/MS mil-spec part RFQs automatically."),

        step(2, "Set Netlify environment variables (Google Workspace)",
          h("span", null,
            "Netlify → Site → Environment Variables. Add: ",
            mono("GOOGLE_CLIENT_ID"), ", ", mono("GOOGLE_CLIENT_SECRET"), ", ",
            mono("GOOGLE_REFRESH_TOKEN"), " from OAuth consent for anthony@ifedlog.com. Remove any old Zoho vars.",
          )),

        step(3, "Confirm the scheduled function is live",
          h("span", null,
            "Netlify → Functions → look for ", mono("gmail-ingest"),
            ". Cron schedule: ", mono("0 14 * * *"), " (9 AM CT daily). Redeploy if missing.",
          )),

        divider,

        h("div", { style: { fontSize: "12px", color: "var(--gold-solid)", fontFamily: "Cinzel,serif", letterSpacing: ".06em", marginBottom: "12px" } }, "WHAT FIRES AUTOMATICALLY"),
        h("div", { style: { background: "rgba(167,139,250,.06)", border: "1px solid rgba(167,139,250,.2)", borderLeft: "3px solid #a78bfa", borderRadius: "2px", padding: "12px 16px", fontSize: "14px", color: "var(--alabaster)", lineHeight: "1.65", marginBottom: "10px" } },
          tag("#a78bfa", "9 AM CT · DAILY"),
          " Server reads inbox for ", mono("solmlbsm@dla.mil"), " emails. Parses sols → fetches DIBBS → Claude screens → GO sols get RFQs fired to vendors → saved to pipeline → summary sent to you. ",
          h("strong", null, "No browser required."),
        ),
        h("div", { style: { background: "rgba(96,165,250,.06)", border: "1px solid rgba(96,165,250,.2)", borderLeft: "3px solid #60a5fa", borderRadius: "2px", padding: "12px 16px", fontSize: "14px", color: "var(--alabaster)", lineHeight: "1.65" } },
          tag("#60a5fa", "2 AM · BROWSER OPEN"),
          " DIBBS tab cron scrapes Navigator for new sols. Same analysis + auto-RFQ path. Can also trigger manually from the DIBBS tab.",
        ),
      ),

      // ── SECTION 2: MANUAL ACTIONS ──
      secHead("✋", "MANUAL ACTIONS — YOUR PART IN THE FLOW"),
      h("div", { style: { padding: "18px 20px" } },
        step(1, "Check your batch summary email each morning", "The gmail-ingest run sends you a summary: GO (RFQ sent), VERIFY FIRST (held), REJECTED (no source)."),
        step(2, "Handle VERIFY FIRST sols",
          "Pipeline → find the sol (status: Researching) → read Claude's notes → decide go or no-go. If go: Source tab → Confirm Quote → pick vendor → send RFQ manually."),
        step(3, "Quote arrives from vendor", "Vendor replies to auto-sent RFQ. Sol sits at 'Awaiting Quotes.'"),
        step(4, "Log the quote in Pipeline",
          h("span", null,
            h("strong", null, "PDF Quote:"), " Row → drawer → Quote Ingest → upload PDF. Claude extracts price + lead time.", h("br"),
            h("strong", null, "Manual:"), " Row → drawer → fill in Bid $/ea, supplier, email, lead time. Margin column updates live.",
          )),
        step(5, "Submit your bid on DIBBS.mil", "Log into DIBBS → find sol by number → enter price → submit. Outside SCC."),
        step(6, "Mark Bid Submitted in Pipeline", "Change status dropdown to 'Bid Submitted.'"),
        step(7, "Record the outcome",
          h("span", null,
            tag("#4caf50", "AWARDED"), " Click ★ Award — auto-logs to Win Ledger. Next time that NSN surfaces, vendor gets priority.", h("br"),
            tag("#ef5350", "LOST"), " Change status to Lost. Intel stays in history.",
          )),
      ),

      // ── SECTION 3: VENDOR ROUTING ──
      secHead("◆", "VENDOR ROUTING LOGIC (AUTO)"),
      h("div", { style: { padding: "18px 20px", fontSize: "14px", color: "var(--body-faint)", lineHeight: "2.1" } },
        tag("#a78bfa", "1"), " Prior Win on NSN/P/N → routes back to that vendor", h("br"),
        tag("#60a5fa", "2"), " AN- or MS- prefix → G-Fast Distribution (Steve) first", h("br"),
        tag("#ffd700", "3"), " JCP manufacturers → best margins", h("br"),
        tag("#ffd700", "4"), " Other manufacturers (no JCP)", h("br"),
        tag("#94a3b8", "5"), " FSC-matched distributors", h("br"),
        tag("#94a3b8", "6"), " Preferred / starred distributors",
      ),

      // ── SECTION 4: STATUS REFERENCE ──
      secHead("⬡", "STATUS MEANINGS"),
      h("div", { style: { padding: "18px 20px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" } },
        ...[
          ["New",             "#94a3b8", "Sol just landed. Auto-RFQ may still be running."],
          ["Researching",     "#a78bfa", "VERIFY FIRST — flagged by Claude. Awaiting your review."],
          ["Sourcing",        "#60a5fa", "No vendor matched. Manual lookup needed."],
          ["Awaiting Quotes", "#ffc107", "RFQ sent. Waiting on vendor responses."],
          ["Bid Submitted",   "#ffd700", "Price submitted on DIBBS. Waiting on DLA."],
          ["Awarded",         "#4caf50", "Won. Win Ledger auto-updated."],
          ["Lost",            "#ef5350", "Lost. Intel preserved."],
          ["No Source",       "#6b7280", "Pre-screened out or no viable vendor."],
          ["On Hold",         "#d97706", "Paused manually."],
        ].map(([status, color, desc]) =>
          h("div", {
            key: status,
            style: { background: "rgba(0,0,0,.2)", border: "1px solid rgba(201,168,76,.08)", borderRadius: "3px", padding: "12px 14px" },
          },
            h("div", { style: { color, fontFamily: "Cinzel,serif", fontSize: "12px", letterSpacing: ".06em", marginBottom: "5px" } }, status),
            h("div", { style: { fontSize: "13px", color: "var(--body-faint)", lineHeight: "1.55" } }, desc),
          ),
        ),
      ),
    );

    return h("div", {
      style: {
        padding: "32px 20px",
        display: "flex",
        justifyContent: "center",
      },
    },
      h("div", { style: { position: "relative", display: "inline-block" } },
        h("button", {
          style: {
            padding: "13px 28px",
            fontFamily: "Cinzel,serif",
            fontSize: "14px",
            letterSpacing: ".14em",
            background: pinned ? "rgba(201,168,76,.15)" : "transparent",
            border: pinned ? "1px solid rgba(201,168,76,.5)" : "1px solid rgba(201,168,76,.25)",
            color: pinned ? "var(--gold-solid)" : "var(--gold-dim)",
            borderRadius: "3px",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "10px",
            transition: "all .15s",
          },
          onMouseEnter: () => setHovered(true),
          onMouseLeave: () => setHovered(false),
          onClick: () => setPinned((p) => !p),
        },
          h("span", {
            style: {
              border: "1px solid rgba(201,168,76,.4)",
              borderRadius: "50%",
              width: "20px",
              height: "20px",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "12px",
              color: "var(--gold-solid)",
            },
          }, "?"),
          "SCC OPERATIONS MANUAL",
        ),
        show && panel,
      ),
    );
  }

  window.SCCManualTab = SCCManualTab;
})();
