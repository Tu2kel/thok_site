// DiWire "Wire it from a photo": Claude reads a photo of an open box and fills in the
// answers to the app's "What's in my box?" questions. The wiring itself always comes from
// the app's own circuit builder; the model never writes wiring steps.
// Keep PHOTO_PROMPT in sync with the copy in the app (search for PHOTO_PROMPT there).

export const PRO_DAILY = 10;   // photos included per day on Pro
export const TEASER_DAILY = 1; // free / Pick 3 preview reads per day (results blurred)

export const PHOTO_PROMPT = `You read a photo of an open residential electrical box (United States, NEC) for a DIY wiring app. Report only what is visible. Reply with JSON only, no other text, in exactly this shape:
{"ok":true,"stop":false,"stopReason":"","box":"switch","dev":"sp","cables":2,"red":"no","whites":"spliced","metal":false,"seen":"","unsure":[]}

Fields:
- ok: false if the photo is not an open electrical box with its wiring visible. Then set box, dev, cables, red, whites and metal to null and use "seen" to say what the photo shows instead.
- box: "switch" (wall switch box), "light" (ceiling or wall light fixture box) or "recep" (receptacle box).
- dev: switch box: count the switch's screws not counting the green one. 2 screws = "sp" (also dimmers and smart switches), 3 screws with one darker common screw = "3w", 4 screws = "4w". Receptacle box: "recep", or "gfci" if it has TEST/RESET buttons. Light box: "light".
- cables: count the cable jackets (sheaths) entering the box, not the individual wires. Use 3 for three or more.
- red: "yes" if any red insulated conductor is visible, otherwise "no".
- whites: switch box: "spliced" = whites twisted together under a wire nut, not on the switch; "device" = a white lands on a switch screw (it may have black tape); "capped" = one white capped by itself; "taped" = whites spliced together but marked with black tape. Light box: "spliced" = whites spliced with the fixture white; "toblack" = a white spliced to a black or marked with black tape. Receptacle box: null.
- metal: true if the box is metal, false if plastic.
- stop: true if you see any of these, and explain in stopReason in plain words: aluminum (dull silver) branch-circuit wire; cloth- or rubber-insulated wire or knob-and-tube; scorch, melt or burn marks; cracked, brittle or damaged insulation; a box so packed the device cannot fold back in; commercial wiring (boxes mounted on metal strut or channel, runs of exposed metal conduit through a commercial space, MC armored cable, 277 V, 480 V or 3-phase labels, a commercial panel), and say that DiWire is for homes only; hands working in a box that looks energized. Otherwise stop is false and stopReason is "".
- seen: one or two short plain sentences a homeowner understands, like "Plastic switch box with two cables (one has a red wire) and a single-pole switch."
- unsure: list the field names you could not see clearly. Still give your best guess, or null if you cannot tell at all.`;

const BOX = { switch: "switch box", light: "light box", recep: "receptacle box" };
const DEV = { sp: "a single-pole switch", "3w": "a 3-way switch", "4w": "a 4-way switch", recep: "a receptacle", gfci: "a GFCI receptacle", light: "a light fixture" };

// What a free or Pick 3 account is allowed to see: proof the photo was read, nothing more.
export function teaserOf(r) {
  if (!r || !r.ok) return { ok: !!(r && r.ok), headline: r && r.seen ? "That doesn't look like an open electrical box." : "Couldn't read that photo." };
  const box = r.box ? BOX[r.box] : "box";
  const cab = r.cables ? `${r.cables === 3 ? "3 or more" : r.cables} cable${r.cables === 1 ? "" : "s"}` : "";
  const dev = r.dev && r.dev !== "light" ? DEV[r.dev] : "";
  const tail = [cab, dev].filter(Boolean).join(" and ");
  return { ok: true, stop: !!r.stop, headline: `I found a ${box}${tail ? " with " + tail : ""}.` };
}

export function parseReply(text) {
  const m = String(text || "").match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no JSON in reply");
  const j = JSON.parse(m[0]);
  const pick = (v, ok) => (ok.includes(v) ? v : null);
  const cables = [1, 2, 3].includes(Number(j.cables)) ? Number(j.cables) : Number(j.cables) > 3 ? 3 : null;
  return {
    ok: !!j.ok,
    stop: !!j.stop,
    stopReason: String(j.stopReason || "").slice(0, 400),
    box: pick(j.box, ["switch", "light", "recep"]),
    dev: pick(j.dev, ["sp", "3w", "4w", "recep", "gfci", "light"]),
    cables,
    red: pick(j.red, ["yes", "no"]),
    whites: pick(j.whites, ["spliced", "device", "capped", "taped", "toblack"]),
    metal: typeof j.metal === "boolean" ? j.metal : null,
    seen: String(j.seen || "").slice(0, 400),
    unsure: Array.isArray(j.unsure) ? j.unsure.filter((x) => typeof x === "string").slice(0, 8) : [],
  };
}

export async function readPhoto({ key, model, media, data }) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: 700,
      system: PHOTO_PROMPT,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: media, data } },
        { type: "text", text: "Read this box. Reply with the JSON only." },
      ] }],
    }),
  });
  if (!r.ok) throw Object.assign(new Error(`vision ${r.status}`), { status: r.status, body: await r.text().catch(() => "") });
  const j = await r.json();
  const text = (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  return { result: parseReply(text), usage: j.usage || null };
}
