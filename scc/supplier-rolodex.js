// ═══════════════════════════════════════════════════════════════════════
//  IMPERIO SCC — SUPPLIER ROLODEX TAB
//  Persistent checklist for HIGH-DOLLAR and COMMODITY supplier tracking.
//  Storage: localStorage keyed by supplier id.
//  No server dependency. Loads instantly, saves on every change.
// ═══════════════════════════════════════════════════════════════════════

(function () {
  const { createElement: h, useState, useEffect, useCallback, useRef } = React;

  // ── DATA ───────────────────────────────────────────────────────────────
  const HD_DATA = [{"id":"generac-power-systems","block":"GENERATORS / POWER BLOCK","fscs":"6110, 6115, 6120","company":"Generac Power Systems","type":"Manufacturer","best_use":"Reseller Target","difficulty":"Medium","website":"https://www.generac.com","phone":"(888) 436-3722","email":"","notes":"Industrial/commercial generator OEM. Strong DLA history in 6115. Ask for government/defense sales. Dealer program exists — push for authorized reseller agreement.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"cummins-power-generation","block":"GENERATORS / POWER BLOCK","fscs":"6110, 6115, 6120","company":"Cummins Power Generation","type":"Manufacturer","best_use":"Reseller Target","difficulty":"Hard","website":"https://www.cummins.com","phone":"(800) 343-7357","email":"","notes":"Major diesel generator OEM. Heavy DLA presence. Large company — route to government channel or find regional distributor with DLA history.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"kohler-power-systems","block":"GENERATORS / POWER BLOCK","fscs":"6110, 6115, 6120","company":"Kohler Power Systems","type":"Manufacturer","best_use":"Reseller Target","difficulty":"Medium","website":"https://www.kohlerpower.com","phone":"(800) 544-2444","email":"","notes":"Generator OEM. Dealer/distributor program active. Smaller gov sales team = more accessible than Cummins.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"eaton-corporation","block":"GENERATORS / POWER BLOCK","fscs":"6110, 6115, 6120","company":"Eaton Corporation","type":"Manufacturer","best_use":"Awareness","difficulty":"Hard","website":"https://www.eaton.com","phone":"(800) 386-1911","email":"","notes":"Power mgmt/UPS OEM. Very large — hard reseller path. Better as sourcing contact for specific NSN quotes.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"wesco-international","block":"GENERATORS / POWER BLOCK","fscs":"6110, 6115, 6120","company":"Wesco International","type":"Distributor","best_use":"Sourcing","difficulty":"Medium","website":"https://www.wesco.com","phone":"(866) 746-3519","email":"","notes":"Major electrical/power distributor. Government channel active. Good backup source on generator parts.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"graybar-electric","block":"GENERATORS / POWER BLOCK","fscs":"6110, 6115, 6120","company":"Graybar Electric","type":"Distributor","best_use":"Sourcing","difficulty":"Medium","website":"https://www.graybar.com","phone":"(800) 472-9227","email":"","notes":"Gov-aware electrical distributor. Route through local branch for better pricing on power equipment.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"trane-technologies","block":"HVAC / REFRIGERATION BLOCK","fscs":"4110, 4120, 4130","company":"Trane Technologies","type":"Manufacturer","best_use":"Reseller Target","difficulty":"Hard","website":"https://www.trane.com","phone":"(800) 945-5884","email":"","notes":"HVAC OEM. Major DLA presence in 4120. Large company — find regional dealer/contractor who has DLA awards in this FSC. Dealer network is the path.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"carrier-global","block":"HVAC / REFRIGERATION BLOCK","fscs":"4110, 4120, 4130","company":"Carrier Global","type":"Manufacturer","best_use":"Reseller Target","difficulty":"Hard","website":"https://www.carrier.com","phone":"(800) 227-7437","email":"","notes":"HVAC OEM. Government contracts active. Route to commercial/government sales division.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"daikin-applied","block":"HVAC / REFRIGERATION BLOCK","fscs":"4110, 4120, 4130","company":"Daikin Applied","type":"Manufacturer","best_use":"Reseller Target","difficulty":"Medium","website":"https://www.daikinapplied.com","phone":"(855) 324-5461","email":"","notes":"Commercial HVAC OEM. Less saturated than Trane/Carrier on DLA. More accessible for dealer agreement.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"johnson-controls--york","block":"HVAC / REFRIGERATION BLOCK","fscs":"4110, 4120, 4130","company":"Johnson Controls (York)","type":"Manufacturer","best_use":"Awareness","difficulty":"Hard","website":"https://www.johnsoncontrols.com","phone":"(866) 621-9675","email":"","notes":"Building systems/HVAC OEM. DLA active. Large company — awareness only unless you find a local dealer with gov history.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"watsco-inc","block":"HVAC / REFRIGERATION BLOCK","fscs":"4110, 4120, 4130","company":"Watsco Inc.","type":"Distributor","best_use":"Sourcing","difficulty":"Medium","website":"https://www.watsco.com","phone":"(305) 714-4100","email":"","notes":"Largest HVAC distributor in US. Multiple brands (Carrier, Trane, York). Call for HVAC parts sourcing.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"johnstone-supply","block":"HVAC / REFRIGERATION BLOCK","fscs":"4110, 4120, 4130","company":"Johnstone Supply","type":"Distributor","best_use":"Sourcing","difficulty":"Easy","website":"https://www.johnstonesupply.com","phone":"(503) 517-6000","email":"","notes":"HVAC parts distributor. Branch network. Good for HVAC component sourcing on DLA bids.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"parker-hannifin","block":"PUMPS / COMPRESSORS BLOCK","fscs":"4320, 4330","company":"Parker Hannifin","type":"Manufacturer","best_use":"Reseller Target","difficulty":"Hard","website":"https://www.parker.com","phone":"(800) 272-7537","email":"","notes":"Fluid systems/filtration OEM. Massive DLA history. Find regional distributor — Parker has authorized distributor network. That's the entry point.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"flowserve-corporation","block":"PUMPS / COMPRESSORS BLOCK","fscs":"4320, 4330","company":"Flowserve Corporation","type":"Manufacturer","best_use":"Reseller Target","difficulty":"Hard","website":"https://www.flowserve.com","phone":"(972) 443-6500","email":"","notes":"Pump/valve OEM. Defense and gov contracts active. Based in Irving TX — Dallas area, accessible.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"grundfos","block":"PUMPS / COMPRESSORS BLOCK","fscs":"4320, 4330","company":"Grundfos","type":"Manufacturer","best_use":"Reseller Target","difficulty":"Medium","website":"https://www.grundfos.com","phone":"(800) 879-0182","email":"","notes":"Pump OEM. Less defense-saturated than Parker/Flowserve. More accessible for reseller conversation.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"itt---goulds-pumps","block":"PUMPS / COMPRESSORS BLOCK","fscs":"4320, 4330","company":"ITT / Goulds Pumps","type":"Manufacturer","best_use":"Awareness","difficulty":"Hard","website":"https://www.itt.com","phone":"(315) 568-2811","email":"","notes":"Pump OEM with defense lineage. ITT has DLA history. Large company — awareness/sourcing contact.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"dxp-enterprises","block":"PUMPS / COMPRESSORS BLOCK","fscs":"4320, 4330","company":"DXP Enterprises","type":"Distributor","best_use":"Sourcing","difficulty":"Medium","website":"https://www.dxpe.com","phone":"(713) 996-4700","email":"","notes":"TEXAS — Houston HQ. Pumps, bearings, rotating equipment. Good sourcing contact for 4320/4330.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"motion-industries","block":"PUMPS / COMPRESSORS BLOCK","fscs":"4320, 4330","company":"Motion Industries","type":"Distributor","best_use":"Sourcing","difficulty":"Medium","website":"https://www.motion.com","phone":"(800) 526-9328","email":"","notes":"Branch relationships matter. Good for pump/compressor component sourcing.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"oshkosh-defense","block":"VEHICLE COMPONENTS BLOCK","fscs":"2510, 2520, 2530, 2540","company":"Oshkosh Defense","type":"Manufacturer","best_use":"Reseller Target","difficulty":"Hard","website":"https://www.oshkoshdefense.com","phone":"(920) 235-9151","email":"partssales@defense.oshkoshcorp.com","notes":"CAGE 75Q65. Bids DLA direct on unrestricted. Works through small biz dealers on set-aside awards. Contact: Jennifer Wettstein, Aftermarket Sales Admin.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"am-general","block":"VEHICLE COMPONENTS BLOCK","fscs":"2510, 2520, 2530, 2540","company":"AM General","type":"Manufacturer","best_use":"Reseller Target","difficulty":"Hard","website":"https://www.amgeneral.com","phone":"(574) 237-6171","email":"","notes":"HMMWV/military vehicle OEM. Parts active on DLA. Ask for aftermarket parts / dealer program.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"dana-incorporated","block":"VEHICLE COMPONENTS BLOCK","fscs":"2510, 2520, 2530, 2540","company":"Dana Incorporated","type":"Manufacturer","best_use":"Reseller Target","difficulty":"Hard","website":"https://www.dana.com","phone":"(419) 887-3000","email":"","notes":"Drivetrain/axle OEM. Defense history. Route to government/industrial sales.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"meritor--cummins","block":"VEHICLE COMPONENTS BLOCK","fscs":"2510, 2520, 2530, 2540","company":"Meritor (Cummins)","type":"Manufacturer","best_use":"Awareness","difficulty":"Hard","website":"https://www.meritor.com","phone":"(248) 435-1000","email":"","notes":"Truck/defense drivetrain OEM. Acquired by Cummins. DLA active. Large — awareness.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"fleetpride","block":"VEHICLE COMPONENTS BLOCK","fscs":"2510, 2520, 2530, 2540","company":"FleetPride","type":"Distributor","best_use":"Sourcing","difficulty":"Easy","website":"https://www.fleetpride.com","phone":"(800) 967-6206","email":"","notes":"Heavy truck parts distributor. National network. Good sourcing backup for vehicle component bids.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"truckpro","block":"VEHICLE COMPONENTS BLOCK","fscs":"2510, 2520, 2530, 2540","company":"TruckPro","type":"Distributor","best_use":"Sourcing","difficulty":"Easy","website":"https://www.truckpro.com","phone":"(901) 774-2100","email":"","notes":"Heavy truck parts. Broad catalog. Secondary sourcing option.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"keysight-technologies","block":"TEST / MEASUREMENT BLOCK","fscs":"6625, 6630, 6640","company":"Keysight Technologies","type":"Manufacturer","best_use":"Reseller Target","difficulty":"Medium","website":"https://www.keysight.com","phone":"(800) 829-4444","email":"","notes":"T&M OEM. Strong DLA history. Authorized reseller/VAR program exists — this is the path. Ask for channel/partner program.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"fluke-corporation","block":"TEST / MEASUREMENT BLOCK","fscs":"6625, 6630, 6640","company":"Fluke Corporation","type":"Manufacturer","best_use":"Reseller Target","difficulty":"Medium","website":"https://www.fluke.com","phone":"(800) 443-5853","email":"","notes":"T&M OEM. Government distributor network active. More accessible than Keysight. Good reseller target.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"tektronix","block":"TEST / MEASUREMENT BLOCK","fscs":"6625, 6630, 6640","company":"Tektronix","type":"Manufacturer","best_use":"Reseller Target","difficulty":"Medium","website":"https://www.tek.com","phone":"(800) 833-9200","email":"","notes":"Oscilloscopes/T&M OEM. DLA active. Part of Fortive Corp. Distributor program exists.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"rohde---schwarz","block":"TEST / MEASUREMENT BLOCK","fscs":"6625, 6630, 6640","company":"Rohde & Schwarz","type":"Manufacturer","best_use":"Awareness","difficulty":"Hard","website":"https://www.rohde-schwarz.com","phone":"(888) 837-8772","email":"","notes":"Defense T&M OEM. German company. Heavy DLA presence but hard reseller path — awareness only.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"digi-key-electronics","block":"TEST / MEASUREMENT BLOCK","fscs":"6625, 6630, 6640","company":"Digi-Key Electronics","type":"Distributor","best_use":"Sourcing","difficulty":"Easy","website":"https://www.digikey.com","phone":"(800) 344-4539","email":"","notes":"Electronics distributor. Fast ship. Good for T&M components and instruments.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"newark-electronics","block":"TEST / MEASUREMENT BLOCK","fscs":"6625, 6630, 6640","company":"Newark Electronics","type":"Distributor","best_use":"Sourcing","difficulty":"Medium","website":"https://www.newark.com","phone":"(800) 463-9275","email":"","notes":"Electronics distributor. DLA-aware. Good secondary sourcing for T&M components.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"l3harris-technologies","block":"COMMUNICATIONS BLOCK","fscs":"5895, 5820, 5830","company":"L3Harris Technologies","type":"Manufacturer","best_use":"Awareness","difficulty":"Hard","website":"https://www.l3harris.com","phone":"(844) 547-4284","email":"","notes":"Defense comms OEM. Major DLA presence. No realistic reseller path — awareness only. Note when you see their parts on a sol.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"motorola-solutions","block":"COMMUNICATIONS BLOCK","fscs":"5895, 5820, 5830","company":"Motorola Solutions","type":"Manufacturer","best_use":"Reseller Target","difficulty":"Hard","website":"https://www.motorolasolutions.com","phone":"(800) 367-2346","email":"","notes":"Comms OEM. Authorized dealer/channel partner program exists. Push for dealer agreement — this is the path.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"thales-defense","block":"COMMUNICATIONS BLOCK","fscs":"5895, 5820, 5830","company":"Thales Defense","type":"Manufacturer","best_use":"Awareness","difficulty":"Hard","website":"https://www.thalesgroup.com","phone":"(703) 838-9685","email":"","notes":"Defense comms OEM. French company. Hard reseller path — awareness only.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"phoenix-products-llc","block":"LIGHTING BLOCK","fscs":"6230","company":"Phoenix Products LLC","type":"Manufacturer","best_use":"Reseller Target","difficulty":"Low","website":"https://www.phoenixlighting.com","phone":"(414) 426-7589","email":"ppeczerski@phoenixlighting.com","notes":"CAGE 8T493. Military floodlights. Gov sales rep: Patrick Peczerski. Active sol in pipeline. Emailed 6 Apr. Very accessible.","contacted":"Emailed 6 Apr","responded":"","partnered":"","my_notes":""},{"id":"skf-usa","block":"BEARINGS / POWER TRANS BLOCK","fscs":"3030, 3110, 5330","company":"SKF USA","type":"Manufacturer","best_use":"Reseller Target","difficulty":"Medium","website":"https://www.skf.com","phone":"(800) 440-3322","email":"","notes":"Bearing OEM. Strong DLA history. Authorized distributor program — route through local authorized dist for pricing, then pursue direct reseller agreement.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"timken-company","block":"BEARINGS / POWER TRANS BLOCK","fscs":"3030, 3110, 5330","company":"Timken Company","type":"Manufacturer","best_use":"Reseller Target","difficulty":"Medium","website":"https://www.timken.com","phone":"(877) 899-6481","email":"","notes":"Bearing/power transmission OEM. DLA active. Distributor network — find regional contact.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"gates-industrial","block":"BEARINGS / POWER TRANS BLOCK","fscs":"3030, 3110, 5330","company":"Gates Industrial","type":"Manufacturer","best_use":"Reseller Target","difficulty":"Medium","website":"https://www.gates.com","phone":"(303) 744-1911","email":"","notes":"Belt OEM. KEY for vehicle belt crosses (Ford, etc). Route to industrial/government sales. Getting wholesale pricing here solves the belt margin problem.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"applied-industrial-technologies","block":"BEARINGS / POWER TRANS BLOCK","fscs":"3030, 3110, 5330","company":"Applied Industrial Technologies","type":"Distributor","best_use":"Sourcing","difficulty":"Medium","website":"https://www.applied.com","phone":"(877) 279-2799","email":"","notes":"Branch-based. Good for bearing/power transmission sourcing. Call local branch for account.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"kaman-industrial-technologies","block":"BEARINGS / POWER TRANS BLOCK","fscs":"3030, 3110, 5330","company":"Kaman Industrial Technologies","type":"Distributor","best_use":"Sourcing","difficulty":"Medium","website":"https://ec.kamandirect.com","phone":"Branch-based","email":"","notes":"Branch-driven distributor. Overlaps bearing/power trans lane.","contacted":"","responded":"","partnered":"","my_notes":""}];

  const FT_DATA = [{"id":"zoro","block":"GENERAL MRO / HARDWARE","fscs":"5305, 5310, 5120, 5340, 4240","company":"Zoro","type":"Distributor","best_use":"FAST, SB","difficulty":"Medium","website":"https://www.zoro.com","phone":"(855) 289-9676","email":"Contact form","notes":"Broad-catalog. Best for FAST awards. Self-fund only — avg contract too small for FE.","contacted":"Called 6 Apr","responded":"https://www.zoro.com/resellers/","partnered":"","my_notes":"FUCK OFF - 10% ONLY"},{"id":"global-industrial","block":"GENERAL MRO / HARDWARE","fscs":"3920, 4240, 5340","company":"Global Industrial","type":"Distributor","best_use":"FAST, LHF","difficulty":"Easy","website":"https://www.globalindustrial.com","phone":"(844) 671-1547","email":"resale@globalindustrial.com","notes":"Strong reseller lane. Broad warehouse/MRO/PPE overlap. Self-fund only.","contacted":"Called 9 Apr","responded":"Need Tax Exempt & Resale Cert","partnered":"","my_notes":""},{"id":"fastenal","block":"GENERAL MRO / HARDWARE","fscs":"5305-5340, 4730, 4240, 7930","company":"Fastenal","type":"Distributor","best_use":"FAST, SB, LHF","difficulty":"Medium","website":"https://fastenal.com","phone":"(800) FASTENAL","email":"txgovsales@fastenal.com","notes":"Texas NASPO contract active. Temple TX: 2711 Airport Rd Ste B. Self-fund only on most awards.","contacted":"Emailed 6 Apr | Called 9 Apr","responded":"Filled out form — Waiting","partnered":"","my_notes":""},{"id":"lawson-products","block":"GENERAL MRO / HARDWARE","fscs":"5305-5340, 5110, 5120, 6150, 4240","company":"Lawson Products","type":"Distributor","best_use":"SB, LHF","difficulty":"Low","website":"https://lawsonproducts.com","phone":"(773) 304-5438","email":"Lisa.Castanon@lawsonproducts.com","notes":"NASPO ValuePoint active. Less saturated than Fastenal. Self-fund only.","contacted":"Emailed 6 Apr | Called 9 Apr","responded":"No response","partnered":"","my_notes":""},{"id":"dxp-enterprises-mro","block":"GENERAL MRO / HARDWARE","fscs":"5305-5340, 4730, 4820, 6150","company":"DXP Enterprises","type":"Distributor","best_use":"SB, High-Margin","difficulty":"Medium","website":"https://dxpe.com","phone":"(713) 996-4700","email":"Contact via dxpe.com","notes":"TEXAS — Houston HQ. Also on HIGH-DOLLAR list for pumps.","contacted":"Called 9 Apr","responded":"Round Rock Branch dxproundrock_tx@dxpe.com","partnered":"","my_notes":"says email quote"},{"id":"kd-fasteners-inc","block":"FASTENER SPECIALISTS","fscs":"5305, 5310, 5315, 5320","company":"KD Fasteners Inc","type":"Distributor","best_use":"SB, High-Margin","difficulty":"Low","website":"https://kdfasteners.com","phone":"(800) 736-5014","email":"sales@kdfasteners.com","notes":"Military/defense page. 100K+ SKUs. Just send PO for quote.","contacted":"Called 9 Apr","responded":"Just send PO for quote","partnered":"","my_notes":""},{"id":"msc-industrial","block":"FASTENER SPECIALISTS","fscs":"5110, 5120, 5305, 5340","company":"MSC Industrial","type":"Distributor","best_use":"SB, LHF","difficulty":"Medium","website":"https://mscdirect.com","phone":"(800) 645-7270","email":"publicsector@mscdirect.com","notes":"GSA contract active. DLA approved. 1.9M+ SKUs. Wait 24hrs for reseller pricing.","contacted":"Called 9 Apr","responded":"Wait 24hrs","partnered":"","my_notes":""},{"id":"bisco-industries","block":"FASTENER SPECIALISTS","fscs":"5935, 5305-5320","company":"Bisco Industries","type":"Distributor","best_use":"SB, High-Margin","difficulty":"Medium","website":"https://biscoind.com","phone":"(800) 327-2658","email":"sales@biscoind.com","notes":"Aerospace + defense. Electronic components + fasteners. Not overplayed in DIBBS.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"pacific-coast-bolt","block":"FASTENER SPECIALISTS","fscs":"5305, 5306, 5310, 5315","company":"Pacific Coast Bolt","type":"Distributor","best_use":"SB, High-Margin","difficulty":"Low","website":"https://pacificcoastbolt.com","phone":"Pull from site","email":"jsantamaria@pacificcoastbolt.com","notes":"9 employees, $7.1M. Family-owned SB. Sales Mgr: Joe Santa Maria. Very accessible.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"cal-fasteners-inc","block":"FASTENER SPECIALISTS","fscs":"5305, 5310, 5315, 5320","company":"Cal-Fasteners Inc","type":"Distributor","best_use":"SB, High-Margin","difficulty":"Low","website":"https://cfi1.com","phone":"(714) 854-1715","email":"sales@cfi1.com","notes":"Aerospace + mil-spec. Same-day shipping. Small ops = easy relationship.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"all-pro-fasteners","block":"FASTENER SPECIALISTS","fscs":"5305-5340","company":"All-Pro Fasteners","type":"Manufacturer/Dist","best_use":"SB, LHF, High-Margin","difficulty":"Low","website":"https://apf.com","phone":"(254) 772-6017 Waco TX","email":"waco@apf.com","notes":"TEXAS — Waco 20min from Killeen. ISO certified, A2LA lab, $136M revenue. Manufacturing + distribution. Reseller email sent.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"brighton-best-international","block":"FASTENER SPECIALISTS","fscs":"5305, 5306, 5307, 5310, 5315, 5325, 5340","company":"Brighton-Best International","type":"Distributor","best_use":"Wholesale only — gov reseller","difficulty":"Low","website":"https://brightonbest.com","phone":"(714) 228-9888","email":"info@brightonbest.com","notes":"Distributors only. Broadest FSC coverage in fastener lane. Pending vet.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"earnest-machine","block":"FASTENER SPECIALISTS","fscs":"5306, 5307, 5310, 5340","company":"Earnest Machine","type":"Distributor","best_use":"Large diameter / structural","difficulty":"Low","website":"https://earnestmachine.com","phone":"(800) 327-6378","email":"inquiry@earnestmachine.com","notes":"Master distributor. Large diameter/specialty industrial. Pending vet.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"midwest-fasteners-inc","block":"FASTENER SPECIALISTS","fscs":"5305, 5310, 5315, 5340","company":"Midwest Fasteners Inc. (Ohio)","type":"Distributor","best_use":"Commodity hardware","difficulty":"Low","website":"https://midwestfasteners.com","phone":"(800) 852-8352","email":"sales@midwestfasteners.com","notes":"Miamisburg OH. Weld studs, insulation fasteners, MRO. B2B only. Pending vet.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"nucor-fastener","block":"FASTENER SPECIALISTS","fscs":"5305, 5306, 5307","company":"Nucor Fastener","type":"Manufacturer","best_use":"DFARS-clean domestic hex caps","difficulty":"Low","website":"https://nucor-fastener.com","phone":"(800) 955-6826","email":"","notes":"St. Joe IN. Domestic mfr. Grade 5/8 hex caps. DFARS-safe. Pending vet.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"fastener-solutions","block":"FASTENER SPECIALISTS","fscs":"5305, 5306, 5310, 5340","company":"Fastener Solutions","type":"Distributor","best_use":"Bulk commodity","difficulty":"Low","website":"https://fastenersolutions.com","phone":"","email":"","notes":"Bulk hardware distributor. Pending vet.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"uc-components","block":"FASTENER SPECIALISTS","fscs":"5305, 5310, 5325","company":"UC Components","type":"Manufacturer","best_use":"Spec only — UHV/cleanroom","difficulty":"Medium","website":"https://uccomponents.com","phone":"(408) 782-1929","email":"sales@uccomponents.com","notes":"Morgan Hill CA. Precision/vented fasteners. NSN-specific only. Pending vet.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"rotor-clip","block":"FASTENER SPECIALISTS","fscs":"5325, 5330","company":"Rotor Clip","type":"Manufacturer","best_use":"Spec only — retaining rings","difficulty":"Low","website":"https://rotorclip.com","phone":"(732) 469-7333","email":"info@rotorclip.com","notes":"Somerset NJ / Fort Worth TX hub. Only mfr of every retaining ring style. AS9100D. Pending vet.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"national-bolt-nut-corp","block":"SMALL MANUFACTURERS","fscs":"5305-5320","company":"National Bolt & Nut Corp","type":"Manufacturer","best_use":"High-Margin","difficulty":"Low","website":"https://nationalbolt.com","phone":"(630) 307-8800","email":"info@nationalbolt.com","notes":"ISO 9001:2015. Custom large-diameter fasteners. 24hr emergency service. Reseller email sent.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"houston-precision-fasteners","block":"SMALL MANUFACTURERS","fscs":"5305-5320","company":"Houston Precision Fasteners","type":"Manufacturer","best_use":"High-Margin","difficulty":"Low","website":"https://hpfasteners.com","phone":"(713) 614-3889","email":"mhahn@houstonprecisionfasteners.com","notes":"CAGE 1VSL7. 500 NSNs on DLA. 31 employees. Boeing/Lockheed approved. Contact: Mark Hahn (owner). Reseller email sent 6 Apr.","contacted":"Emailed 6 Apr","responded":"","partnered":"","my_notes":""},{"id":"m-squared-innovations","block":"SMALL MANUFACTURERS","fscs":"7920, 6840, 6850, 7930","company":"M-Squared Innovations","type":"Manufacturer","best_use":"High-Margin, SB","difficulty":"Low","website":"https://msqrinnovations.com","phone":"(855) 501-2049","email":"support@msqrinnovations.com","notes":"TEXAS — Mansfield TX. ISO 9001:2015. DLA Aviation managed. bz® cloths. NEW to DIBBS. Contact: Mary Mallory COO. Reseller email sent 6 Apr.","contacted":"Emailed 6 Apr","responded":"","partnered":"","my_notes":"FUCK M-SQUARED INNOVATIONS"},{"id":"kimball-midwest","block":"SMALL MANUFACTURERS","fscs":"5305, 5310, 5340","company":"Kimball Midwest","type":"Manufacturer Rep","best_use":"SB, LHF","difficulty":"Low","website":"https://kimballmidwest.com","phone":"(833) 660-0204","email":"mvera@kimballmidwest.com","notes":"NOT a traditional distributor. Gov sales page. Dallas TX DC. Contact: Maria Vera, Div Gov Sales Exec. Reseller email sent.","contacted":"NOT a Distributor","responded":"","partnered":"","my_notes":""},{"id":"pk-safety","block":"SAFETY / PPE","fscs":"4240","company":"PK Safety","type":"Distributor","best_use":"LHF, High-Margin","difficulty":"Easy","website":"https://pksafety.com","phone":"(800) 829-9580","email":"Contact form","notes":"Smaller safety supplier. Easier relationship than national catalogs.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"galeton-dival-safety","block":"SAFETY / PPE","fscs":"4240","company":"Galeton / DiVal Safety","type":"Distributor","best_use":"FAST, LHF","difficulty":"Easy","website":"https://www.galeton.com","phone":"(800) 343-1354","email":"info@divalsafety.com","notes":"Galeton rolling into DiVal Safety. Keep both names.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"platt-electric-supply","block":"ELECTRICAL / WIRE","fscs":"5975, 6145","company":"Platt Electric Supply","type":"Distributor","best_use":"LHF, SB","difficulty":"Easy","website":"https://www.platt.com","phone":"Local branch","email":"Contact/locations page","notes":"Regional relationship play. Good for electrical/industrial crossover.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"border-states-electric","block":"ELECTRICAL / WIRE","fscs":"5975, 6145","company":"Border States Electric","type":"Distributor","best_use":"High-Margin","difficulty":"Medium","website":"https://www.borderstates.com","phone":"(800) 800-0199","email":"support@borderstates.com","notes":"Relationship-driven. Electrical/utility/industrial overlap.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"graybar-electric-wire","block":"ELECTRICAL / WIRE","fscs":"5975, 6145, 5945","company":"Graybar Electric","type":"Distributor","best_use":"SB","difficulty":"Medium","website":"https://www.graybar.com","phone":"1-800-GRAYBAR","email":"graybarsupport@graybar.com","notes":"Gov-aware. Stronger routed through local branch.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"cole-parmer","block":"LAB / SCIENTIFIC","fscs":"6640, 6630","company":"Cole-Parmer","type":"Distributor","best_use":"High-Margin, LHF","difficulty":"Easy","website":"https://www.coleparmer.com","phone":"(800) 323-4340","email":"sales@coleparmer.com","notes":"Strong niche for lab/scientific items buyers ignore.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"vwr-avantor","block":"LAB / SCIENTIFIC","fscs":"6640, 6630, 6550","company":"VWR / Avantor","type":"Distributor","best_use":"SB","difficulty":"Hard","website":"https://www.vwr.com","phone":"(888) 897-5463","email":"technicalproductsupportNA@vwr.com","notes":"Very broad lab catalog. Harder on responsiveness/pricing.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"medline-industries","block":"LAB / SCIENTIFIC","fscs":"6515, 6530","company":"Medline Industries","type":"Distributor","best_use":"FAST, SB","difficulty":"Medium","website":"https://www.medline.com","phone":"(800) 633-5463","email":"customerservice@medline.com","notes":"Good for recurring medical/healthcare items.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"motion-industries-bearings","block":"MECHANICAL / BEARINGS","fscs":"3030, 3110, 5330","company":"Motion Industries","type":"Distributor","best_use":"LHF, High-Margin","difficulty":"Medium","website":"https://www.motion.com","phone":"(800) 526-9328","email":"Local branch","notes":"Branch relationships matter. Good for mechanical MRO.","contacted":"He took my number for sales guy","responded":"","partnered":"","my_notes":""},{"id":"wix-filters","block":"ENGINE / FILTERS","fscs":"2910, 2940","company":"WIX Filters","type":"Manufacturer","best_use":"Filters — fuel, oil, air, coolant","difficulty":"Low","website":"https://wixfilters.com","phone":"(704) 864-6748","email":"Contact form — wixfilters.com","notes":"Gastonia NC. DLA-recognized. Broad cross-reference to mil-spec filter NSNs. Call sales line for reseller pricing.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"donaldson-company","block":"ENGINE / FILTERS","fscs":"2910, 2940","company":"Donaldson Company","type":"Manufacturer","best_use":"Filters — engine air, oil, liquid","difficulty":"Medium","website":"https://donaldson.com","phone":"(800) 374-1374","email":"","notes":"Global filtration leader. Engine aftermarket filters. Strong DLA history on 2940 NSNs. Distributor/reseller program available.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"fleetguard-cummins","block":"ENGINE / FILTERS","fscs":"2910, 2940","company":"Fleetguard / Cummins Filtration","type":"Manufacturer","best_use":"Filters — diesel, fuel, coolant","difficulty":"Medium","website":"https://fleetguard.com","phone":"(800) 22-FLEET","email":"","notes":"Cummins brand. Heavy mil-vehicle filter coverage. Appears in DIBBS 2940 supplier lists. Distributor program — call Cummins aftermarket.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"associated-spring","block":"SPRINGS / RINGS","fscs":"5360, 5365","company":"Associated Spring (Barnes Group)","type":"Manufacturer","best_use":"Spec springs, washers, rings","difficulty":"Medium","website":"https://asbg.com","phone":"(800) 528-3795","email":"AssociatedSpring@asbg.com","notes":"Since 1857. Aerospace & defense springs, Belleville washers, wave springs. Strong DIBBS presence on FSC 5360. Reseller program available.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"msc-springs-rings","block":"SPRINGS / RINGS","fscs":"5360, 5365","company":"MSC Industrial (Springs/Rings)","type":"Distributor","best_use":"Broad spring & ring catalog","difficulty":"Low","website":"https://mscdirect.com","phone":"(800) 645-7270","email":"publicsector@mscdirect.com","notes":"Already on list for fasteners. ResaleLink program covers springs and retaining rings. Cross-reference from same contact.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"castrol-bp-lubricants","block":"LUBRICANTS / OILS","fscs":"9150","company":"Castrol / BP Lubricants","type":"Manufacturer","best_use":"Oils, greases, lubricants","difficulty":"Medium","website":"https://castrol.com/en_us","phone":"(800) 462-0835","email":"","notes":"Authorized distributor program. Broad FSC 9150 coverage — motor oils, greases, hydraulic fluids. Find local TX distributor via their locator.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"petroleum-solutions-inc","block":"LUBRICANTS / OILS","fscs":"9150","company":"Petroleum Solutions Inc.","type":"Distributor","best_use":"Bulk lubricants, MIL-spec oils","difficulty":"Low","website":"https://petroleumsolutionsinc.com","phone":"Pull from site","email":"","notes":"Specialty gov lubricant distributor. MIL-PRF-spec oils. Worth a call for FSC 9150 DIBBS NSNs.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"triple-s-steel","block":"METALS / STEEL","fscs":"9510, 9520, 9535","company":"Triple-S Steel (Texas)","type":"Distributor","best_use":"Steel bar, plate, sheet, structural","difficulty":"Low","website":"https://sss-steel.com","phone":"(800) 231-1034","email":"anthony.palazzo@sss-steel.com","notes":"TEXAS — Houston HQ. 600K+ tons/yr. Structural, carbon, stainless. Closest major service center to Killeen. Call for reseller/gov pricing.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"metals-depot","block":"METALS / STEEL","fscs":"9510, 9520, 9535","company":"Metals Depot","type":"Distributor","best_use":"Steel, aluminum, stainless — cut to size","difficulty":"Low","website":"https://metalsdepot.com","phone":"(800) 870-6808","email":"","notes":"Winchester KY. Ships nationwide. Online pricing visible. Good for smaller quantity NSNs on 9510/9535.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"uline","block":"PACKAGING","fscs":"8115","company":"Uline","type":"Distributor","best_use":"Boxes, cartons, crates, packaging","difficulty":"Low","website":"https://uline.com","phone":"(800) 295-5510","email":"customer.service@uline.com","notes":"Coppell TX location (near Dallas). 45K+ SKUs. Same-day ship. No reseller program — use as direct source.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"global-industrial-shop","block":"SHOP / MAINTENANCE EQUIP","fscs":"4910, 4940","company":"Global Industrial (Shop Equip)","type":"Distributor","best_use":"Shop tools, maintenance equipment","difficulty":"Low","website":"https://globalindustrial.com","phone":"(844) 671-1547","email":"resale@globalindustrial.com","notes":"Formal reseller program. Covers 4910/4940 maintenance and shop equipment. Same contact as MRO entry — ask reseller team to expand access.","contacted":"","responded":"","partnered":"","my_notes":""},{"id":"snap-on-industrial","block":"SHOP / MAINTENANCE EQUIP","fscs":"4910, 4940","company":"Snap-on Industrial","type":"Manufacturer","best_use":"Specialty shop/maintenance tools","difficulty":"High","website":"https://snapon.com/industrial","phone":"(877) 762-7664","email":"","notes":"High-difficulty but shows up on DIBBS 4910 NSNs as approved source. Industrial division only — not retail.","contacted":"","responded":"","partnered":"","my_notes":""}];

  const LS_KEY = 'scc-rolodex-v1';

  // ── STORAGE HELPERS ────────────────────────────────────────────────────
  function loadState() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
  }
  function saveState(s) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch {}
  }

  // ── DIFFICULTY COLORS ─────────────────────────────────────────────────
  function diffColor(d) {
    const m = { Low: '#3dd68c', Easy: '#3dd68c', Medium: '#C9A84C', Hard: '#e87474', High: '#e87474' };
    return m[d] || 'var(--body-dim)';
  }

  // ── STATUS PILL ────────────────────────────────────────────────────────
  function StatusPill({ label, active, color, onClick }) {
    return h('button', {
      onClick,
      style: {
        padding: '2px 8px', borderRadius: '3px', fontSize: '10px', fontWeight: 600,
        letterSpacing: '.04em', cursor: 'pointer', border: '1px solid',
        borderColor: active ? color : 'rgba(255,255,255,.12)',
        background: active ? color + '22' : 'transparent',
        color: active ? color : 'var(--body-dim)',
        transition: 'all .15s',
      }
    }, label);
  }

  // ── SINGLE ROW ─────────────────────────────────────────────────────────
  function SupplierRow({ s, state, onUpdate }) {
    const [expanded, setExpanded] = useState(false);
    const [notesVal, setNotesVal] = useState(state.my_notes || s.my_notes || '');
    const [contactedVal, setContactedVal] = useState(state.contacted || s.contacted || '');
    const [respondedVal, setRespondedVal] = useState(state.responded || s.responded || '');
    const notesTimer = useRef(null);
    const contactedTimer = useRef(null);
    const respondedTimer = useRef(null);

    const partnered = !!(state.partnered ?? (s.partnered ? true : false));

    const isDead = notesVal && (notesVal.toUpperCase().startsWith('FUCK') || notesVal === 'N/A' || notesVal === 'DEAD');

    function toggle(field) {
      onUpdate(s.id, { [field]: !state[field] });
    }

    function debounced(timer, field, val) {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => onUpdate(s.id, { [field]: val }), 500);
    }

    return h('div', {
      style: {
        borderBottom: '1px solid rgba(255,255,255,.05)',
        opacity: isDead ? 0.4 : 1,
        transition: 'opacity .2s',
      }
    },
      // ── COLLAPSED ROW ──
      h('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: '1fr 80px 70px 90px 90px 80px 36px',
          gap: '8px', alignItems: 'center',
          padding: '7px 10px', cursor: 'pointer',
          background: expanded ? 'rgba(201,168,76,.04)' : 'transparent',
        },
        onClick: () => setExpanded(x => !x),
      },
        // Company + type badge
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 } },
          h('span', { style: { color: 'var(--body-bright)', fontSize: '12px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, s.company),
          h('span', {
            style: {
              fontSize: '9px', padding: '1px 5px', borderRadius: '2px', flexShrink: 0,
              background: s.type === 'Manufacturer' || s.type === 'Manufacturer/Dist' ? 'rgba(61,214,140,.12)' : 'rgba(135,206,235,.1)',
              color: s.type === 'Manufacturer' || s.type === 'Manufacturer/Dist' ? '#3dd68c' : '#87ceeb',
              border: '1px solid',
              borderColor: s.type === 'Manufacturer' || s.type === 'Manufacturer/Dist' ? 'rgba(61,214,140,.25)' : 'rgba(135,206,235,.2)',
            }
          }, s.type === 'Manufacturer/Dist' ? 'MFR/DIST' : s.type?.toUpperCase()),
        ),
        // FSCs
        h('span', { style: { fontSize: '10px', color: 'var(--body-dim)', fontFamily: 'monospace' } }, s.fscs),
        // Difficulty
        h('span', { style: { fontSize: '10px', color: diffColor(s.difficulty), fontWeight: 600 } }, s.difficulty),
        // Contacted indicator
        h('span', {
          style: {
            fontSize: '10px', color: contactedVal ? '#3dd68c' : 'var(--body-faint)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }
        }, contactedVal ? '✓ ' + contactedVal : '—'),
        // Responded indicator
        h('span', {
          style: {
            fontSize: '10px', color: respondedVal ? '#C9A84C' : 'var(--body-faint)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }
        }, respondedVal ? '✓ Responded' : '—'),
        // Partnered
        h('span', {
          style: { fontSize: '10px', color: partnered ? '#3dd68c' : 'var(--body-faint)', textAlign: 'center' }
        }, partnered ? '✦' : ''),
        // Chevron
        h('span', { style: { fontSize: '10px', color: 'var(--body-faint)', textAlign: 'center', transform: expanded ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform .15s' } }, '▶'),
      ),

      // ── EXPANDED DETAIL ──
      expanded && h('div', {
        style: {
          padding: '10px 14px 14px', background: 'rgba(0,0,0,.2)',
          borderTop: '1px solid rgba(255,255,255,.04)',
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px',
        }
      },
        // Left: contact info + notes
        h('div', null,
          h('div', { style: { fontSize: '10px', color: 'var(--body-dim)', marginBottom: '6px' } },
            s.website && h('a', { href: s.website, target: '_blank', style: { color: 'var(--accent-blue)', marginRight: '10px' } }, s.website.replace('https://', '')),
            s.phone && h('span', { style: { marginRight: '10px' } }, s.phone),
            s.email && h('a', { href: 'mailto:' + s.email, style: { color: 'var(--gold-dim)' } }, s.email),
          ),
          h('div', { style: { fontSize: '11px', color: 'var(--body-dim)', lineHeight: 1.5, marginBottom: '8px' } }, s.notes),
          h('div', { style: { fontSize: '10px', color: 'var(--body-faint)', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '.06em' } }, 'Best Use'),
          h('div', { style: { fontSize: '11px', color: 'var(--body-bright)', marginBottom: '8px' } }, s.best_use),
        ),
        // Right: status controls
        h('div', null,
          h('div', { style: { fontSize: '10px', color: 'var(--body-faint)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '6px' } }, 'Status'),
          h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' } },
            h(StatusPill, {
              label: 'PARTNERED', active: partnered, color: '#3dd68c',
              onClick: (e) => { e.stopPropagation(); toggle('partnered'); }
            }),
          ),
          h('div', { style: { fontSize: '10px', color: 'var(--body-faint)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '3px' } }, 'Contacted'),
          h('input', {
            value: contactedVal,
            onChange: e => { setContactedVal(e.target.value); debounced(contactedTimer, 'contacted', e.target.value); },
            onClick: e => e.stopPropagation(),
            placeholder: 'Date / method',
            style: {
              width: '100%', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)',
              borderRadius: '3px', padding: '4px 7px', color: 'var(--body-bright)', fontSize: '11px',
              marginBottom: '6px', boxSizing: 'border-box',
            }
          }),
          h('div', { style: { fontSize: '10px', color: 'var(--body-faint)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '3px' } }, 'Responded'),
          h('input', {
            value: respondedVal,
            onChange: e => { setRespondedVal(e.target.value); debounced(respondedTimer, 'responded', e.target.value); },
            onClick: e => e.stopPropagation(),
            placeholder: 'Response / notes',
            style: {
              width: '100%', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)',
              borderRadius: '3px', padding: '4px 7px', color: 'var(--body-bright)', fontSize: '11px',
              marginBottom: '6px', boxSizing: 'border-box',
            }
          }),
          h('div', { style: { fontSize: '10px', color: 'var(--body-faint)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '3px' } }, 'My Notes'),
          h('input', {
            value: notesVal,
            onChange: e => { setNotesVal(e.target.value); debounced(notesTimer, 'my_notes', e.target.value); },
            onClick: e => e.stopPropagation(),
            placeholder: 'Internal notes...',
            style: {
              width: '100%', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)',
              borderRadius: '3px', padding: '4px 7px', color: 'var(--body-bright)', fontSize: '11px',
              boxSizing: 'border-box',
            }
          }),
        ),
      ),
    );
  }

  // ── BLOCK GROUP ────────────────────────────────────────────────────────
  function BlockGroup({ block, rows, state, onUpdate, filter }) {
    const [collapsed, setCollapsed] = useState(false);
    const visible = rows.filter(s => {
      if (filter === 'partnered') return state[s.id]?.partnered;
      if (filter === 'contacted') return state[s.id]?.contacted || s.contacted;
      if (filter === 'pending') return !(state[s.id]?.contacted || s.contacted);
      return true;
    });
    if (!visible.length) return null;
    const partCount = rows.filter(s => state[s.id]?.partnered).length;
    const contactCount = rows.filter(s => state[s.id]?.contacted || s.contacted).length;

    return h('div', { style: { marginBottom: '8px', border: '1px solid rgba(255,255,255,.07)', borderRadius: '5px', overflow: 'hidden' } },
      // Block header
      h('div', {
        onClick: () => setCollapsed(x => !x),
        style: {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 12px', background: 'rgba(201,168,76,.06)', cursor: 'pointer',
          borderBottom: collapsed ? 'none' : '1px solid rgba(255,255,255,.06)',
        }
      },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
          h('span', { style: { fontSize: '11px', fontWeight: 700, color: 'var(--gold-dim)', letterSpacing: '.06em', textTransform: 'uppercase' } }, block),
          h('span', { style: { fontSize: '10px', color: 'var(--body-faint)' } }, rows.length + ' suppliers'),
          contactCount > 0 && h('span', { style: { fontSize: '10px', color: '#3dd68c' } }, contactCount + ' contacted'),
          partCount > 0 && h('span', { style: { fontSize: '10px', color: '#C9A84C' } }, '✦ ' + partCount + ' partnered'),
        ),
        h('span', { style: { fontSize: '10px', color: 'var(--body-faint)', transform: collapsed ? 'rotate(-90deg)' : 'none', display: 'inline-block', transition: 'transform .15s' } }, '▼'),
      ),
      !collapsed && h('div', null,
        // Column headers
        h('div', {
          style: {
            display: 'grid', gridTemplateColumns: '1fr 80px 70px 90px 90px 80px 36px',
            gap: '8px', padding: '4px 10px', background: 'rgba(0,0,0,.15)',
          }
        },
          h('span', { style: { fontSize: '9px', color: 'var(--body-faint)', textTransform: 'uppercase', letterSpacing: '.07em' } }, 'Company'),
          h('span', { style: { fontSize: '9px', color: 'var(--body-faint)', textTransform: 'uppercase', letterSpacing: '.07em' } }, 'FSCs'),
          h('span', { style: { fontSize: '9px', color: 'var(--body-faint)', textTransform: 'uppercase', letterSpacing: '.07em' } }, 'Difficulty'),
          h('span', { style: { fontSize: '9px', color: 'var(--body-faint)', textTransform: 'uppercase', letterSpacing: '.07em' } }, 'Contacted'),
          h('span', { style: { fontSize: '9px', color: 'var(--body-faint)', textTransform: 'uppercase', letterSpacing: '.07em' } }, 'Responded'),
          h('span', { style: { fontSize: '9px', color: 'var(--body-faint)', textTransform: 'uppercase', letterSpacing: '.07em' } }, 'Partner'),
          h('span', null),
        ),
        visible.map(s => h(SupplierRow, { key: s.id, s, state: state[s.id] || {}, onUpdate })),
      ),
    );
  }

  // ── MAIN TAB ───────────────────────────────────────────────────────────
  function SupplierRolodexTab() {
    const [state, setState] = useState(loadState);
    const [sheet, setSheet] = useState('hd'); // 'hd' | 'ft'
    const [filter, setFilter] = useState('all');
    const [search, setSearch] = useState('');

    const data = sheet === 'hd' ? HD_DATA : FT_DATA;

    function onUpdate(id, patch) {
      setState(prev => {
        const next = { ...prev, [id]: { ...(prev[id] || {}), ...patch } };
        saveState(next);
        return next;
      });
    }

    // Group by block
    const blocks = [...new Set(data.map(s => s.block))];

    function filterData(rows) {
      if (!search.trim()) return rows;
      const q = search.toLowerCase();
      return rows.filter(s =>
        s.company.toLowerCase().includes(q) ||
        s.fscs.toLowerCase().includes(q) ||
        s.block.toLowerCase().includes(q) ||
        s.notes.toLowerCase().includes(q)
      );
    }

    // Stats
    const allData = [...HD_DATA, ...FT_DATA];
    const totalContacted = allData.filter(s => state[s.id]?.contacted || s.contacted).length;
    const totalPartnered = allData.filter(s => state[s.id]?.partnered).length;
    const totalResponded = allData.filter(s => state[s.id]?.responded || s.responded).length;

    return h('div', { style: { animation: 'fadeUp .4s ease both' } },

      // ── HEADER BAR ──
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' } },

        h('div', { style: { display: 'flex', gap: '0', border: '1px solid rgba(201,168,76,.25)', borderRadius: '4px', overflow: 'hidden' } },
          ['hd', 'ft'].map((s, i) => h('button', {
            key: s,
            onClick: () => setSheet(s),
            style: {
              padding: '6px 14px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
              background: sheet === s ? 'rgba(201,168,76,.18)' : 'transparent',
              color: sheet === s ? 'var(--gold-solid)' : 'var(--body-dim)',
              border: 'none', borderLeft: i > 0 ? '1px solid rgba(201,168,76,.2)' : 'none',
            }
          }, s === 'hd' ? 'HIGH-DOLLAR TARGETS' : 'COMMODITY — FAST TURN')),
        ),

        h('div', { style: { display: 'flex', gap: '6px' } },
          ['all', 'contacted', 'pending', 'partnered'].map(f => h('button', {
            key: f,
            onClick: () => setFilter(f),
            style: {
              padding: '4px 10px', fontSize: '10px', fontWeight: 600, cursor: 'pointer',
              borderRadius: '3px', border: '1px solid',
              borderColor: filter === f ? 'rgba(201,168,76,.5)' : 'rgba(255,255,255,.1)',
              background: filter === f ? 'rgba(201,168,76,.1)' : 'transparent',
              color: filter === f ? 'var(--gold-dim)' : 'var(--body-dim)',
            }
          }, f.toUpperCase())),
        ),

        h('input', {
          value: search,
          onChange: e => setSearch(e.target.value),
          placeholder: 'Search company, FSC, block...',
          style: {
            flex: 1, minWidth: '160px', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)',
            borderRadius: '3px', padding: '5px 10px', color: 'var(--body-bright)', fontSize: '11px',
          }
        }),

        // Global stats
        h('div', { style: { display: 'flex', gap: '14px', marginLeft: 'auto', fontSize: '11px' } },
          h('span', { style: { color: 'var(--body-dim)' } },
            h('span', { style: { color: '#3dd68c', fontWeight: 700 } }, totalContacted), ' contacted'),
          h('span', { style: { color: 'var(--body-dim)' } },
            h('span', { style: { color: '#C9A84C', fontWeight: 700 } }, totalResponded), ' responded'),
          h('span', { style: { color: 'var(--body-dim)' } },
            h('span', { style: { color: '#C9A84C', fontWeight: 700 } }, '✦ ' + totalPartnered), ' partnered'),
        ),
      ),

      // ── BLOCKS ──
      blocks.map(block => {
        const rows = filterData(data.filter(s => s.block === block));
        return h(BlockGroup, { key: block, block, rows, state, onUpdate, filter });
      }),
    );
  }

  // ── EXPORT ────────────────────────────────────────────────────────────
  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.SupplierRolodexTab = SupplierRolodexTab;
})();
