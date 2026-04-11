// const fetch = require("node-fetch");

exports.handler = async (event) => {
  try {
    const { fsc, min_amount, max_amount, years_back } = JSON.parse(
      event.body || "{}",
    );
    if (!fsc)
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "fsc required" }),
      };

    const startYear = new Date().getFullYear() - (years_back || 2);
    const startDate = startYear + "-01-01";
    const endDate = new Date().toISOString().split("T")[0];

    const payload = {
      filters: {
        award_type_codes: ["A", "B", "C", "D"],
        agencies: [
          { type: "awarding", tier: "toptier", name: "Department of Defense" },
        ],
        psc_codes: { require: [[fsc]] },
        award_amounts: [
          {
            lower_bound: min_amount || 10000,
            upper_bound: max_amount || 500000,
          },
        ],
        time_period: [{ start_date: startDate, end_date: endDate }],
      },
      fields: [
        "Award ID",
        "Recipient Name",
        "recipient_uei",
        "Award Amount",
        "PSC Code",
        "Awarding Sub Agency",
        "Period of Performance Start Date",
        "recipient_location_state_code",
        "business_types_description",
      ],
      sort: "Period of Performance Start Date",
      order: "desc",
      limit: 100,
      page: 1,
    };

    const res = await fetch(
      "https://api.usaspending.gov/api/v2/search/spending_by_award/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    if (!res.ok) {
      const txt = await res.text();
      return { statusCode: res.status, body: JSON.stringify({ error: txt }) };
    }

    const data = await res.json();

    // Aggregate by recipient
    const byRecipient = {};
    for (const award of data.results || []) {
      const name = (award["Recipient Name"] || "UNKNOWN").toUpperCase();
      const uei = award["recipient_uei"] || "";
      const amt = parseFloat(award["Award Amount"]) || 0;
      const date = award["Period of Performance Start Date"] || "";
      const state = award["recipient_location_state_code"] || "";
      const bizType = award["business_types_description"] || "";

      if (!byRecipient[name]) {
        byRecipient[name] = {
          name,
          uei,
          state,
          bizType,
          count: 0,
          total: 0,
          lastDate: date,
          awards: [],
        };
      }
      byRecipient[name].count++;
      byRecipient[name].total += amt;
      if (date > byRecipient[name].lastDate) byRecipient[name].lastDate = date;
      byRecipient[name].awards.push(amt);
    }

    // Sort by count desc, then total desc
    const ranked = Object.values(byRecipient)
      .map((r) => ({ ...r, avg: Math.round(r.total / r.count) }))
      .sort((a, b) => b.count - a.count || b.total - a.total);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fsc,
        ranked,
        total_awards: data.results?.length || 0,
        page_meta: data.page_metadata,
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
