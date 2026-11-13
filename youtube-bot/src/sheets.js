import { sheetsFor, authForTenant } from './google.js';
import { setSheet } from './db.js';
import { log } from './config.js';

// Google Sheet structure (docs/SHEET.md me detail)
export const TABS = {
  Comments: ['Date', 'Video Name', 'Viewer Name', 'Comment', 'AI Reply', 'Lead? Yes/No', 'Category', 'Status', 'Comment ID', 'Video ID'],
  Leads: ['Date', 'Viewer Name', 'Channel ID', 'Interest', 'Question / Comment', 'Video Name', 'Follow-up Status'],
  Owner_Inbox: ['Date', 'Viewer Name', 'Channel ID', 'Comment', 'Reason', 'Video Name', 'Handled?'],
  Weekly_Reports: ['Week Ending', 'Report']
};

// Creator ki apni Drive me nayi Sheet banti hai (scope: drive.file) - platform ko baaki Drive nahi dikhta
export async function createSheetForTenant(tenant) {
  const auth = authForTenant(tenant);
  const s = sheetsFor(auth);
  const res = await s.spreadsheets.create({
    requestBody: {
      properties: { title: `${tenant.settings.profile.channelName || 'My Channel'} - YouTube AI Assistant` },
      sheets: Object.keys(TABS).map((title) => ({ properties: { title, gridProperties: { frozenRowCount: 1 } } }))
    }
  });
  const id = res.data.spreadsheetId;
  await s.spreadsheets.values.batchUpdate({
    spreadsheetId: id,
    requestBody: { valueInputOption: 'RAW', data: Object.entries(TABS).map(([t, h]) => ({ range: `${t}!A1`, values: [h] })) }
  });
  await setSheet(tenant.id, id);
  log(`[tenant ${tenant.id}] sheet bani: ${id}`);
  return id;
}

export async function appendRow(tenant, tab, row) {
  if (!tenant.sheet_id) return;
  try {
    await sheetsFor(authForTenant(tenant)).spreadsheets.values.append({
      spreadsheetId: tenant.sheet_id,
      range: `${tab}!A1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row.map((c) => (typeof c === 'string' && /^[=+\-@]/.test(c) ? `'${c}` : c))] } // formula injection roko
    });
  } catch (e) {
    log(`[tenant ${tenant.id}] sheet append fail (${tab}):`, e.message);
  }
}

export const sheetUrl = (id) => (id ? `https://docs.google.com/spreadsheets/d/${id}` : null);
