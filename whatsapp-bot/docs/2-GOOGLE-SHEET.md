# Google Sheet structure for leads

## Columns (Row 1 = headers)

| A | B | C | D | E | F | G | H (extra) | I (extra) |
|---|---|---|---|---|---|---|---|---|
| Date | Name | Phone | City | Requirement | Budget | Status | Last Updated | Chat Link |

The first seven are exactly your format: `Date | Name | Phone | City | Requirement | Budget | Status`. H and I are small extras (when the lead was last updated, and a tap-to-chat link). One row per customer: the bot updates the same row as it learns more (it finds the customer by Phone).

## Status values the bot uses
`New` -> `Interested` -> `Booking Requested` / `Order Requested` -> (you confirm manually) ; also `Follow-up Needed` and `Not Interested`.

## Create it
1. sheets.google.com -> new sheet. Rename the tab at the bottom to **Leads** (exact spelling).
2. Copy the sheet ID from the URL: `docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit` -> `GOOGLE_SHEET_ID`.
3. console.cloud.google.com -> create a project -> **APIs & Services -> Library -> Google Sheets API -> Enable**.
4. **APIs & Services -> Credentials -> Create credentials -> Service account**. Name it `whatsapp-bot`, finish.
5. Open the service account -> **Keys -> Add key -> Create new key -> JSON**. A file downloads.
6. Open that JSON, copy the `client_email` value. In your Google Sheet click **Share**, paste that email, give **Editor**.
7. Put the JSON in `.env`:
   - Easiest on Render: `base64 -w0 key.json` (Mac: `base64 -i key.json`) and paste the output into `GOOGLE_SERVICE_ACCOUNT_B64`.
   - Or paste the JSON as one line into `GOOGLE_SERVICE_ACCOUNT_JSON`.
8. Run `npm run setup-sheet`. Header row appears.

## Handy tips (do in the sheet)
- Select column G -> Data -> Data validation -> dropdown of the status values (so you can change status by hand).
- Data -> Create a filter, or Format -> Conditional formatting: colour "Booking Requested" green, "Follow-up Needed" yellow.
- Freeze row 1 (View -> Freeze).
- In **Google Sheets -> Tools -> Notification settings** turn on "any changes are made", to get an email for each new lead.
