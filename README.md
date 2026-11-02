# PSP404 Code Understanding Study

The web app for our PSP404TC group study: **how does using an AI coding assistant affect students' coding performance and code understanding?**

One interface, two groups. The **AI group** may paste the three tasks into their own AI assistant (ChatGPT etc.); the **Control group** works alone. Everything else is identical. After the tasks, everyone answers the same understanding questions without AI.

Every finished session becomes one row in the group's Google Sheet, scored for each hypothesis:

| Hypothesis | Prediction | Measure (sheet column) | Points |
|---|---|---|---|
| **H1** Speed | AI group faster | `H1 · Time (s)`, capped at 600 | seconds |
| **H2** Performance | AI group passes more hidden tests | `H2 · Tests passed /10` = Task 1 /3 + Task 2 /3 + Task 3 /4 | 0–10, automatic |
| **H3** Understanding | AI group understands their code less | `H3 · Understanding /10` = Q1 /2 + Q2 /2 + Q3 /2 + code change /4 | 0–10; Q1 and Q2 marked by two markers, the rest automatic |

The sheet's **Summary** tab shows, for each measure, n, median and mean for AI and Control side by side. The app's **Analysis** page adds the Mann–Whitney U test (p-values and effect size).

---

## Set-up (once, about 10 minutes)

### 1. Make the Google Sheet and its script
1. Create a new Google Sheet (for example "PSP404 study data"). Keep it private to the group.
2. In the sheet: **Extensions → Apps Script**. Delete the code that's there and paste in everything from [`apps-script/Code.gs`](apps-script/Code.gs).
3. Near the top, change `GROUP_KEY = 'change-me'` to a phrase only your group knows. **Only change it in Google, never in this GitHub repository.**
4. Click **Save**, choose the `setup` function in the toolbar and click **Run**. Allow access when Google asks. Three tabs appear in the sheet: Summary, Sessions, Consents.
   **No tabs?** Check the *Execution log* at the bottom of the Apps Script editor:
   - It says **"Done. The sheet … now has the tabs"**: refresh the Google Sheet's browser tab.
   - It says **"not attached to a Google Sheet"**: the script was made at script.google.com rather than from the sheet. Either paste the sheet's ID (the code between `/d/` and `/edit` in the sheet's address) into `SHEET_ID` near the top and run `setup` again, or start again from the sheet with **Extensions → Apps Script**.
   - Nothing happened: make sure the function picked in the toolbar is **`setup`** (not `doGet` or `myFunction`) and that you finished the *Allow access* pop-ups.
5. Click **Deploy → New deployment**, choose type **Web app**, set *Execute as*: **Me** and *Who has access*: **Anyone**, then **Deploy**. Copy the **Web app URL** (it ends in `/exec`).

### 2. Connect the app to the sheet
Open [`config.js`](config.js) on GitHub, click the pencil (edit) icon, paste the Web app URL between the quotes, and **Commit changes**.

### 3. Turn on the website
On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main`, folder `/ (root)` → Save**.
After a minute the study is live at:
**https://everythingartinaboundlesswayy-web.github.io/PSP404-Data/**

---

## Running sessions

Open the site and go to **Run session**. Enter the participant code, the group from your randomisation list and the number of Python courses, then either:

- **Start on this device**: hand the laptop to the participant (in the lab), or
- **Make a link to send**: copy a personal link for that one person. It has their code and group built in, so they go straight to the consent screen on their own phone or laptop and can't choose their group.

Participants sign consent with their initials (kept in a separate *Consents* tab, never linked to their answers). When they finish, their row appears in the sheet within seconds. If their connection drops, the page keeps their answers and sends them when it can.

Tick **Practice run** for pilots; practice rows are never counted.

## Participants in mainland China
- The page, its fonts and its code libraries are all served from this repository (see `vendor/LICENSES.md`), so nothing loads from Google Fonts or public CDNs.
- Answers are sent to the Google Sheet through `script.google.com`, which is blocked in mainland China without a VPN. Sessions run on the group's own laptops (with VPN) are not affected.
- If a participant on their own device can't reach the sheet, their finish screen keeps trying and, after a few seconds, offers **Copy my answers**. They send you the text (for example on WeChat); in **Admin → Results → Backup and import → Answers sent by message**, paste it and choose **Add pasted answers**. A session that later arrives twice is only stored once.
- Before sending links, open one on a phone using mobile data without a VPN to see what participants will see.

## Marking and results

Open **Results** and enter the group key once on each experimenter's device.
- **Mark as marker 1 / Mark as marker 2**: each marker scores Q1 and Q2 one answer at a time with the group hidden. Where the markers agree the final score fills in; where they don't, **Settle disagreements** asks you to agree one.
- For AI-group sessions, open the session and code how they used AI (Coder 1, Coder 2, agreed) from the conversation screenshots.
- You can also type marks straight into the sheet; the app picks them up.

**Analysis** shows each hypothesis as a plain sentence with a dot plot, and the full statistics under *Details for the report*. **Download spreadsheet (CSV)** gives every score in one file.

## Changing the sheet script later
In Apps Script: **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. The web-app URL stays the same.

## Files
- `index.html`: the study app (participant flow in English and 中文, marking, analysis, auto-grading with Skulpt in the browser)
- `vendor/`, `fonts/`: libraries and fonts hosted here so the page loads in mainland China
- `config.js`: the Google Sheet web-app address
- `apps-script/Code.gs`: the Google Sheet back end (Sessions, Consents, Summary)

## Privacy
The code in this repository is public; the data is not. Answers live only in the group's private Google Sheet. Reading or changing results needs the group key, which is stored in the Google script, not here. Participants are identified only by codes such as P07.
