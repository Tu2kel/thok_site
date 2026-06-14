(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — OPERATIONS MANUAL
  //  Two sections: Starting the Autonomous Flow + Manual Steps Required
  //  Exports: window.SCCManualTab (React component)
  // ═══════════════════════════════════════════════════════════════════════

  const h = React.createElement;

  // ── STYLE HELPERS ────────────────────────────────────────────────────
  const S = {
    page: {
      maxWidth: "820px",
      margin: "0 auto",
      padding: "28px 20px 60px",
      fontFamily: "JetBrains Mono, monospace",
      animation: "fadeUp .4s ease both",
    },
    pageTitle: {
      fontFamily: "Cinzel, serif",
      fontSize: "22px",
      letterSpacing: ".12em",
      color: "var(--gold-solid)",
      marginBottom: "4px",
    },
    pageSubtitle: {
      fontFamily: "Cormorant Garamond, serif",
      fontStyle: "italic",
      fontSize: "14px",
      color: "var(--gold-dim)",
      marginBottom: "32px",
    },
    section: {
      marginBottom: "36px",
      border: "1px solid rgba(201,168,76,.15)",
      borderRadius: "4px",
      overflow: "hidden",
    },
    sectionHead: {
      background: "rgba(201,168,76,.07)",
      borderBottom: "1px solid rgba(201,168,76,.15)",
      padding: "14px 20px",
      display: "flex",
      alignItems: "center",
      gap: "10px",
    },
    sectionIcon: {
      fontSize: "18px",
    },
    sectionTitle: {
      fontFamily: "Cinzel, serif",
      fontSize: "13px",
      letterSpacing: ".1em",
      color: "var(--gold-solid)",
    },
    sectionBody: {
      padding: "20px",
    },
    step: {
      display: "flex",
      gap: "14px",
      marginBottom: "18px",
      alignItems: "flex-start",
    },
    stepNum: {
      minWidth: "24px",
      height: "24px",
      borderRadius: "2px",
      background: "rgba(201,168,76,.15)",
      border: "1px solid rgba(201,168,76,.3)",
      color: "var(--gold-solid)",
      fontFamily: "Cinzel, serif",
      fontSize: "11px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
      marginTop: "1px",
    },
    stepContent: {
      flex: 1,
    },
    stepLabel: {
      fontSize: "12px",
      color: "var(--alabaster)",
      marginBottom: "3px",
      fontWeight: "600",
    },
    stepNote: {
      fontSize: "11px",
      color: "var(--body-faint)",
      lineHeight: "1.6",
    },
    tag: (color) => ({
      display: "inline-block",
      padding: "2px 7px",
      fontSize: "10px",
      fontFamily: "Cinzel, serif",
      letterSpacing: ".06em",
      borderRadius: "2px",
      border: "1px solid " + color + "44",
      color: color,
      background: color + "11",
      marginRight: "6px",
      verticalAlign: "middle",
    }),
    divider: {
      borderTop: "1px solid rgba(201,168,76,.1)",
      margin: "18px 0",
    },
    callout: (color) => ({
      background: color + "0d",
      border: "1px solid " + color + "33",
      borderLeft: "3px solid " + color,
      borderRadius: "2px",
      padding: "12px 14px",
      marginTop: "10px",
      fontSize: "11px",
      color: "var(--alabaster)",
      lineHeight: "1.65",
    }),
    mono: {
      fontFamily: "JetBrains Mono, monospace",
      background: "rgba(0,0,0,.3)",
      padding: "1px 5px",
      borderRadius: "2px",
      fontSize: "11px",
      color: "#a8d8a8",
    },
  };

  function Tag({ color, children }) {
    return h("span", { style: S.tag(color) }, children);
  }

  function Step({ n, label, note, children }) {
    return h(
      "div",
      { style: S.step },
      h("div", { style: S.stepNum }, n),
      h(
        "div",
        { style: S.stepContent },
        h("div", { style: S.stepLabel }, label),
        note && h("div", { style: S.stepNote }, note),
        children,
      ),
    );
  }

  function Section({ icon, title, children }) {
    return h(
      "div",
      { style: S.section },
      h(
        "div",
        { style: S.sectionHead },
        h("span", { style: S.sectionIcon }, icon),
        h("span", { style: S.sectionTitle }, title),
      ),
      h("div", { style: S.sectionBody }, children),
    );
  }

  function Mono({ children }) {
    return h("code", { style: S.mono }, children);
  }

  function SCCManualTab() {
    return h(
      "div",
      { style: S.page },

      // ── Page Header ──
      h("div", { style: S.pageTitle }, "SCC Operations Manual"),
      h(
        "div",
        { style: S.pageSubtitle },
        "How the autonomous flow starts · what you handle manually",
      ),

      // ══════════════════════════════════════════════════════════════════
      // SECTION 1 — STARTING THE AUTO
      // ══════════════════════════════════════════════════════════════════
      h(
        Section,
        { icon: "⚡", title: "ONE-TIME SETUP — START THE AUTONOMOUS FLOW" },

        h(
          "div",
          { style: { ...S.callout("#4caf50"), marginBottom: "20px", marginTop: "0" } },
          "Once these three things are in place the system runs on its own every day. You don't touch anything.",
        ),

        h(Step, {
          n: "1",
          label: "Add G-Fast Distribution to the Distributor DB",
          note: "Source tab → Distributor DB → Add New. Name must contain 'G-Fast' exactly. Add Steve's email. This is the vendor that receives AN/MS mil-spec part RFQs automatically.",
        }),

        h(Step, {
          n: "2",
          label: "Set Netlify environment variables (Google Workspace)",
          note: null,
        },
          h(
            "div",
            { style: S.stepNote },
            "Go to Netlify → Site → Environment Variables. Add these three:",
            h("br"),
            h("br"),
            h(Mono, null, "GOOGLE_CLIENT_ID"), " · from Google Cloud Console → OAuth 2.0 client",
            h("br"),
            h(Mono, null, "GOOGLE_CLIENT_SECRET"), " · same client",
            h("br"),
            h(Mono, null, "GOOGLE_REFRESH_TOKEN"), " · generated from the OAuth consent flow for anthony@ifedlog.com",
            h("br"),
            h("br"),
            "Remove any old Zoho variables (ZOHO_CLIENT_ID, etc.) if they're still there.",
          ),
        ),

        h(Step, {
          n: "3",
          label: "Confirm the scheduled function is live",
          note: null,
        },
          h(
            "div",
            { style: S.stepNote },
            "In Netlify → Functions, look for ",
            h(Mono, null, "gmail-ingest"),
            ". It should show a cron schedule of ",
            h(Mono, null, "0 14 * * *"),
            " (9 AM CT daily). If it's not there, a redeploy will register it.",
          ),
        ),

        h("div", { style: S.divider }),

        h(
          "div",
          { style: { fontSize: "12px", color: "var(--gold-solid)", fontFamily: "Cinzel,serif", letterSpacing: ".06em", marginBottom: "14px" } },
          "WHAT FIRES AUTOMATICALLY AFTER SETUP",
        ),

        h(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: "10px" } },

          h(
            "div",
            { style: S.callout("#a78bfa") },
            h(Tag, { color: "#a78bfa" }, "9 AM CT · DAILY"),
            " Server reads anthony@ifedlog.com inbox for emails from ",
            h(Mono, null, "solmlbsm@dla.mil"),
            ". Parses sol numbers → fetches from DIBBS → Claude screens → GO sols get RFQ emails fired to matching vendors → sols saved to your pipeline → batch summary sent to you. ",
            h("strong", null, "No browser required."),
          ),

          h(
            "div",
            { style: S.callout("#60a5fa") },
            h(Tag, { color: "#60a5fa" }, "2 AM · BROWSER MUST BE OPEN"),
            " DIBBS tab cron scrapes Navigator for new solicitations. Same analysis + auto-RFQ path fires. You can also trigger it manually from the DIBBS tab at any time.",
          ),
        ),
      ),

      // ══════════════════════════════════════════════════════════════════
      // SECTION 2 — WHAT YOU DO MANUALLY
      // ══════════════════════════════════════════════════════════════════
      h(
        Section,
        { icon: "✋", title: "MANUAL ACTIONS — YOUR PART IN THE FLOW" },

        h(
          "div",
          { style: { ...S.callout("#ffc107"), marginBottom: "20px", marginTop: "0" } },
          "The system handles: ingestion, screening, vendor selection, RFQ emails. You handle: evaluating quotes, submitting bids, and recording the outcome.",
        ),

        h(Step, {
          n: "1",
          label: "Check your batch summary email each morning",
          note: "The gmail-ingest run sends you a summary of everything that fired: GO (RFQ sent), VERIFY FIRST (held for review), REJECTED (no source). This is your daily briefing.",
        }),

        h(Step, {
          n: "2",
          label: "Handle VERIFY FIRST sols — Pipeline → Researching status",
          note: null,
        },
          h(
            "div",
            { style: S.stepNote },
            "These are sols Claude flagged for review before sending an RFQ. Reasons can include: delivery window too tight, approved-source-only restriction, margin concern, or ambiguous specs. ",
            h("br"), h("br"),
            "Open Pipeline → find the sol (status: Researching) → read Claude's notes in the row → decide go or no-go. ",
            h("br"),
            "If you go: Source tab → ",
            h("strong", null, "Confirm Quote"),
            " → find the sol → pick a vendor → send RFQ manually.",
          ),
        ),

        h(Step, {
          n: "3",
          label: "Quote arrives in your email from a vendor",
          note: "Vendors reply to the auto-sent RFQ. The sol in Pipeline is sitting at "Awaiting Quotes."",
        }),

        h(Step, {
          n: "4",
          label: "Log the quote in Pipeline",
          note: null,
        },
          h(
            "div",
            { style: S.stepNote },
            h("strong", null, "Option A — PDF Quote:"),
            " Click the row → open drawer → Quote Ingest → upload the vendor's PDF. Claude extracts vendor name, unit price, and lead time automatically.",
            h("br"), h("br"),
            h("strong", null, "Option B — Manual entry:"),
            " Click the row → open drawer → fill in Bid $/ea, supplier name, supplier email, lead time.",
            h("br"), h("br"),
            "The margin column will update in real time. ",
            h("span", { style: { color: "#4caf50" } }, "Green = good. "),
            h("span", { style: { color: "#ffc107" } }, "Amber = marginal. "),
            h("span", { style: { color: "#ef5350" } }, "Red = losing."),
          ),
        ),

        h(Step, {
          n: "5",
          label: "Submit your bid on DIBBS.mil",
          note: "Log into DIBBS → find the solicitation by sol number → enter your price → submit. This is done outside SCC — the website doesn't automate DLA's submission portal.",
        }),

        h(Step, {
          n: "6",
          label: "Mark Bid Submitted in Pipeline",
          note: "Change the status dropdown to "Bid Submitted." Note your submitted price in the row if different from what the vendor quoted.",
        }),

        h(Step, {
          n: "7",
          label: "Record the outcome when DLA decides",
          note: null,
        },
          h(
            "div",
            { style: S.stepNote },
            h(Tag, { color: "#4caf50" }, "AWARDED"),
            " Click ★ Award button on the pipeline row. This automatically logs the vendor, price, NSN, and part number to the Win Ledger — next time that NSN surfaces, the system routes the RFQ to this vendor first.",
            h("br"), h("br"),
            h(Tag, { color: "#ef5350" }, "LOST"),
            " Change status to Lost. The intel stays in your pipeline history.",
          ),
        ),
      ),

      // ══════════════════════════════════════════════════════════════════
      // SECTION 3 — VENDOR ROUTING LOGIC
      // ══════════════════════════════════════════════════════════════════
      h(
        Section,
        { icon: "◆", title: "HOW VENDOR ROUTING WORKS (AUTO)" },

        h(
          "div",
          { style: { fontSize: "11px", color: "var(--body-faint)", lineHeight: "1.8" } },
          "Every time a GO sol is processed, the system picks vendors in this order:",
          h("br"), h("br"),
          h(Tag, { color: "#a78bfa" }, "1"), " Prior Win on this NSN/P/N → routes directly back to the vendor who won it before",
          h("br"),
          h(Tag, { color: "#60a5fa" }, "2"), " AN- or MS- prefix part numbers → G-Fast Distribution (Steve) first",
          h("br"),
          h(Tag, { color: "#ffd700" }, "3"), " Manufacturers with JCP (Joint Certification Program) → best margins",
          h("br"),
          h(Tag, { color: "#ffd700" }, "4"), " Other manufacturers (no JCP)",
          h("br"),
          h(Tag, { color: "#94a3b8" }, "5"), " FSC-matched distributors",
          h("br"),
          h(Tag, { color: "#94a3b8" }, "6"), " Preferred / starred distributors",
          h("br"), h("br"),
          "The Win Ledger populates automatically each time you click ★ Award. Over time the routing gets smarter as your award history builds up.",
        ),
      ),

      // ══════════════════════════════════════════════════════════════════
      // SECTION 4 — QUICK REFERENCE
      // ══════════════════════════════════════════════════════════════════
      h(
        Section,
        { icon: "⬡", title: "QUICK REFERENCE — STATUS MEANINGS" },

        h(
          "div",
          {
            style: {
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "10px",
              fontSize: "11px",
            },
          },
          ...[
            ["New",            "#94a3b8", "Sol just landed in pipeline. Auto-RFQ may still be running."],
            ["Researching",    "#a78bfa", "VERIFY FIRST — Claude flagged it. Awaiting your review before RFQ goes out."],
            ["Sourcing",       "#60a5fa", "No vendor matched automatically. Manual vendor lookup needed."],
            ["Awaiting Quotes","#ffc107", "RFQ emails sent. Waiting for vendor responses."],
            ["Bid Submitted",  "#ffd700", "You submitted your price on DIBBS. Waiting on DLA award decision."],
            ["Awarded",        "#4caf50", "Won. Win Ledger auto-updated."],
            ["Lost",           "#ef5350", "Lost the award. Intel preserved."],
            ["No Source",      "#6b7280", "Pre-screened out or no viable vendor. Closed."],
            ["On Hold",        "#d97706", "Paused manually — awaiting more info or a decision."],
          ].map(([status, color, desc]) =>
            h(
              "div",
              {
                key: status,
                style: {
                  background: "rgba(0,0,0,.2)",
                  border: "1px solid rgba(201,168,76,.08)",
                  borderRadius: "3px",
                  padding: "10px 12px",
                },
              },
              h("div", { style: { color, fontFamily: "Cinzel,serif", fontSize: "10px", letterSpacing: ".06em", marginBottom: "4px" } }, status),
              h("div", { style: { color: "var(--body-faint)", lineHeight: "1.55" } }, desc),
            ),
          ),
        ),
      ),
    );
  }

  window.SCCManualTab = SCCManualTab;
})();
