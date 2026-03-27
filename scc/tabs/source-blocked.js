(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — SOURCE · BLOCKED MANUFACTURER PANEL
  //  Pre-compiled React · No Babel · No JSX
  //  Exports: window.SCC_TABS.isBlocked
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

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.isBlocked = isBlocked;
  window.SCC_TABS.BlockedMfrPanel = BlockedMfrPanel;
})();
