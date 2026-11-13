// Writes the header row into your Google Sheet:  npm run setup-sheet
import { ensureHeader } from "../src/sheets.js";
await ensureHeader();
console.log("✅ Header row written to the 'Leads' tab.");
