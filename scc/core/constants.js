(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — SHARED CONSTANTS
  //  Single source of truth for FSC names, BAA country lists, and any
  //  other reference data used by more than one tab.
  //  Exports: window.SCC_CONSTANTS
  // ═══════════════════════════════════════════════════════════════════════

  const FSC_NAMES = {
    2510: "Vehicular Cab/Body/Frame",
    2530: "Brake/Steering/Axle",
    2540: "Vehicular Furniture",
    2910: "Engine Fuel System",
    2940: "Engine Filters",
    2990: "Engine Accessories",
    3020: "Gears/Pulleys/Sprockets",
    3030: "Belting/Drive Belts",
    3110: "Bearings",
    4110: "Refrigeration Equipment",
    4210: "Fire Fighting Equipment",
    4240: "Safety/PPE/Rescue Equipment",
    4320: "Power/Hand Pumps",
    4330: "Filters/Separators",
    4710: "Pipe/Tube",
    4730: "Hose/Pipe Fittings/Valves",
    4820: "Valves",
    4910: "Shop Equipment",
    4940: "Maintenance Equipment",
    5110: "Hand Tools",
    5120: "Power Tools",
    5305: "Screws",
    5306: "Bolts",
    5310: "Nuts/Washers",
    5315: "Pins/Rivets",
    5320: "Rivets",
    5330: "Packing/Gaskets",
    5331: "Seals/O-Rings",
    5340: "Commercial Hardware",
    5365: "Bushings/Bearings/Mountings",
    5920: "Fuses/Arrestors",
    5925: "Circuit Breakers",
    5935: "Electrical Connectors",
    5961: "Semiconductors",
    5962: "Electronic Components",
    5975: "Electrical Hardware",
    6110: "Electrical Control Equipment",
    6120: "Power Distribution Equipment",
    6135: "Primary Batteries",
    6140: "Secondary Batteries",
    6145: "Wire/Cable",
    6150: "Electrical Wire/Cable",
    6210: "Indoor/Outdoor Lighting Fixtures",
    6230: "Portable/Hand Lighting",
    6240: "Electric Lamps",
    6350: "Signal/Warning Devices",
    6505: "Drugs/Biologicals",
    6530: "Medical/Dental Instruments",
    6532: "Hospital/Surgical Equipment",
    6630: "Chemical Analysis Instruments",
    6640: "Laboratory Equipment",
    6810: "Chemicals",
    6840: "Pest Control",
    6850: "Misc Chemical Specialties",
    6910: "Training Aids",
    7110: "Office Furniture",
    7125: "Containers/Bins",
    7310: "Food Cooking Equipment",
    7320: "Kitchen Equipment",
    7330: "Food Service Equipment",
    7930: "Cleaning Compounds",
    8415: "Individual Equipment",
    8430: "Footwear",
    8455: "Badges/Insignia",
    8465: "Packs/Bags",
    8470: "Armor/Body Protection",
    9150: "Oils/Lubricants",
    9510: "Ferrous Metal Bar/Sheet",
    9520: "Nonferrous Metal Bar",
    9535: "Metal Plate/Sheet/Strip",
    9540: "Structural Metal",
  };

  const BAA_NON_QUAL = [
    "China", "Taiwan", "India", "Vietnam", "South Korea",
    "Mexico", "Bangladesh", "Indonesia", "Thailand", "Malaysia",
  ];

  const BAA_QUAL = [
    "United States", "Australia", "Austria", "Belgium", "Canada",
    "Czech Republic", "Denmark", "Egypt", "Estonia", "Finland",
    "France", "Germany", "Greece", "Israel", "Italy", "Japan",
    "Latvia", "Lithuania", "Luxembourg", "Netherlands", "Norway",
    "Poland", "Portugal", "Slovenia", "Spain", "Sweden",
    "Switzerland", "Turkey", "United Kingdom",
  ];

  window.SCC_CONSTANTS = { FSC_NAMES, BAA_NON_QUAL, BAA_QUAL };
})();
