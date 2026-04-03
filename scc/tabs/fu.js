(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — FU ENGINE TAB
  //  Follow-Up Automation · Prospecting Blast System
  //  Pre-compiled React · No Babel · No JSX
  //  Exposes: window.SCC_TABS.FUTab
  //  Load order: after memo.js, before app.js
  // ═══════════════════════════════════════════════════════════════════════

  const { createElement: h, useState, useEffect, useRef, useCallback } = React;

  const usePState = (init) => React.useState(init);

  // ── STORAGE KEY ────────────────────────────────────────────────────────
  const STORE = "scc_fu_contacts_v1";
  const STORE_SRC = "scc_fu_src_v1";

  // ── TEMPLATES ──────────────────────────────────────────────────────────
  const TEMPLATES = {
    followup: {
      subject: "Following Up — Imperio Talent Solutions",
      body: `Hi {name},

I'm circling back on my earlier outreach to {company}. Wanted to make sure this didn't get buried — happy to connect when timing works.

As a Service-Disabled Veteran-Owned Small Business (SDVOSB), we specialize in federal supply chain fulfillment and staffing across multiple verticals.

Would you have a few minutes to connect this week?

Respectfully,
Anthony Kelley Sr.
Founder & CEO | Imperio Talent Solutions
(254) 265-9335
anthony@imperiovita.co`,
    },
    intro: {
      subject:
        "Capability Introduction — Imperio Talent Solutions | SDVOSB Federal Contractor",
      body: `Hi {name},

My name is Anthony Kelley Sr., Founder and CEO of Imperio Talent Solutions, a Service-Disabled Veteran-Owned Small Business (SDVOSB) based in Killeen, TX near Fort Cavazos. CAGE Code: 152U4.

We specialize in federal supply chain fulfillment and staffing with capabilities across a broad range of FSC categories through DLA/DIBBS. I am reaching out to {company} to introduce our organization and explore mutual opportunities for teaming, vendor partnerships, or subcontracting.

I would welcome a brief call at your convenience to discuss how we might support your requirements.

Respectfully,
Anthony Kelley Sr.
Founder & CEO | Imperio Talent Solutions
(254) 265-9335 | (254) 226-5216
anthony@imperiovita.co`,
    },
    sol: {
      subject: "Solicitation Inquiry — {sol} | Imperio Talent Solutions",
      body: `Hi {name},

I am reaching out regarding solicitation {sol} currently posted on DIBBS/SAM.gov for {item}, NSN {nsn}.

Imperio Talent Solutions (CAGE 152U4) is an SDVOSB federal supply contractor evaluating this requirement. I would like to inquire about {company}'s current availability, lead time, and best pricing for this item.

Required Quantity: {qty}
Quote Due: {due}
Delivery Required: {delivery} ARO

Please reply to this email or call (254) 265-9335 with your pricing.

Respectfully,
Anthony Kelley Sr.
Founder & CEO | Imperio Talent Solutions
anthony@imperiovita.co`,
    },
    vendor: {
      subject:
        "Vendor Partnership Opportunity — Imperio Talent Solutions SDVOSB",
      body: `Hi {name},

My name is Anthony Kelley Sr., CEO of Imperio Talent Solutions, an SDVOSB federal supply contractor (CAGE 152U4) based in Killeen, TX.

We are actively building our vendor and distributor network to support DLA/DIBBS solicitations across multiple FSC categories. I would like to explore whether a teaming or preferred vendor arrangement would benefit {company}.

Our set-aside status creates competitive advantages that benefit our supply chain partners. I would be glad to discuss specifics at your convenience.

Respectfully,
Anthony Kelley Sr.
Founder & CEO | Imperio Talent Solutions
(254) 265-9335 | (254) 226-5216
anthony@imperiovita.co`,
    },
    capability: {
      subject:
        "Imperio Talent Solutions — Capability Statement | SDVOSB CAGE 152U4",
      body: `Hi {name},

I wanted to share a brief overview of Imperio Talent Solutions for {company}'s consideration.

COMPANY OVERVIEW
Imperio Talent Solutions is a Service-Disabled Veteran-Owned Small Business (SDVOSB) headquartered in Killeen, TX near Fort Cavazos. CAGE: 152U4.

CORE CAPABILITIES
- Federal supply chain fulfillment (DLA/DIBBS)
- Federal staffing and talent acquisition
- IT / Cybersecurity (cleared professionals)
- Medical / Healthcare staffing
- Logistics & Supply Chain

SET-ASIDE STATUS
SDVOSB — eligible for sole-source awards and set-aside competitions under FAR 19.14.

We welcome the opportunity to support {company}'s mission and explore how Imperio can add value to your team.

Respectfully,
Anthony Kelley Sr.
Founder & CEO | Imperio Talent Solutions
(254) 265-9335
anthony@imperiovita.co`,
    },
  };

  // ── MERGE ──────────────────────────────────────────────────────────────
  // Replaces {name}, {company}, and any sol-specific tags
  function mergeText(text, contact, solMeta) {
    let out = text
      .replace(/\{name\}/gi, contact.firstName || contact.contact || "{name}")
      .replace(/\{company\}/gi, contact.company || "{company}");
    if (solMeta) {
      out = out
        .replace(/\{sol\}/gi, solMeta.sol || "[SOL NUMBER]")
        .replace(/\{nsn\}/gi, solMeta.nsn || "[NSN]")
        .replace(/\{item\}/gi, solMeta.item || "[ITEM]")
        .replace(/\{qty\}/gi, solMeta.qty || "[QTY]")
        .replace(/\{due\}/gi, solMeta.due || "[DATE]")
        .replace(/\{delivery\}/gi, solMeta.delivery || "[DELIVERY DAYS]");
    }
    return out;
  }

  // ── CONTACT STORAGE ────────────────────────────────────────────────────
  function loadContacts() {
    try {
      const s = localStorage.getItem(STORE);
      return s ? JSON.parse(s) : [];
    } catch (e) {
      return [];
    }
  }
  function saveContacts(list) {
    try {
      localStorage.setItem(STORE, JSON.stringify(list));
    } catch (e) {}
  }

  // ── SMALL COMPONENTS ───────────────────────────────────────────────────

  // Thin gold-shimmer button
  function GBtn({ children, onClick, style, title, variant = "ghost", sm }) {
    const base = {
      fontFamily: "Cinzel,serif",
      fontSize: sm ? "8px" : "9px",
      letterSpacing: ".18em",
      textTransform: "uppercase",
      border: "none",
      cursor: "pointer",
      position: "relative",
      overflow: "hidden",
      padding: sm ? "5px 12px" : "9px 20px",
      transition: "opacity .2s, transform .15s",
    };
    const variants = {
      gold: {
        background:
          "linear-gradient(to bottom,#cf972d 22%,#f9f295 45%,#e0aa3e 50%,#b8860b 55%,#f9f295 78%)",
        color: "#0e0d10",
        fontWeight: "700",
      },
      ghost: {
        background: "transparent",
        border: "1px solid rgba(201,168,76,.22)",
        color: "var(--alabaster,#F5F0E8)",
      },
      red: {
        background:
          "linear-gradient(135deg,#3d0010 0%,#8b0000 60%,#3d0010 100%)",
        color: "#F5F0E8",
      },
      dark: {
        background: "linear-gradient(135deg,#1a1820 0%,#2e2b32 100%)",
        border: "1px solid rgba(201,168,76,.2)",
        color: "var(--gold-solid,#C9A84C)",
      },
    };
    return h(
      "button",
      {
        onClick,
        title,
        style: { ...base, ...(variants[variant] || variants.ghost), ...style },
        onMouseEnter: (e) => {
          e.currentTarget.style.opacity = ".88";
          e.currentTarget.style.transform = "translateY(-1px)";
        },
        onMouseLeave: (e) => {
          e.currentTarget.style.opacity = "1";
          e.currentTarget.style.transform = "translateY(0)";
        },
      },
      h("span", {
        style: {
          position: "absolute",
          top: 0,
          left: "-100%",
          width: "60%",
          height: "100%",
          background:
            "linear-gradient(90deg,transparent,rgba(255,255,255,.18),transparent)",
          transform: "skewX(-20deg)",
          transition: "left .4s",
          pointerEvents: "none",
        },
        ref: (el) => {
          if (el)
            el.closest("button") &&
              el.closest("button").addEventListener(
                "mouseenter",
                () => {
                  el.style.left = "150%";
                },
                { once: false },
              );
        },
      }),
      children,
    );
  }

  // Status bar
  function StatusBar({ msg, type }) {
    if (!msg) return null;
    const colors = {
      processing: {
        bg: "rgba(201,168,76,.1)",
        border: "rgba(201,168,76,.3)",
        color: "var(--gold-solid,#C9A84C)",
      },
      success: {
        bg: "rgba(61,214,140,.08)",
        border: "rgba(61,214,140,.3)",
        color: "#3dd68c",
      },
      error: {
        bg: "rgba(231,76,60,.08)",
        border: "rgba(231,76,60,.3)",
        color: "#e74c3c",
      },
    };
    const c = colors[type] || colors.processing;
    return h(
      "div",
      {
        style: {
          background: c.bg,
          border: "1px solid " + c.border,
          color: c.color,
          fontFamily: "Cinzel,serif",
          fontSize: "9px",
          letterSpacing: ".15em",
          textTransform: "uppercase",
          padding: "9px 14px",
          marginBottom: "14px",
        },
      },
      msg,
    );
  }

  // Progress bar
  function ProgressBar({ pct }) {
    if (!pct) return null;
    return h(
      "div",
      {
        style: {
          height: "3px",
          background: "rgba(0,0,0,.3)",
          marginBottom: "14px",
        },
      },
      h("div", {
        style: {
          height: "100%",
          width: pct + "%",
          background:
            "linear-gradient(to bottom,#cf972d 22%,#f9f295 45%,#e0aa3e 50%,#b8860b 55%,#f9f295 78%)",
          transition: "width .3s",
        },
      }),
    );
  }

  // Panel wrapper
  function Panel({ children, style }) {
    return h(
      "div",
      {
        style: {
          background:
            "linear-gradient(160deg,#2e2b32 0%,#252328 18%,#1c1a1f 40%,#201e24 60%,#252328 80%,#1c1a1f 100%)",
          border: "1px solid rgba(201,168,76,.3)",
          position: "relative",
          overflow: "hidden",
          marginBottom: "18px",
          ...style,
        },
      },
      h("div", {
        style: {
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "1px",
          background:
            "linear-gradient(90deg,transparent,rgba(201,168,76,.5) 30%,rgba(249,242,149,.8) 50%,rgba(201,168,76,.5) 70%,transparent)",
          pointerEvents: "none",
        },
      }),
      children,
    );
  }

  function PanelHdr({ title, right }) {
    return h(
      "div",
      {
        style: {
          padding: "12px 18px 11px",
          borderBottom: "1px solid rgba(201,168,76,.15)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        },
      },
      h(
        "span",
        {
          style: {
            fontFamily: "Cinzel,serif",
            fontSize: "9px",
            letterSpacing: ".28em",
            textTransform: "uppercase",
            background:
              "linear-gradient(to bottom,#cf972d 22%,#f9f295 45%,#e0aa3e 50%,#b8860b 55%,#f9f295 78%)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            fontWeight: "600",
          },
        },
        title,
      ),
      right &&
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "8px" } },
          right,
        ),
    );
  }

  // Field label
  function Lbl({ children }) {
    return h(
      "label",
      {
        style: {
          fontFamily: "Cinzel,serif",
          fontSize: "8px",
          letterSpacing: ".28em",
          textTransform: "uppercase",
          color: "rgba(201,168,76,.45)",
          display: "block",
          marginBottom: "5px",
        },
      },
      children,
    );
  }

  // Textarea / Input base style
  const fieldStyle = {
    width: "100%",
    background: "rgba(201,168,76,.06)",
    border: "1px solid rgba(201,168,76,.32)",
    color: "var(--alabaster,#F5F0E8)",
    fontFamily: "Cormorant Garamond,serif",
    fontSize: "14px",
    padding: "8px 12px",
    outline: "none",
    resize: "none",
  };

  // ── TEMPLATE STRIP ─────────────────────────────────────────────────────
  function TemplateStrip({ onLoad }) {
    const chips = [
      { key: "followup", label: "General Follow-Up" },
      { key: "intro", label: "Capability Intro" },
      { key: "sol", label: "Solicitation Inquiry" },
      { key: "vendor", label: "Vendor Partnership" },
      { key: "capability", label: "Capability Statement" },
    ];
    return h(
      "div",
      {
        style: {
          display: "flex",
          gap: "7px",
          flexWrap: "wrap",
          padding: "10px 16px",
          borderBottom: "1px solid rgba(201,168,76,.12)",
          background: "rgba(0,0,0,.15)",
        },
      },
      chips.map((c) =>
        h(
          "button",
          {
            key: c.key,
            onClick: () => onLoad(c.key),
            style: {
              background: "transparent",
              border: "1px solid rgba(201,168,76,.18)",
              color: "rgba(245,240,232,.45)",
              fontFamily: "Cinzel,serif",
              fontSize: "7.5px",
              letterSpacing: ".14em",
              textTransform: "uppercase",
              padding: "6px 14px",
              cursor: "pointer",
              transition: "all .2s",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            },
            onMouseEnter: (e) => {
              e.currentTarget.style.color = "var(--gold-solid,#C9A84C)";
              e.currentTarget.style.borderColor = "rgba(201,168,76,.5)";
              e.currentTarget.style.background = "rgba(201,168,76,.07)";
            },
            onMouseLeave: (e) => {
              e.currentTarget.style.color = "rgba(245,240,232,.45)";
              e.currentTarget.style.borderColor = "rgba(201,168,76,.18)";
              e.currentTarget.style.background = "transparent";
            },
          },
          h(
            "span",
            { style: { fontSize: "10px", color: "rgba(201,168,76,.5)" } },
            "◈",
          ),
          c.label,
        ),
      ),
    );
  }

  // ── CONTACTS TABLE ─────────────────────────────────────────────────────
  function ContactsTable({
    contacts,
    setContacts,
    subject,
    body,
    solMeta,
    showToast,
  }) {
    if (!contacts.length) return null;

    function updateField(i, field, val) {
      const next = contacts.map((c, idx) => {
        if (idx !== i) return c;
        const updated = { ...c, [field]: val };
        if (field === "contact") updated.firstName = val.split(" ")[0];
        return updated;
      });
      setContacts(next);
      saveContacts(next);
    }

    function removeOne(i) {
      const next = contacts.filter((_, idx) => idx !== i);
      setContacts(next);
      saveContacts(next);
    }

    function draftOne(i) {
      const c = contacts[i];
      const rawSubject = subject;
      const rawBody = body;
      if (!rawSubject.trim() || !rawBody.trim()) {
        _showToast("Add subject and body before drafting", true);
        return;
      }
      const merged_subject = mergeText(rawSubject, c, solMeta);
      const merged_body = mergeText(rawBody, c, solMeta);
      const encS = encodeURIComponent(merged_subject);
      const encB = merged_body
        .split("\n")
        .map(encodeURIComponent)
        .join("%0D%0A");
      window.open(
        "mailto:" + c.email + "?subject=" + encS + "&body=" + encB,
        "_blank",
      );
      _showToast("Mail client opened for " + (c.firstName || c.contact));
    }

    const tdSt = {
      padding: "8px 10px",
      borderBottom: "1px solid rgba(201,168,76,.07)",
      fontSize: "13px",
      verticalAlign: "middle",
    };
    const inpSt = {
      background: "transparent",
      border: "none",
      borderBottom: "1px solid transparent",
      color: "var(--alabaster,#F5F0E8)",
      fontFamily: "Cormorant Garamond,serif",
      fontSize: "13px",
      padding: "2px 4px",
      width: "100%",
      outline: "none",
    };

    return h(
      Panel,
      null,
      h(PanelHdr, {
        title: "Contacts · " + contacts.length,
        right: h(
          React.Fragment,
          null,
          h(
            GBtn,
            {
              variant: "dark",
              sm: true,
              onClick: () => exportTracker(contacts),
            },
            "⬇ Export",
          ),
          h(
            GBtn,
            { variant: "dark", sm: true, onClick: () => saveBackup(contacts) },
            "💾 Backup",
          ),
        ),
      }),
      h(
        "div",
        { style: { overflowX: "auto" } },
        h(
          "table",
          { style: { width: "100%", borderCollapse: "collapse" } },
          h(
            "thead",
            null,
            h(
              "tr",
              { style: { background: "rgba(201,168,76,.04)" } },
              ["Contact Name", "Email", "Company", "Title", "Actions"].map(
                (hd) =>
                  h(
                    "th",
                    {
                      key: hd,
                      style: {
                        fontFamily: "Cinzel,serif",
                        fontSize: "8px",
                        letterSpacing: ".2em",
                        textTransform: "uppercase",
                        color: "var(--gold-solid,#C9A84C)",
                        padding: "9px 10px",
                        textAlign: "left",
                        borderBottom: "1px solid rgba(201,168,76,.18)",
                        whiteSpace: "nowrap",
                      },
                    },
                    hd,
                  ),
              ),
            ),
          ),
          h(
            "tbody",
            null,
            contacts.map((c, i) =>
              h(
                "tr",
                {
                  key: c.email + i,
                  style: { background: "transparent" },
                  onMouseEnter: (e) => {
                    e.currentTarget.style.background = "rgba(201,168,76,.04)";
                  },
                  onMouseLeave: (e) => {
                    e.currentTarget.style.background = "transparent";
                  },
                  onMouseOut: (e) => {
                    e.currentTarget.style.background = "transparent";
                  },
                },
                h(
                  "td",
                  { style: tdSt },
                  h("input", {
                    type: "text",
                    style: inpSt,
                    value: c.contact || "",
                    onChange: (e) => updateField(i, "contact", e.target.value),
                    onFocus: (e) =>
                      (e.target.style.borderBottomColor =
                        "rgba(201,168,76,.4)"),
                    onBlur: (e) =>
                      (e.target.style.borderBottomColor = "transparent"),
                  }),
                ),
                h(
                  "td",
                  {
                    style: {
                      ...tdSt,
                      fontFamily: "JetBrains Mono,monospace",
                      fontSize: "11px",
                      color: "#87ceeb",
                    },
                  },
                  c.email,
                ),
                h(
                  "td",
                  { style: tdSt },
                  h("input", {
                    type: "text",
                    style: inpSt,
                    value: c.company || "",
                    onChange: (e) => updateField(i, "company", e.target.value),
                    onFocus: (e) =>
                      (e.target.style.borderBottomColor =
                        "rgba(201,168,76,.4)"),
                    onBlur: (e) =>
                      (e.target.style.borderBottomColor = "transparent"),
                  }),
                ),
                h(
                  "td",
                  { style: tdSt },
                  h("input", {
                    type: "text",
                    style: inpSt,
                    value: c.title || "",
                    onChange: (e) => updateField(i, "title", e.target.value),
                    onFocus: (e) =>
                      (e.target.style.borderBottomColor =
                        "rgba(201,168,76,.4)"),
                    onBlur: (e) =>
                      (e.target.style.borderBottomColor = "transparent"),
                  }),
                ),
                h(
                  "td",
                  { style: { ...tdSt, whiteSpace: "nowrap" } },
                  h(
                    "div",
                    { style: { display: "flex", gap: "6px" } },
                    h(
                      "button",
                      {
                        onClick: () => draftOne(i),
                        style: {
                          background:
                            "linear-gradient(to bottom,#cf972d 22%,#f9f295 45%,#e0aa3e 50%,#b8860b 55%,#f9f295 78%)",
                          border: "none",
                          color: "#0e0d10",
                          fontFamily: "Cinzel,serif",
                          fontSize: "8px",
                          letterSpacing: ".15em",
                          textTransform: "uppercase",
                          fontWeight: "700",
                          padding: "5px 12px",
                          cursor: "pointer",
                        },
                        onMouseEnter: (e) =>
                          (e.currentTarget.style.opacity = ".85"),
                        onMouseLeave: (e) =>
                          (e.currentTarget.style.opacity = "1"),
                      },
                      "Draft",
                    ),
                    h(
                      "button",
                      {
                        onClick: () => removeOne(i),
                        style: {
                          background: "transparent",
                          border: "1px solid rgba(231,76,60,.3)",
                          color: "rgba(231,76,60,.7)",
                          fontFamily: "Cinzel,serif",
                          fontSize: "11px",
                          padding: "4px 8px",
                          cursor: "pointer",
                          lineHeight: "1",
                        },
                        onMouseEnter: (e) => {
                          e.currentTarget.style.background =
                            "rgba(231,76,60,.1)";
                          e.currentTarget.style.color = "#e74c3c";
                        },
                        onMouseLeave: (e) => {
                          e.currentTarget.style.background = "transparent";
                          e.currentTarget.style.color = "rgba(231,76,60,.7)";
                        },
                      },
                      "✕",
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  // ── MAPPING MODAL ──────────────────────────────────────────────────────
  function MappingModal({ headers, onConfirm, onCancel }) {
    const fields = [
      { key: "contact", label: "Contact Name" },
      { key: "email", label: "Email (required)" },
      { key: "company", label: "Company" },
      { key: "title", label: "Title (optional)" },
      { key: "phone", label: "Phone (optional)" },
      { key: "location", label: "Location (optional)" },
    ];
    const [mapping, setMapping] = useState(() => {
      const m = {};
      fields.forEach((f) => {
        const ai = headers.findIndex((hd) => {
          const l = String(hd).toLowerCase().trim();
          if (f.key === "contact")
            return l.includes("name") || l.includes("contact");
          if (f.key === "email")
            return l.includes("email") || l.includes("e-mail");
          if (f.key === "company")
            return l.includes("company") || l.includes("organization");
          if (f.key === "title")
            return l.includes("title") || l.includes("position");
          if (f.key === "phone")
            return l.includes("phone") || l.includes("mobile");
          if (f.key === "location")
            return (
              l.includes("location") ||
              l.includes("city") ||
              l.includes("state")
            );
          return false;
        });
        if (ai !== -1) m[f.key] = ai;
      });
      return m;
    });

    const selSt = {
      background: "rgba(201,168,76,.06)",
      border: "1px solid rgba(201,168,76,.3)",
      color: "var(--alabaster,#F5F0E8)",
      fontFamily: "Cormorant Garamond,serif",
      fontSize: "13px",
      padding: "6px 10px",
      outline: "none",
      width: "100%",
    };

    return h(
      "div",
      {
        style: {
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,.82)",
          zIndex: 9000,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        },
      },
      h(
        "div",
        {
          style: {
            background:
              "linear-gradient(160deg,#2e2b32 0%,#252328 18%,#1c1a1f 40%,#201e24 60%,#252328 80%,#1c1a1f 100%)",
            border: "1px solid rgba(201,168,76,.55)",
            padding: "28px",
            maxWidth: "520px",
            width: "90%",
            maxHeight: "85vh",
            overflowY: "auto",
            position: "relative",
          },
        },
        h(
          "div",
          {
            style: {
              fontFamily: "Cinzel,serif",
              fontSize: "12px",
              letterSpacing: ".2em",
              textTransform: "uppercase",
              background:
                "linear-gradient(to bottom,#cf972d 22%,#f9f295 45%,#e0aa3e 50%,#b8860b 55%,#f9f295 78%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              marginBottom: "16px",
            },
          },
          "Map Your Columns",
        ),
        h(
          "p",
          {
            style: {
              fontSize: "12px",
              color: "rgba(245,240,232,.42)",
              fontStyle: "italic",
              marginBottom: "14px",
            },
          },
          "Match your spreadsheet columns to FU Engine fields.",
        ),
        fields.map((f) =>
          h(
            "div",
            {
              key: f.key,
              style: {
                display: "grid",
                gridTemplateColumns: "1fr auto 1fr",
                alignItems: "center",
                gap: "10px",
                padding: "8px",
                background: "rgba(201,168,76,.04)",
                marginBottom: "5px",
              },
            },
            h(
              "strong",
              {
                style: {
                  fontFamily: "Cinzel,serif",
                  fontSize: "8px",
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                  color: "var(--gold-solid,#C9A84C)",
                },
              },
              f.label,
            ),
            h(
              "span",
              { style: { color: "rgba(201,168,76,.45)", fontSize: "13px" } },
              "→",
            ),
            h(
              "select",
              {
                style: selSt,
                value: mapping[f.key] !== undefined ? mapping[f.key] : "",
                onChange: (e) =>
                  setMapping((prev) => ({
                    ...prev,
                    [f.key]:
                      e.target.value === ""
                        ? undefined
                        : parseInt(e.target.value),
                  })),
              },
              h("option", { value: "" }, "Skip"),
              headers.map((hd, i) =>
                h(
                  "option",
                  { key: i, value: i, style: { background: "#1a0008" } },
                  String(hd),
                ),
              ),
            ),
          ),
        ),
        h(
          "div",
          {
            style: {
              display: "flex",
              gap: "10px",
              justifyContent: "flex-end",
              marginTop: "18px",
            },
          },
          h(GBtn, { variant: "ghost", sm: true, onClick: onCancel }, "Cancel"),
          h(
            GBtn,
            { variant: "gold", sm: true, onClick: () => onConfirm(mapping) },
            "Confirm Import",
          ),
        ),
      ),
    );
  }

  // ── EXPORT HELPERS ─────────────────────────────────────────────────────
  function exportTracker(contacts) {
    const today = new Date().toISOString().split("T")[0];
    const ws = XLSX.utils.json_to_sheet(
      contacts.map((c) => ({
        Company: c.company || "",
        Contact: c.contact || "",
        Title: c.title || "",
        Phone: c.phone || "",
        Email: c.email || "",
        Status: "Cold Call",
        "Date Contacted": today,
        Location: c.location || "",
        "Follow-Up": "",
        Notes: "",
      })),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Contacts");
    XLSX.writeFile(wb, "Imperio_Outreach_" + today + ".xlsx");
  }

  function saveBackup(contacts) {
    const today = new Date().toISOString().split("T")[0];
    const ws = XLSX.utils.json_to_sheet(
      contacts.map((c) => ({
        "Contact Name": c.contact || "",
        Email: c.email || "",
        Company: c.company || "",
        Title: c.title || "",
        Phone: c.phone || "",
        Location: c.location || "",
      })),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Backup");
    XLSX.writeFile(wb, "FU_Engine_Backup_" + today + ".xlsx");
  }

  // ── OCR HELPERS ────────────────────────────────────────────────────────
  async function preprocessImg(file) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width * 3;
        canvas.height = img.height * 3;
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < d.data.length; i += 4) {
          const g =
            0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2];
          const c = Math.min(255, g * 1.4);
          d.data[i] = d.data[i + 1] = d.data[i + 2] = c;
        }
        ctx.putImageData(d, 0, 0);
        canvas.toBlob(
          (b) => (b ? res(b) : rej(new Error("Blob failed"))),
          "image/png",
        );
      };
      img.onerror = () => rej(new Error("Image load failed"));
      img.src = URL.createObjectURL(file);
    });
  }

  function extractContactsFromOCR(words) {
    let leftX = Infinity;
    words.forEach((w) => {
      if (w.bbox.x0 < leftX) leftX = w.bbox.x0;
    });
    const nameMaxX = leftX + 250;

    let rightX = 0;
    words.forEach((w) => {
      if (w.bbox.x1 > rightX) rightX = w.bbox.x1;
    });

    const emailRx = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emailsPos = [];
    words.forEach((w) => {
      const m = w.text.match(emailRx);
      if (m) emailsPos.push({ email: m[0], y: w.bbox.y0, x: w.bbox.x0 });
    });

    const companyHdrs = words.filter(
      (w) =>
        w.text.toLowerCase() === "company" ||
        w.text.toLowerCase() === "companies",
    );

    return emailsPos.map((ed) => {
      const tol = 25;
      const nameWords = words
        .filter(
          (w) =>
            w.bbox.x0 >= leftX &&
            w.bbox.x0 < nameMaxX &&
            Math.abs(w.bbox.y0 - ed.y) < tol &&
            w.text.length > 1 &&
            w.text.length < 25 &&
            !w.text.includes("@") &&
            /^[A-Za-z]+$/.test(w.text),
        )
        .sort((a, b) => a.bbox.x0 - b.bbox.x0);

      let firstName = "",
        fullName = "";
      if (nameWords.length) {
        const nw = nameWords
          .slice(0, 2)
          .map(
            (w) =>
              w.text.charAt(0).toUpperCase() + w.text.slice(1).toLowerCase(),
          );
        firstName = nw[0];
        fullName = nw.join(" ");
      } else {
        const np = ed.email.split("@")[0];
        firstName = np.includes(".")
          ? np.split(".")[0]
          : np.includes("_")
            ? np.split("_")[0]
            : np;
        firstName = firstName.charAt(0).toUpperCase() + firstName.slice(1);
        fullName = firstName;
      }

      let company = "";
      if (companyHdrs.length) {
        const chx = companyHdrs[0].bbox.x0;
        const cw = words
          .filter(
            (w) =>
              w.bbox.x0 >= chx - 50 &&
              w.bbox.x0 < chx + 300 &&
              Math.abs(w.bbox.y0 - ed.y) < tol &&
              w.text.length > 1 &&
              !w.text.includes("@"),
          )
          .sort((a, b) => a.bbox.x0 - b.bbox.x0);
        if (cw.length) {
          const pot = cw
            .slice(0, 5)
            .map((w) => w.text)
            .join(" ")
            .trim();
          if (pot && pot !== pot.toLowerCase() && pot.length > 1) company = pot;
        }
      } else {
        const cw = words
          .filter(
            (w) =>
              w.bbox.x0 > nameMaxX + 50 &&
              w.bbox.x0 < ed.x - 80 &&
              Math.abs(w.bbox.y0 - ed.y) < tol &&
              w.text.length > 1 &&
              !w.text.includes("@"),
          )
          .sort((a, b) => a.bbox.x0 - b.bbox.x0);
        if (cw.length) {
          const pot = cw
            .slice(0, 5)
            .map((w) => w.text)
            .join(" ")
            .trim();
          if (pot && pot !== pot.toLowerCase()) company = pot;
        }
      }
      if (!company) {
        const domain = ed.email.split("@")[1].split(".")[0];
        company = domain.charAt(0).toUpperCase() + domain.slice(1);
      }

      return {
        contact: fullName,
        firstName,
        email: ed.email,
        company,
        title: "",
        phone: "",
        location: "",
      };
    });
  }

  function parseCSVContacts(rows, mapping) {
    return rows
      .filter((row) => row.some((c) => c))
      .map((row) => {
        const get = (k) =>
          mapping[k] !== undefined ? String(row[mapping[k]] || "").trim() : "";
        let loc = get("location");
        const c = {
          contact: get("contact"),
          email: get("email"),
          company: get("company"),
          title: get("title"),
          phone: get("phone"),
          location: loc,
        };
        if (c.contact) c.firstName = c.contact.split(" ")[0];
        else if (c.email) {
          const np = c.email.split("@")[0];
          c.firstName =
            np.split(".")[0].charAt(0).toUpperCase() +
            np.split(".")[0].slice(1);
          c.contact = c.firstName;
        }
        if (!c.company && c.email) {
          const d = c.email.split("@")[1].split(".")[0];
          c.company = d.charAt(0).toUpperCase() + d.slice(1);
        }
        return c;
      })
      .filter((c) => c.email);
  }

  function dedupeAdd(existing, incoming) {
    const seen = new Set(existing.map((c) => c.email));
    return [
      ...existing,
      ...incoming.filter((c) => {
        if (seen.has(c.email)) return false;
        seen.add(c.email);
        return true;
      }),
    ];
  }

  // ── HOW TO USE ─────────────────────────────────────────────────────────
  function HowToUse() {
    const [open, setOpen] = usePState(false);
    const steps = [
      {
        num: "1",
        title: "Upload Contacts",
        body: "Screenshot from Apollo, LinkedIn, or Zoho — OCR extracts names and emails automatically. Or drop a CSV/Excel export. Drag and drop anywhere on the page.",
      },
      {
        num: "2",
        title: "Review & Edit",
        body: "Contacts load into the table. Edit any name, company, or title inline. Remove bad rows with ✕.",
      },
      {
        num: "3",
        title: "Pick a Template",
        body: "Choose from 5 quick templates or write your own. Use {name} and {company} as merge tags — they personalize per contact at draft time.",
      },
      {
        num: "4",
        title: "Draft & Send",
        body: "Hit Draft on any row. Your email client opens with a fully personalized email ready to send. Each contact gets their own — no one sees the others.",
      },
      {
        num: "5",
        title: "Export",
        body: "Export Tracker saves your list as Excel with Status, Date Contacted, and Notes columns — ready for any CRM.",
      },
    ];
    const gold =
      "linear-gradient(to bottom,#cf972d 22%,#f9f295 45%,#e0aa3e 50%,#b8860b 55%,#f9f295 78%)";
    return h(
      "div",
      {
        style: {
          marginBottom: "16px",
          border: "1px solid rgba(201,168,76,.2)",
          background:
            "linear-gradient(160deg,#2e2b32 0%,#252328 18%,#1c1a1f 40%,#1c1a1f 100%)",
          position: "relative",
          overflow: "hidden",
        },
      },
      h("div", {
        style: {
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "1px",
          background:
            "linear-gradient(90deg,transparent,rgba(201,168,76,.5) 30%,rgba(249,242,149,.8) 50%,rgba(201,168,76,.5) 70%,transparent)",
          pointerEvents: "none",
        },
      }),
      h(
        "div",
        {
          onClick: () => setOpen((o) => !o),
          style: {
            padding: "11px 18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            cursor: "pointer",
            userSelect: "none",
          },
          onMouseEnter: (e) =>
            (e.currentTarget.style.background = "rgba(201,168,76,.04)"),
          onMouseLeave: (e) =>
            (e.currentTarget.style.background = "transparent"),
        },
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "12px" } },
          h(
            "span",
            {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: "9px",
                letterSpacing: ".28em",
                textTransform: "uppercase",
                background: gold,
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
                fontWeight: "600",
              },
            },
            "How To Use",
          ),
          h(
            "span",
            {
              style: {
                fontFamily: "Cormorant Garamond,serif",
                fontStyle: "italic",
                fontSize: "12px",
                color: "rgba(245,240,232,.35)",
              },
            },
            "First time? Start here.",
          ),
        ),
        h(
          "span",
          {
            style: {
              fontFamily: "Cinzel,serif",
              fontSize: "11px",
              color: "rgba(201,168,76,.5)",
              display: "inline-block",
              transform: open ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform .2s",
            },
          },
          "▾",
        ),
      ),
      open &&
        h(
          "div",
          {
            style: {
              padding: "0 18px 18px",
              borderTop: "1px solid rgba(201,168,76,.1)",
            },
          },
          h(
            "div",
            {
              style: {
                display: "grid",
                gridTemplateColumns: "repeat(5,1fr)",
                gap: "10px",
                marginTop: "14px",
              },
            },
            steps.map((s) =>
              h(
                "div",
                {
                  key: s.num,
                  style: {
                    background: "rgba(255,255,255,.03)",
                    border: "1px solid rgba(201,168,76,.12)",
                    padding: "12px 14px",
                  },
                },
                h(
                  "div",
                  {
                    style: {
                      fontFamily: "Cinzel,serif",
                      fontSize: "18px",
                      fontWeight: "700",
                      background: gold,
                      WebkitBackgroundClip: "text",
                      backgroundClip: "text",
                      color: "transparent",
                      marginBottom: "6px",
                      lineHeight: "1",
                    },
                  },
                  s.num,
                ),
                h(
                  "div",
                  {
                    style: {
                      fontFamily: "Cinzel,serif",
                      fontSize: "8px",
                      letterSpacing: ".18em",
                      textTransform: "uppercase",
                      color: "rgba(201,168,76,.7)",
                      marginBottom: "6px",
                    },
                  },
                  s.title,
                ),
                h(
                  "div",
                  {
                    style: {
                      fontFamily: "Cormorant Garamond,serif",
                      fontSize: "12px",
                      color: "rgba(245,240,232,.55)",
                      lineHeight: "1.6",
                    },
                  },
                  s.body,
                ),
              ),
            ),
          ),
        ),
    );
  }

  // ── MAIN TAB ───────────────────────────────────────────────────────────
  function FUTab({ prefill, onPrefillConsumed, showToast }) {
    const [contacts, setContacts] = usePState(() => loadContacts());
    const [subject, setSubject] = usePState(
      "Following Up — Imperio Talent Solutions",
    );
    const [body, setBody] = usePState(TEMPLATES.followup.body);
    const [solMeta, setSolMeta] = usePState(null);
    const [statusMsg, setStatusMsg] = usePState("");
    const [statusType, setStatusType] = usePState("processing");
    const [progress, setProgress] = usePState(0);
    const [showMap, setShowMap] = usePState(false);
    const [importHdrs, setImportHdrs] = usePState([]);
    const [importData, setImportData] = usePState([]);
    const [ocrWorker, setOcrWorker] = usePState(null);
    const [dragging, setDragging] = usePState(false);

    const imgRef = useRef();
    const csvRef = useRef();
    const bodyRef = useRef();
    const cursorRef = useRef(null); // cached cursor position

    const _showToast = showToast || ((m) => console.log(m));

    // ── Consume prefill from goFU ────────────────────────────────────────
    useEffect(() => {
      if (!prefill) return;
      const t = TEMPLATES.sol;
      setSubject(mergeText(t.subject, { firstName: "", company: "" }, prefill));
      setBody(mergeText(t.body, { firstName: "", company: "" }, prefill));
      setSolMeta(prefill);
      if (onPrefillConsumed) onPrefillConsumed();
    }, [prefill]);

    const status = (msg, type = "processing") => {
      setStatusMsg(msg);
      setStatusType(type);
    };
    const clearStatus = () => setStatusMsg("");

    // ── Template load ────────────────────────────────────────────────────
    function loadTemplate(key) {
      const t = TEMPLATES[key];
      if (!t) return;
      // For sol template, re-merge with current solMeta if present
      setSubject(
        solMeta
          ? mergeText(t.subject, { firstName: "", company: "" }, solMeta)
          : t.subject,
      );
      setBody(
        solMeta
          ? mergeText(t.body, { firstName: "", company: "" }, solMeta)
          : t.body,
      );
      _showToast("Template loaded");
    }

    // ── Insert merge tag at cursor ────────────────────────────────────────
    function insertTag(tag) {
      const ta = bodyRef.current;
      if (!ta) {
        setBody((prev) => prev + tag);
        return;
      }
      // Use cached cursor pos (set onBlur) — clicking a chip moves focus away
      const pos =
        cursorRef.current !== null ? cursorRef.current : ta.value.length;
      const next = ta.value.slice(0, pos) + tag + ta.value.slice(pos);
      setBody(next);
      cursorRef.current = pos + tag.length;
      setTimeout(() => {
        ta.focus();
        ta.selectionStart = ta.selectionEnd = pos + tag.length;
      }, 0);
    }

    // ── OCR ──────────────────────────────────────────────────────────────
    async function handleImage(file) {
      status("Initializing OCR engine...", "processing");
      setProgress(10);
      try {
        let worker = ocrWorker;
        if (!worker) {
          worker = await Tesseract.createWorker();
          await worker.loadLanguage("eng");
          await worker.initialize("eng");
          setOcrWorker(worker);
        }
        setProgress(20);
        status("Preprocessing image...", "processing");
        const preprocessed = await preprocessImg(file);
        setProgress(40);
        status("Scanning for contacts...", "processing");
        const {
          data: { words },
        } = await worker.recognize(preprocessed);
        setProgress(70);
        status("Parsing contacts...", "processing");
        const extracted = extractContactsFromOCR(words);
        if (!extracted.length) {
          status("No emails found. Try a clearer screenshot.", "error");
          setProgress(0);
          return;
        }
        const next = dedupeAdd(contacts, extracted);
        setContacts(next);
        saveContacts(next);
        setProgress(100);
        status(
          "Extracted " + (next.length - contacts.length) + " contacts!",
          "success",
        );
        setTimeout(() => {
          setProgress(0);
          clearStatus();
        }, 2500);
      } catch (err) {
        status("OCR Error: " + err.message, "error");
        setProgress(0);
      }
    }

    // ── CSV ──────────────────────────────────────────────────────────────
    function handleCSV(file) {
      status("Reading file...", "processing");
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const wb = XLSX.read(evt.target.result, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const json = XLSX.utils.sheet_to_json(ws, { header: 1 });
          if (json.length < 2) {
            status("File needs headers and data rows", "error");
            return;
          }
          setImportHdrs(json[0]);
          setImportData(json.slice(1));
          status(
            "Found " + (json.length - 1) + " rows. Map your columns...",
            "success",
          );
          setShowMap(true);
        } catch (err) {
          status("Error: " + err.message, "error");
        }
      };
      reader.readAsArrayBuffer(file);
    }

    function onConfirmMapping(mapping) {
      if (mapping.email === undefined) {
        _showToast("Email column required", true);
        return;
      }
      const parsed = parseCSVContacts(importData, mapping);
      const next = dedupeAdd(contacts, parsed);
      setContacts(next);
      saveContacts(next);
      setShowMap(false);
      status(
        "Imported " + (next.length - contacts.length) + " contacts!",
        "success",
      );
      setTimeout(clearStatus, 3000);
    }

    // ── Drag & Drop ──────────────────────────────────────────────────────
    function onDrop(e) {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (!file) return;
      if (file.type.startsWith("image/")) handleImage(file);
      else if (
        file.name.match(/\.(csv|xlsx|xls)$/i) ||
        file.type.includes("spreadsheet") ||
        file.type.includes("excel") ||
        file.type === "text/csv"
      )
        handleCSV(file);
      else status("Unsupported file type", "error");
    }

    // ── Live preview ─────────────────────────────────────────────────────
    const previewContact = contacts.length
      ? contacts[0]
      : { firstName: "Anthony", company: "Acme Federal" };
    const previewBody = mergeText(body, previewContact, solMeta);

    // ── SOL META banner ──────────────────────────────────────────────────
    const SolBanner =
      solMeta &&
      h(
        "div",
        {
          style: {
            background: "rgba(201,168,76,.08)",
            border: "1px solid rgba(201,168,76,.2)",
            padding: "8px 14px",
            marginBottom: "14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
          },
        },
        h(
          "span",
          {
            style: {
              fontFamily: "JetBrains Mono,monospace",
              fontSize: "10px",
              color: "var(--gold-solid,#C9A84C)",
            },
          },
          "⚡ Prefilled from Pipeline · Sol " +
            solMeta.sol +
            " · NSN " +
            solMeta.nsn,
        ),
        h(
          "button",
          {
            onClick: () => {
              setSolMeta(null);
            },
            style: {
              background: "none",
              border: "none",
              color: "rgba(245,240,232,.4)",
              cursor: "pointer",
              fontSize: "12px",
            },
          },
          "✕ Clear",
        ),
      );

    return h(
      "div",
      {
        style: { padding: "20px" },
        onDragOver: (e) => {
          e.preventDefault();
          setDragging(true);
        },
        onDragLeave: (e) => {
          setDragging(false);
        },
        onDrop,
      },

      // Drag overlay
      dragging &&
        h(
          "div",
          {
            style: {
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,.9)",
              zIndex: 9000,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
            },
          },
          h(
            "div",
            {
              style: {
                border: "2px dashed var(--gold-solid,#C9A84C)",
                padding: "50px 60px",
                textAlign: "center",
              },
            },
            h(
              "div",
              { style: { fontSize: "3em", marginBottom: "14px" } },
              "📎",
            ),
            h(
              "div",
              {
                style: {
                  fontFamily: "Cinzel,serif",
                  fontSize: "14px",
                  letterSpacing: ".2em",
                  textTransform: "uppercase",
                  background:
                    "linear-gradient(to bottom,#cf972d 22%,#f9f295 45%,#e0aa3e 50%,#b8860b 55%,#f9f295 78%)",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                },
              },
              "Drop to Ingest",
            ),
          ),
        ),

      // Mapping modal
      showMap &&
        h(MappingModal, {
          headers: importHdrs,
          onConfirm: onConfirmMapping,
          onCancel: () => {
            setShowMap(false);
            clearStatus();
          },
        }),

      // Sol banner
      SolBanner,

      // How To Use panel
      h(HowToUse, null),

      // Ingest cards
      h(
        "div",
        {
          style: {
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "14px",
            marginBottom: "18px",
          },
        },
        h(
          "div",
          {
            onClick: () => imgRef.current && imgRef.current.click(),
            style: {
              background:
                "linear-gradient(160deg,#2e2b32 0%,#252328 18%,#1c1a1f 40%,#201e24 60%,#252328 80%,#1c1a1f 100%)",
              border: "1px solid rgba(201,168,76,.3)",
              padding: "24px 18px",
              textAlign: "center",
              cursor: "pointer",
              transition: "border-color .2s, transform .15s",
              position: "relative",
            },
            onMouseEnter: (e) => {
              e.currentTarget.style.borderColor = "rgba(201,168,76,.65)";
              e.currentTarget.style.transform = "translateY(-2px)";
            },
            onMouseLeave: (e) => {
              e.currentTarget.style.borderColor = "rgba(201,168,76,.3)";
              e.currentTarget.style.transform = "translateY(0)";
            },
          },
          h("div", { style: { fontSize: "2em", marginBottom: "10px" } }, "📸"),
          h(
            "div",
            {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: "10px",
                letterSpacing: ".18em",
                textTransform: "uppercase",
                color: "var(--gold-solid,#C9A84C)",
                marginBottom: "5px",
              },
            },
            "Upload Screenshot",
          ),
          h(
            "div",
            {
              style: {
                fontSize: "12px",
                color: "rgba(245,240,232,.38)",
                fontStyle: "italic",
              },
            },
            "OCR extract · Built for Zoho Mail",
          ),
        ),
        h(
          "div",
          {
            onClick: () => csvRef.current && csvRef.current.click(),
            style: {
              background:
                "linear-gradient(160deg,#2e2b32 0%,#252328 18%,#1c1a1f 40%,#201e24 60%,#252328 80%,#1c1a1f 100%)",
              border: "1px solid rgba(201,168,76,.3)",
              padding: "24px 18px",
              textAlign: "center",
              cursor: "pointer",
              transition: "border-color .2s, transform .15s",
              position: "relative",
            },
            onMouseEnter: (e) => {
              e.currentTarget.style.borderColor = "rgba(201,168,76,.65)";
              e.currentTarget.style.transform = "translateY(-2px)";
            },
            onMouseLeave: (e) => {
              e.currentTarget.style.borderColor = "rgba(201,168,76,.3)";
              e.currentTarget.style.transform = "translateY(0)";
            },
          },
          h("div", { style: { fontSize: "2em", marginBottom: "10px" } }, "📊"),
          h(
            "div",
            {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: "10px",
                letterSpacing: ".18em",
                textTransform: "uppercase",
                color: "var(--gold-solid,#C9A84C)",
                marginBottom: "5px",
              },
            },
            "Upload CSV / Excel",
          ),
          h(
            "div",
            {
              style: {
                fontSize: "12px",
                color: "rgba(245,240,232,.38)",
                fontStyle: "italic",
              },
            },
            "Apollo · LinkedIn · Any export",
          ),
        ),
      ),
      h("input", {
        type: "file",
        ref: imgRef,
        accept: "image/*",
        style: { display: "none" },
        onChange: (e) => {
          const f = e.target.files[0];
          if (f) handleImage(f);
          e.target.value = "";
        },
      }),
      h("input", {
        type: "file",
        ref: csvRef,
        accept: ".xlsx,.xls,.csv",
        style: { display: "none" },
        onChange: (e) => {
          const f = e.target.files[0];
          if (f) handleCSV(f);
          e.target.value = "";
        },
      }),

      // Status / Progress
      h(StatusBar, { msg: statusMsg, type: statusType }),
      h(ProgressBar, { pct: progress }),

      // Template panel
      h(
        Panel,
        null,
        h(PanelHdr, {
          title: "Email Template",
          right: h(
            "span",
            {
              style: {
                fontFamily: "JetBrains Mono,monospace",
                fontSize: "9px",
                color: "rgba(245,240,232,.35)",
              },
            },
            "Merge tags: {name} · {company}",
          ),
        }),
        h(TemplateStrip, { onLoad: loadTemplate }),
        h(
          "div",
          { style: { padding: "16px 18px" } },
          h(
            "div",
            { style: { marginBottom: "14px" } },
            h(Lbl, null, "Subject Line"),
            h("input", {
              type: "text",
              style: { ...fieldStyle, marginBottom: 0 },
              value: subject,
              onChange: (e) => setSubject(e.target.value),
            }),
          ),
          h(
            "div",
            {
              style: {
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "18px",
              },
            },
            h(
              "div",
              null,
              h(Lbl, null, "Body"),
              h("textarea", {
                ref: bodyRef,
                style: {
                  ...fieldStyle,
                  minHeight: "280px",
                  lineHeight: "1.65",
                },
                value: body,
                onChange: (e) => setBody(e.target.value),
                onBlur: (e) => {
                  cursorRef.current = e.target.selectionStart;
                },
                onKeyUp: (e) => {
                  cursorRef.current = e.target.selectionStart;
                },
                onClick: (e) => {
                  cursorRef.current = e.target.selectionStart;
                },
              }),
              h(
                "div",
                { style: { marginTop: "6px", display: "flex", gap: "8px" } },
                h(
                  "span",
                  {
                    style: {
                      fontFamily: "JetBrains Mono,monospace",
                      fontSize: "9px",
                      color: "rgba(201,168,76,.42)",
                    },
                  },
                  "Insert:",
                ),
                ["{name}", "{company}", "{sol}", "{nsn}", "{qty}", "{due}"].map(
                  (tag) =>
                    h(
                      "span",
                      {
                        key: tag,
                        onClick: () => insertTag(tag),
                        style: {
                          fontFamily: "JetBrains Mono,monospace",
                          fontSize: "9px",
                          color: "var(--gold-solid,#C9A84C)",
                          cursor: "pointer",
                        },
                        onMouseEnter: (e) =>
                          (e.target.style.textDecoration = "underline"),
                        onMouseLeave: (e) =>
                          (e.target.style.textDecoration = "none"),
                      },
                      tag,
                    ),
                ),
              ),
            ),
            h(
              "div",
              null,
              h(
                "div",
                {
                  style: {
                    fontFamily: "Cinzel,serif",
                    fontSize: "8px",
                    letterSpacing: ".22em",
                    textTransform: "uppercase",
                    color: "rgba(201,168,76,.42)",
                    marginBottom: "7px",
                  },
                },
                "Live Preview ",
                h(
                  "span",
                  {
                    style: {
                      fontStyle: "italic",
                      fontWeight: "300",
                      color: "rgba(245,240,232,.3)",
                      fontFamily: "Cormorant Garamond,serif",
                      fontSize: "11px",
                    },
                  },
                  contacts.length ? "(first contact)" : "(sample)",
                ),
              ),
              h(
                "div",
                {
                  style: {
                    background: "rgba(201,168,76,.05)",
                    border: "1px solid rgba(201,168,76,.25)",
                    padding: "14px",
                    fontSize: "13px",
                    lineHeight: "1.7",
                    color: "rgba(245,240,232,.88)",
                    minHeight: "280px",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  },
                },
                previewBody,
              ),
            ),
          ),
        ),
      ),

      // Contacts table (only shown when contacts exist)
      h(ContactsTable, {
        contacts,
        setContacts,
        subject,
        body,
        solMeta,
        showToast: _showToast,
      }),

      // Empty state
      h(
        "div",
        {
          style: {
            textAlign: "center",
            padding: "20px 0 0",
            borderTop: "1px solid rgba(201,168,76,.1)",
            marginTop: "8px",
          },
        },
        h("img", {
          src: "thok_logo_transparent.png",
          alt: "THOK",
          style: {
            width: "90px",
            height: "90px",
            opacity: ".45",
            verticalAlign: "middle",
          },
        }),
      ),

      !contacts.length &&
        h(
          "div",
          { style: { textAlign: "center", padding: "40px 24px" } },
          h(
            "div",
            {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: "42px",
                opacity: ".05",
                color: "var(--gold-solid,#C9A84C)",
                marginBottom: "14px",
              },
            },
            "FU",
          ),
          h(
            "div",
            {
              style: {
                fontFamily: "Cinzel,serif",
                fontSize: "14px",
                color: "rgba(201,168,76,.4)",
                letterSpacing: ".2em",
                textTransform: "uppercase",
                marginBottom: "6px",
              },
            },
            "Upload · Ingest · Draft · Send",
          ),
          h(
            "div",
            {
              style: {
                fontFamily: "Cormorant Garamond,serif",
                fontStyle: "italic",
                fontSize: "14px",
                color: "rgba(245,240,232,.3)",
                maxWidth: "500px",
                margin: "0 auto",
                lineHeight: "1.7",
              },
            },
            "Upload a Zoho screenshot or CSV export to extract contacts. Or use goFU from a Pipeline row to pre-fill a solicitation inquiry.",
          ),
        ),
    );
  }

  // ── EXPOSE ──────────────────────────────────────────────────────────────
  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.FUTab = FUTab;
})();
