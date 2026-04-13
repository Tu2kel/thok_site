(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — SOURCE ACTIONS
  //  Thin utility: click-to-search bridges between Awards Intel,
  //  Source Drawer, and external lookup targets.
  //  No React dependency. Loaded before tab files.
  //  Exports: window.SCC_SOURCE_ACTIONS
  // ═══════════════════════════════════════════════════════════════════════

  // ── SAM.gov entity search ─────────────────────────────────────────────
  function searchAwardee(name) {
    if (!name) return;
    const q = encodeURIComponent(name.trim());
    window.open(
      "https://sam.gov/search/?index=ed&page=1&pageSize=25&sort=-modifiedDate&sfm%5BsimpleSearch%5D%5BkeywordRadio%5D=ALL&sfm%5BsimpleSearch%5D%5BkeywordTerm%5D=" +
        q,
      "_blank",
    );
  }

  // ── NSN distributor search ────────────────────────────────────────────
  function searchNSN(nsn, itemName) {
    if (!nsn) return;
    const nsnDashed = nsn.includes("-")
      ? nsn
      : nsn.replace(/(\d{4})(\d{2})(\d{3})(\d{4})/, "$1-$2-$3-$4");
    const q = itemName
      ? encodeURIComponent('"' + nsnDashed + '" ' + itemName + " distributor")
      : encodeURIComponent('"' + nsnDashed + '" distributor');
    window.open("https://www.google.com/search?q=" + q, "_blank");
  }

  // ── Local/regional supplier search ───────────────────────────────────
  // Fires the local-first sourcing formula from the protocol:
  // "[item type] distributor" + "[region]" + "government OR DLA OR military"
  function searchLocal(itemName, fsc) {
    if (!itemName && !fsc) return;
    const base = itemName || "FSC " + fsc;
    const q = encodeURIComponent(
      base + " distributor Texas government OR DLA OR military",
    );
    window.open("https://www.google.com/search?q=" + q, "_blank");
  }

  // ── DIBBS supplier history search (by P/N or NSN) ────────────────────
  function searchDIBBS(nsn) {
    if (!nsn) return;
    const nsnRaw = nsn.replace(/-/g, "");
    window.open(
      "https://www.dibbs.bsm.dla.mil/rfq/rqhist.aspx?nsn=" + nsnRaw,
      "_blank",
    );
  }

  // ── USASpending awardee deep-link ────────────────────────────────────
  function searchUSASpending(name) {
    if (!name) return;
    const q = encodeURIComponent(name.trim());
    window.open(
      "https://www.usaspending.gov/search/?hash=&filters=%7B%22recipient_search_text%22%3A%5B%22" +
        q +
        "%22%5D%7D",
      "_blank",
    );
  }

  // ── Shared button style (no React dep — returns plain style object) ──
  function actionBtnStyle(variant) {
    const base = {
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      fontFamily: "Cinzel,serif",
      fontSize: "9px",
      letterSpacing: ".14em",
      textTransform: "uppercase",
      padding: "4px 10px",
      cursor: "pointer",
      border: "none",
      background: "transparent",
      transition: "opacity .15s",
    };
    if (variant === "gold") {
      return {
        ...base,
        border: "1px solid rgba(201,168,76,.35)",
        color: "var(--gold-dim)",
      };
    }
    if (variant === "dim") {
      return {
        ...base,
        border: "1px solid rgba(255,255,255,.1)",
        color: "var(--body-faint)",
      };
    }
    // default
    return {
      ...base,
      border: "1px solid rgba(201,168,76,.2)",
      color: "var(--body-faint)",
    };
  }

  // ── Expose ────────────────────────────────────────────────────────────
  window.SCC_SOURCE_ACTIONS = {
    searchAwardee,
    searchNSN,
    searchLocal,
    searchDIBBS,
    searchUSASpending,
    actionBtnStyle,
  };
})();
