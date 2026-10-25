# Dibs — set-up guide

A private "call dibs" page for friends and family. You list things from your home with photos; people open your invite link and claim what they want. Claimed items are locked for everyone else instantly, and you get an email for every claim.

**How it fits together**

| Piece | What it does | Cost |
|---|---|---|
| `index.html` on **GitHub Pages** | The website people see | Free |
| **Google Sheet + Apps Script** (`Code.gs`) | Stores items and claims, locks claims so two people can't grab the same thing, sends you emails | Free |
| **Google Drive** folder | Holds the photos | Free (uses your Drive space) |

GitHub Pages can only serve static files, so it can't remember claims on its own — that's what the Google Sheet is for. Allow about 20 minutes for the set-up below.

---

## Step 1 — Create the Google Sheet and paste the backend

1. Go to [sheets.new](https://sheets.new) and name the sheet **Dibs**.
2. In the sheet: **Extensions → Apps Script**. A code editor opens.
3. Delete everything in `Code.gs` and paste in the full contents of the `Code.gs` file from this folder.
4. At the top, in `SETTINGS`, change the two codes:
   - `FRIEND_CODE` — what friends use (it goes inside the invite link, so it can be simple, e.g. `attic-2026`).
   - `OWNER_CODE` — **your** private code for adding and editing items. Make it long and different.
5. Click 💾 **Save**.

## Step 2 — Run the one-off set-up

1. In the toolbar's function dropdown pick **`setup`**, then click **▶ Run**.
2. Google asks for permission. Click **Review permissions** → choose your account → you'll see *"Google hasn't verified this app"*. That's normal for your own scripts: click **Advanced → Go to Dibs (unsafe) → Allow**.
   It needs: the sheet (to store items), Drive (to save photos), and Gmail sending (to email you about claims).
3. The **Execution log** should say **✅ Ready**. Your sheet now has an **Items** tab.
4. Optional: run **`sendTestEmail`** to check notifications arrive (look in spam the first time).

## Step 3 — Publish the backend as a web app

1. Top right: **Deploy → New deployment**.
2. Click the ⚙️ next to "Select type" → **Web app**.
3. Set:
   - **Execute as:** *Me*
   - **Who has access:** *Anyone*  ← required, otherwise the page can't reach it. Your codes are what keep it private.
4. **Deploy** → copy the **Web app URL** (it ends in `/exec`).

## Step 4 — Connect the page

Open `index.html` in a text editor (Notepad is fine). Near the top, fill in:

```js
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/……/exec',   // ← the URL from step 3
  SITE_NAME: 'Dibs',
  TAGLINE: 'Everything here needs a new home. …',
  OWNER_NAME: 'Jake',
  CURRENCY: '€',
  REFRESH_SECONDS: 30,
};
```

Save. (While `API_URL` is empty, the page runs in **demo mode** with sample items — handy for a look before you set anything up.)

## Step 5 — Put it on GitHub Pages

1. On GitHub: **New repository** → name it e.g. `dibs` → **Public** (free GitHub Pages needs a public repo — the *code* is public, your items and claims are not) → **Create**.
2. **Add file → Upload files** → drop in `index.html` → **Commit changes**.
3. **Settings → Pages** → *Source:* **Deploy from a branch** → *Branch:* `main`, folder `/ (root)` → **Save**.
4. After a minute or two the address appears at the top of that page, e.g. `https://yourname.github.io/dibs/`.

## Step 6 — Tell the backend your site address (for the email links)

1. Back in Apps Script, set `SITE_URL` in `SETTINGS` to your GitHub Pages address. Save.
2. **Deploy → Manage deployments** → ✏️ (edit) → *Version:* **New version** → **Deploy**.
   The URL stays the same. **Do this every time you change `Code.gs`** — otherwise the old version keeps running.

## Step 7 — Start listing

1. On your phone, open `https://yourname.github.io/dibs/#k=YOUR-OWNER-CODE` once. It remembers you (and removes the code from the address bar).
2. Tap **＋ Add item** → take photos straight from the camera → fill in title, dimensions, price, etc. → **Add item**.
3. Tap **Copy invite link** and paste it into your family/friends group chat. The link contains the friend code, so people go straight in without typing anything.

---

## Day to day

- **Someone claims something** → you get an email with their name and note. The item shows *"Dibs: Anna"* for everyone else and can't be claimed again.
- **Pickups** (owner button) → everything claimed, grouped by person, with their notes. *Copy list* gives you a text summary to plan collections. Tap **Handed over** when it's gone.
- **Someone changes their mind** → they tap *Changed my mind* on the item (works on the device they claimed from), or you tap **Release claim**.
- **Everything is also in the sheet.** You can fix typos or statuses directly in the *Items* tab (`status` is `available`, `claimed` or `gone`). The *Log* tab records every claim and release.

## Privacy, in plain terms

- Nobody can see items or claim anything without a code. Wrong codes are rejected by the backend, not just hidden by the page.
- The page is set to *noindex*, so search engines won't list it.
- Photos sit in your Drive folder **"Dibs photos"**, shared *view-only to anyone with the link* — that's what lets the page show them. Their links are long random IDs, only visible to people with a code. Don't photograph anything you wouldn't want seen.
- Friends see who claimed what (first name, as they typed it). Notes left with a claim are visible **only to you**.
- **Changing a code** (e.g. a link got shared too widely): edit `SETTINGS`, then *Manage deployments → New version*. Old links stop working; send the new invite link.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "The server sent an unexpected reply" | The deployment's *Who has access* isn't **Anyone**, or `API_URL` is wrong / doesn't end in `/exec`. |
| My `Code.gs` changes don't do anything | Create a **new version** under *Deploy → Manage deployments*. |
| Photos show a camera icon instead of the picture | Open the *Dibs photos* folder in Drive and check sharing is "Anyone with the link". Work/school Google accounts sometimes block this — use a personal Gmail account. |
| No emails | Run `sendTestEmail` in Apps Script; check spam; check `NOTIFY_EMAIL`. Personal accounts can send 100 emails a day. |
| "That access code is not right" | Codes are case-sensitive. Check `SETTINGS` and that you deployed a new version after changing them. |
| iPhone photo won't upload on a desktop browser | Some desktop browsers can't read HEIC. Upload from your phone instead, or export as JPEG. |
