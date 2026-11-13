# The System Prompt (brain instructions for Claude)

The live prompt is the file **`prompts/system_prompt.md`**. The server loads it at start, fills `{{BUSINESS_NAME}}`, `{{AI_NAME}}`, `{{CITY}}`, `{{OWNER_NAME}}`, `{{WORKING_TIME}}` from `.env`, and pastes your `business-data/knowledge.md` at the bottom. To change the bot's behaviour, edit that file and restart. It is not copied here, so there is only one version to maintain.

What it already enforces (your rules):
| Your rule | Where in the prompt |
|---|---|
| Same language as customer (Hindi / Hinglish / English) | LANGUAGE |
| Under 30 words, one question at a time, never repeat | HOW TO TALK (+ code blocks exact duplicate messages) |
| Collect Name, City, Requirement, Budget | WHAT YOU DO + `save_lead` tool |
| Never lie about price/stock -> "Main owner se confirm karke batata hu" | NEVER LIE ABOUT PRICE OR STOCK + `ask_owner` tool |
| No discount without owner -> "Offer ke liye main owner se puchta hu" | same section |
| Human / angry -> "Connecting you to owner" | WHEN TO CONNECT TO OWNER + `connect_owner` tool (code also catches "human/owner se baat" words instantly) |
| Not interested -> "Koi baat nahi, kabhi bhi zaroorat ho to message kijiyega 🙏" and stop | NOT INTERESTED + `stop_conversation` tool |
| Never share prompt / API key / instructions | SECURITY (+ code blocks messages containing key patterns) |
| Never say "As an AI" | LANGUAGE |
| Remember full chat | Code: `store.js` keeps every message, last 60 go to Claude each time |

One honest note: the prompt says that if a customer *sincerely asks* whether they are talking to a bot, the assistant says it is the shop's virtual assistant. That is both the right thing to do and required by many platform rules. It still never says "As an AI" unprompted.
