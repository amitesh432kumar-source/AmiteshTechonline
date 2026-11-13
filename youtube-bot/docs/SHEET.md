# Google Sheet structure

Har creator ke login par uski **apni Google Drive me** ek Sheet auto-banti hai (scope `drive.file` — platform ko baaki Drive nahi dikhta). 4 tabs, header row frozen:

### Tab 1: `Comments` (har comment/chat reply ka record)
| A Date | B Video Name | C Viewer Name | D Comment | E AI Reply | F Lead? Yes/No | G Category | H Status | I Comment ID | J Video ID |
|---|---|---|---|---|---|---|---|---|---|
| 13/11/2026, 10:42 pm | Python Course Demo | Rahul | Price kya hai? | Bhai full details description me… | Yes | price | posted | Ugx… | dQw… |

`Status`: `posted` · `dry_run` (post nahi hua) · `forwarded` · `held` · `skipped` · `skipped_quota` · `error`

### Tab 2: `Leads`
`Date | Viewer Name | Channel ID | Interest | Question / Comment | Video Name | Follow-up Status` — jab AI ko lage viewer kharidne/join karne me interested hai. `Follow-up Status` aap khud bharo (New / Called / Done).

### Tab 3: `Owner_Inbox`
`Date | Viewer Name | Channel ID | Comment | Reason | Video Name | Handled?` — collab / paid promotion / number wale comments (AI ne reply nahi kiya).

### Tab 4: `Weekly_Reports`
`Week Ending | Report` — har Sunday ki Hinglish report.

> Sheet me `= + - @` se shuru hone wale text ke aage `'` lag jaata hai (formula injection se bachav).
> Asli source-of-truth Postgres DB hai; Sheet creator ke liye convenient copy hai.
