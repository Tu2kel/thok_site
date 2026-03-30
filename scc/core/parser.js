(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — RFQ PARSER
  //  Handles DIBBS listing paste + AI summary one-liner + full AI markdown doc
  // ═══════════════════════════════════════════════════════════════════════

  function normalizeNSN(raw) {
    const d = raw.replace(/-/g, "");
    if (d.length !== 13) return raw;
    return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 9)}-${d.slice(9, 13)}`;
  }

  function isListing(text) {
    if (!text) return false;
    // Match SPE sol number in first 3 lines, or Hist. marker (Navigator format)
    const top = text.split("\n").slice(0, 3).join(" ");
    return /\bSPE[A-Z0-9]/i.test(top) || /\bHist\./i.test(text);
  }

  function parseListing(text) {
    const d = {};

    // Sol number — handles SPE2DS26T6498, SPE2DS-26-T-6498, and paste artifacts missing leading S
    const solFull = text.match(/\b(SPE[A-Z0-9][A-Z0-9\-]*[A-Z0-9])\b/i);
    const solPartial = text.match(/\b(PE[0-9][A-Z0-9\-]{6,})\b/i);
    if (solFull) {
      d.sol_number = solFull[1].toUpperCase();
    } else if (solPartial) {
      d.sol_number = "S" + solPartial[1].toUpperCase();
    } else {
      d.sol_number = null;
    }

    // Qty + unit — handles plain digits AND comma-formatted numbers (18,642)
    const UNITS =
      "EA|LT|BX|DZ|PR|FT|GL|LB|PK|RL|SE|ST|PG|HD|SH|VI|CY|GR|MX|TH|YD|SL|RO|AY|KT";
    const qtyRx = new RegExp(
      "\\b(\\d{1,3}(?:,\\d{3})*|\\d+)[ \\t]+(" + UNITS + ")\\b",
      "i",
    );
    const qty = text.match(qtyRx);
    if (qty) {
      d.quantity = parseFloat(qty[1].replace(/,/g, ""));
      d.unit_of_issue = qty[2].toUpperCase();
    }

    // Item name — text between "Save" and first qty+unit token
    if (qty && qty.index != null) {
      const afterSave = text.match(/Save[ \t]+([\s\S]+)/i);
      if (afterSave) {
        const chunk = afterSave[1];
        const qtyEscaped = qty[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const qtyFlexRx = new RegExp(qtyEscaped.replace(/\s+/, "\\s+"));
        const flexMatch = chunk.match(qtyFlexRx);
        const qIdx = flexMatch ? flexMatch.index : chunk.indexOf(qty[0]);
        const raw =
          qIdx > 0
            ? chunk.substring(0, qIdx).trim()
            : chunk.split(/[\t]{2,}|\s{3,}/)[0].trim();
        d.item_name = raw.replace(/[\s\d]+$/, "").trim() || null;
      }
    }

    // Prices — try dollar-signed first
    let prices = [...text.matchAll(/\$([0-9,]+\.\d{2})/g)].map((m) =>
      parseFloat(m[1].replace(/,/g, "")),
    );

    // Navigator-mode: plain numbers adjacent to "Hist." marker
    // Format: UNIT_PRICE  Hist.  EXTENDED_PRICE  QUOTE_DUE  DEL_DAYS  NSN
    if (prices.length === 0) {
      // Try: number before "Hist." = unit price, number after "Hist." = extended
      const histBlock = text.match(
        /([\d,]+\.\d{2})[ \t]+Hist\.[ \t]+([\d,]+\.\d{2})/i,
      );
      if (histBlock) {
        prices = [
          parseFloat(histBlock[1].replace(/,/g, "")),
          parseFloat(histBlock[2].replace(/,/g, "")),
        ];
      }
    }

    // Navigator-mode: no Hist., look for two decimals in order: smaller then larger
    if (prices.length === 0) {
      const allDecimals = [...text.matchAll(/\b(\d{1,6}(?:,\d{3})*\.\d{2})\b/g)]
        .map((m) => parseFloat(m[1].replace(/,/g, "")))
        .filter((v) => v > 0);
      if (allDecimals.length >= 2) {
        // unit price = smaller, extended = larger
        const sorted = [...allDecimals].sort((a, b) => a - b);
        prices = [sorted[0], sorted[sorted.length - 1]];
      } else if (allDecimals.length === 1) {
        prices = [allDecimals[0]];
      }
    }

    d.unit_price = prices[0] ?? null;
    d.extended_price = prices[1] ?? null;
    d.price_is_hist = /\bHist\./i.test(text);

    // Dates — all MM/DD/YY; first=quote due, last=posted
    const allDates = [...text.matchAll(/(\d{2}\/\d{2}\/\d{2})/g)].map(
      (m) => m[1],
    );
    d.quote_due = allDates[0] ?? null;
    d.posted_date = allDates.length > 1 ? allDates[allDates.length - 1] : null;

    // Delivery days — primary: between quote date and 13-digit NSN
    // Navigator format: QUOTE_DUE  DEL_DAYS  NSN
    const delRx = /\d{2}\/\d{2}\/\d{2}[ \t]+(\d{1,3})[ \t]+\d{13}/;
    const del = text.match(delRx);
    if (del) {
      d.delivery_days = parseInt(del[1]);
    } else {
      // Fallback: number immediately before the 13-digit NSN block
      const delFb = text.match(/\b(\d{1,3})[ \t]+(\d{13})\b/);
      if (delFb) d.delivery_days = parseInt(delFb[1]);
    }

    // NSN — 13 consecutive digits or dashed XXXX-XX-XXX-XXXX
    const nsnRx = text.match(/\b(\d{4}[\-]?\d{2}[\-]?\d{3}[\-]?\d{4})\b/);
    if (nsnRx) {
      d.nsn = normalizeNSN(nsnRx[1].replace(/-/g, ""));
      d.fsc = nsnRx[1].replace(/-/g, "").slice(0, 4);
    }

    // FOB
    const fob = text.match(/\b(Dest\.|Orig\.)/);
    d.fob = fob ? fob[1] : null;

    // Set aside — handles "Y Char" and "Y TU Char" (Navigator puts material code between Y/N and Char)
    const sa =
      text.match(/\b(Y|N)[ \t]+(?:\w+[ \t]+)?Char/i) ||
      text.match(/Set[ \t]+Aside[:\s]+(Y|N)/i);
    d.set_aside = sa ? sa[1].toUpperCase() : null;

    // Suppliers — NAME|CAGE|PARTNO (DIBBS pipe format)
    const sups = [
      ...text.matchAll(/([A-Z][A-Z0-9 ,\.&]+?)\|([A-Z0-9]{5})\|([^|;\n]+)/g),
    ];
    if (sups.length > 0) {
      d.ref_supplier = sups[0][1].trim();
      d.ref_supplier_cage = sups[0][2];
      d.ref_part_number = sups[0][3].trim();
      d.all_suppliers = sups
        .map((s) => `${s[1].trim()} (${s[2]}) P/N: ${s[3].trim()}`)
        .join(" · ");
    }

    return d;
  }

  function parseAIText(text) {
    const d = {};

    // ── TAB-DELIMITED TABLE (highest priority — exact key:value rows) ────
    const tabLines = text.split("\n").filter((l) => l.includes("\t"));
    if (tabLines.length >= 3) {
      const tbl = {};
      tabLines.forEach((line) => {
        const tab = line.indexOf("\t");
        if (tab < 1) return;
        const k = line
          .slice(0, tab)
          .trim()
          .toLowerCase()
          .replace(/[\s\/]+/g, "_");
        const v = line.slice(tab + 1).trim();
        if (v && !/^not (shown|indicated|specified)/i.test(v)) tbl[k] = v;
      });
      if (tbl.nsn) {
        d.nsn = normalizeNSN(tbl.nsn.replace(/[\s\-]/g, ""));
        d.fsc = d.nsn.slice(0, 4);
      }
      if (tbl.fsc && !d.fsc) d.fsc = tbl.fsc;
      if (tbl.item_name) d.item_name = tbl.item_name;
      if (tbl.sol_number) d.sol_number = tbl.sol_number;
      if (tbl.clin) d.clin = tbl.clin;
      if (tbl.fob) d.fob = tbl.fob;
      if (tbl.set_aside) d.set_aside = tbl.set_aside;
      if (tbl.ship_to) d.ship_to = tbl.ship_to;
      if (tbl.shelf_life) d.shelf_life = tbl.shelf_life;
      if (tbl.delivery) {
        const dm = tbl.delivery.match(/(\d+)/);
        if (dm) d.delivery_days = parseInt(dm[1]);
      }
      if (tbl.quantity) {
        const qm = tbl.quantity.match(
          /^(\d{1,3}(?:,\d{3})*|\d+(?:\.\d+)?)\s*([A-Z]{2})?/i,
        );
        if (qm) {
          d.quantity = parseFloat(qm[1].replace(/,/g, ""));
          if (qm[2]) d.unit_of_issue = qm[2].toUpperCase();
        }
      }
      if (tbl.unit_price) {
        const pm = tbl.unit_price.match(/\$?([0-9,]+\.\d{2})/);
        if (pm) d.unit_price = parseFloat(pm[1].replace(/,/g, ""));
      }
      if (tbl.extended) {
        const em = tbl.extended.match(/\$?([0-9,]+\.\d{2})/);
        if (em) d.extended_price = parseFloat(em[1].replace(/,/g, ""));
      }
      if (tbl.quote_due) d.quote_due = tbl.quote_due;
      if (tbl.posted && !/^not/i.test(tbl.posted)) d.posted_date = tbl.posted;
      if (tbl.packaging) {
        const pkgm = tbl.packaging.match(
          /(ASTM\s+[A-Z]\d+\w*|MIL-STD-\d+\w*)/i,
        );
        if (pkgm) d.packaging_standard = pkgm[1];
        else d.packaging_standard = tbl.packaging;
      }
    }

    // ── NSN ─────────────────────────────────────────────────────────────
    const nsnLabeled = text.match(
      /\*{0,2}NSN[:\*\s]+\*{0,2}([0-9]{4}[\-]?[0-9]{2}[\-]?[0-9]{3}[\-]?[0-9]{4})/i,
    );
    const nsnInline = text.match(/\b(\d{4}-\d{2}-\d{3}-\d{4})\b/);
    const nsnRaw = nsnLabeled ? nsnLabeled[1] : nsnInline ? nsnInline[1] : null;
    if (nsnRaw) {
      d.nsn = normalizeNSN(nsnRaw.replace(/[\s\-]/g, ""));
      d.fsc = d.nsn.slice(0, 4);
    }

    // ── ITEM NAME ────────────────────────────────────────────────────────
    const itemMd = text.match(/\*\*Item[:\*\s]+\*{0,2}\s*([^\n\*·\|]+)/i);
    const itemOneliner = text.match(
      /SPE\w+\s*[—–-]\s*([A-Z][A-Z,\s]+?)(?:\s*[·\|]|\s*FSC|\s*$)/im,
    );
    if (itemMd) d.item_name = itemMd[1].trim();
    else if (itemOneliner) d.item_name = itemOneliner[1].trim();

    // ── SUPPLIERS ────────────────────────────────────────────────────────
    const suppMd = [
      ...text.matchAll(
        /\*\*([^*]+)\*\*\s*[—–-]\s*CAGE\s*\*\*([A-Z0-9]{5})\*\*\s*[—–-]\s*\*\*P\/N\s+([^*\n]+)\*\*/gi,
      ),
    ];
    if (suppMd.length > 0) {
      d.ref_supplier = suppMd[0][1].trim();
      d.ref_supplier_cage = suppMd[0][2].trim();
      d.ref_part_number = suppMd[0][3].trim();
      d.all_suppliers = suppMd
        .map((s) => `${s[1].trim()} (${s[2].trim()}) P/N: ${s[3].trim()}`)
        .join(" · ");
    }

    if (!d.ref_supplier) {
      const suppCondensed = [
        ...text.matchAll(/([A-Z][A-Za-z\s]+?)\s*\(([A-Z0-9]{5}),\s*([^)]+)\)/g),
      ];
      if (suppCondensed.length > 0) {
        d.ref_supplier = suppCondensed[0][1].trim();
        d.ref_supplier_cage = suppCondensed[0][2].trim();
        d.ref_part_number = suppCondensed[0][3].trim();
        d.all_suppliers = suppCondensed
          .map((s) => `${s[1].trim()} (${s[2].trim()}) P/N: ${s[3].trim()}`)
          .join(" · ");
      }
    }

    if (!d.ref_supplier) {
      const pipeSups = [
        ...text.matchAll(/([A-Z][A-Z0-9 ,\.&]+?)\|([A-Z0-9]{5})\|([^|;\n]+)/g),
      ];
      if (pipeSups.length > 0) {
        d.ref_supplier = pipeSups[0][1].trim();
        d.ref_supplier_cage = pipeSups[0][2];
        d.ref_part_number = pipeSups[0][3].trim();
        d.all_suppliers = pipeSups
          .map((s) => `${s[1].trim()} (${s[2]}) P/N: ${s[3].trim()}`)
          .join(" · ");
      }
    }

    // ── SHIP-TO ──────────────────────────────────────────────────────────
    const addrBlock = text.match(
      /([A-Z0-9]{3,}\s*\n[^\n]+\n[^\n]+\n\d+\s+[A-Z][A-Z\s]+(RD|ST|AVE|BLVD|DR|WAY|LN|PKWY|ROAD|STREET)[^\n]*\n[A-Z][A-Z\s,]+\d{5})/i,
    );
    if (addrBlock) {
      d.ship_to = addrBlock[1].replace(/\n/g, ", ").trim();
    }

    if (!d.ship_to) {
      const clean = text.replace(/\*\*/g, "");
      const streetLine = clean.match(
        /\d+\s+[A-Z][A-Z\s]+(RD|ST|AVE|BLVD|DR|WAY|LN|PKWY|ROAD|STREET|CROCKETT)[^\n]*/i,
      );
      if (streetLine) {
        const idx = clean.indexOf(streetLine[0]);
        const lines = clean
          .slice(idx)
          .split("\n")
          .slice(0, 3)
          .map((l) => l.trim())
          .filter(Boolean);
        d.ship_to = lines.join(", ");
      }
    }

    if (!d.ship_to) {
      const vessel = text.match(
        /USS\s+[\w\s]+?(?:CVN|LHD|DDG|LPD|LHA|FFG|CG|SSN)\s*\d+[^\n]*/i,
      );
      if (vessel) d.ship_to = vessel[0].trim();
    }

    if (!d.ship_to) {
      const fpo = text.match(/[^\n]*(?:FPO|APO|DPO)\s+[A-Z]{2}\s+\d{5}[^\n]*/i);
      if (fpo) d.ship_to = fpo[0].trim();
    }

    // ── PACKAGING ────────────────────────────────────────────────────────
    const pkg = text.match(/(ASTM\s+[A-Z]\d+\w*|MIL-STD-\d+\w*)/i);
    d.packaging_standard = pkg ? pkg[1] : null;

    // ── CLIN ─────────────────────────────────────────────────────────────
    const clin = text.match(/\*{0,2}CLIN[:\*\s]+\*{0,2}\s*(\w+)/i);
    d.clin = clin ? clin[1] : null;

    // ── DELIVERY DAYS ────────────────────────────────────────────────────
    const delFormatted = text.match(/\b0*(\d{1,3})\s*days?\b/i);
    if (delFormatted) d.delivery_days = parseInt(delFormatted[1]);

    // ── SHELF LIFE ───────────────────────────────────────────────────────
    const sl = text.match(
      /\b(\d+)[\- ]months?\s+(?:shelf|non)|shelf[\s\-]?life[^:]*?[:\s]+(\d+)\s*months?/i,
    );
    if (sl) d.shelf_life = (sl[1] || sl[2]) + " months";

    // ── QUOTE DUE ────────────────────────────────────────────────────────
    const dueDateAI = text.match(/[Dd]ue[:\s]+(\d{2}\/\d{2}\/\d{2})/);
    if (dueDateAI) d.quote_due = dueDateAI[1];

    // ── UNIT PRICE ───────────────────────────────────────────────────────
    const priceEA = text.match(/\$([0-9,]+\.\d{2})\s*\/\s*ea/i);
    if (priceEA) d.unit_price = parseFloat(priceEA[1].replace(/,/g, ""));

    return d;
  }

  // Expose globally
  window.SCC_PARSER = { normalizeNSN, isListing, parseListing, parseAIText };
})();
