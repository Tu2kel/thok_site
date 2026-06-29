#!/usr/bin/env node
// scripts/apply-naics-fsc.js
// Replaces the NAICS_FSC block in target files with the generated crosswalk.
// Usage: node scripts/apply-naics-fsc.js <new-naics-fsc.js> <target-file> [<target-file2> ...]

const fs = require("fs");

const [,, newFscPath, ...targetPaths] = process.argv;
if (!newFscPath || targetPaths.length === 0) {
  console.error("Usage: node apply-naics-fsc.js <new-naics-fsc.js> <file1> [file2 ...]");
  process.exit(1);
}

const newBlock = fs.readFileSync(newFscPath, "utf8").trim();

for (const targetPath of targetPaths) {
  const src = fs.readFileSync(targetPath, "utf8");

  // Find the NAICS_FSC block: starts with "const NAICS_FSC = {" and ends with "};"
  // We match the first occurrence and find its closing brace by counting depth.
  const startMarker = "const NAICS_FSC = {";
  const startIdx = src.indexOf(startMarker);
  if (startIdx === -1) {
    console.error(`  SKIP: "${startMarker}" not found in ${targetPath}`);
    continue;
  }

  // Walk forward from the opening brace to find the matching closing brace
  let depth = 0;
  let endIdx = -1;
  for (let i = startIdx + startMarker.length - 1; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        endIdx = i; // position of the closing }
        break;
      }
    }
  }

  if (endIdx === -1) {
    console.error(`  SKIP: Could not find matching closing brace in ${targetPath}`);
    continue;
  }

  // Replace from startIdx to endIdx (inclusive of the closing "};")
  // Check if the char after "}" is ";"
  const endPos = src[endIdx + 1] === ";" ? endIdx + 2 : endIdx + 1;

  const before = src.slice(0, startIdx);
  const after  = src.slice(endPos);
  const result = before + newBlock + after;

  fs.writeFileSync(targetPath, result, "utf8");
  console.log(`  OK: Updated ${targetPath}`);
}
