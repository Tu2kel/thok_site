// Section B analyzer — turns the raw Section B text of a DLA solicitation into
// structured fields (for the RFQ + the sol record) PLUS a narrative summary (for
// bid decisions). Uses Claude via the Anthropic Messages API with a forced
// tool call, so the output is always valid structured JSON.
//
// Section B carries what the DIBBS Navigator grid does NOT: the real P/N (always
// labeled), unit of issue, FOB, inspection/acceptance point (origin vs
// destination), ship-to addresses, packaging spec, certs, commercial standards,
// and CMMC/cyber notes. This is the enrichment that fills the P/N gap AND makes
// the RFQ carry each item's true requirements.
//
// Requires ANTHROPIC_API_KEY in the environment. Model: claude-sonnet-5.

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.SECTION_B_MODEL || "claude-sonnet-5";

// Structured-output schema Claude must fill (forced tool_use).
const EXTRACT_TOOL = {
  name: "record_section_b",
  description: "Record the extracted requirements from a DLA solicitation Section B.",
  input_schema: {
    type: "object",
    properties: {
      nsn:           { type: "string", description: "National Stock Number (13 digits, labeled NSN). Digits only. Empty if none." },
      part_number:   { type: "string", description: "Manufacturer part number (labeled P/N or PART NUMBER). Empty if none." },
      mfr_cage:      { type: "string", description: "Manufacturer CAGE code tied to the P/N. Empty if none." },
      item_name:     { type: "string", description: "Full nomenclature / item description." },
      unit_of_issue: { type: "string", description: "Unit of issue, e.g. EA, YD, HD, PG." },
      quantity:      { type: "string", description: "Total quantity required (sum CLINs if multiple)." },
      delivery_days: { type: "string", description: "Delivery window in days (ADO/ARO). Number only." },
      fob:           { type: "string", description: "FOB point: ORIGIN or DESTINATION." },
      inspection_point: { type: "string", description: "Inspection point: ORIGIN or DESTINATION." },
      acceptance_point: { type: "string", description: "Acceptance point: ORIGIN or DESTINATION." },
      ship_to:       { type: "string", description: "Ship-to / delivery address(es), condensed to one line each." },
      packaging:     { type: "string", description: "Packaging requirement, e.g. 'ASTM D3951; MIL-STD-129 marking'." },
      certs:         { type: "array", items: { type: "string" }, description: "Required certs, e.g. 'Certificate of Conformance 52.246-15', 'lot traceability'." },
      commercial_standards: { type: "array", items: { type: "string" }, description: "Applicable commercial standards (ASTM/ANSI/NAS/SAE etc.)." },
      cmmc_cyber:    { type: "string", description: "Any CMMC / cybersecurity requirement noted, else empty." },
      summary:       { type: "string", description: "2-4 sentence plain-English summary of what this solicitation requires, for a bidder. UNOFFICIAL." },
    },
    required: ["part_number", "item_name", "summary"],
  },
};

const SYSTEM = `You analyze DLA solicitation "Section B" text and extract procurement requirements accurately. The text is OCR-like and word-order may be scrambled — reason past that. Identify the required item, technical specs, delivery, packaging, inspection/acceptance point, FOB, ship-to addresses, certifications, applicable commercial standards (ASTM/ANSI/NAS/SAE), and any CMMC/cybersecurity requirement. The part number is normally labeled "P/N" or "PART NUMBER". Omit any references to sam.gov. Call record_section_b exactly once with your findings; leave a field empty if truly not present — never guess.`;

async function analyzeSectionB(sectionBText, solNumber) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const text = String(sectionBText || "").slice(0, 60000); // bound token cost
  if (text.length < 40) return { ok: false, error: "section B text too short/empty" };

  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      system: SYSTEM,
      tools: [EXTRACT_TOOL],
      tool_choice: { type: "tool", name: "record_section_b" },
      messages: [{
        role: "user",
        content: `Analyze the following Section B from DLA solicitation ${solNumber || "(unknown)"} and record the requirements.\n\n${text}`,
      }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Anthropic API error: " + JSON.stringify(data).slice(0, 300));
  const toolUse = (data.content || []).find(c => c.type === "tool_use");
  if (!toolUse) throw new Error("no tool_use in Claude response");
  return { ok: true, fields: toolUse.input, usage: data.usage || null };
}

module.exports = { analyzeSectionB };
