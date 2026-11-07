# MOVE

A private page for friends and family to claim things from a household before a move. The owner lists items with photos; people open the invite link and claim what they want. A claimed item is locked for everyone else straight away, others can join a waitlist, and the owner gets an email for every claim.

| Piece | What it does | Cost |
|---|---|---|
| `index.html` on **GitHub Pages** | The page people see | Free |
| **Google Sheet + Apps Script** (`Code.gs`) | Stores items, claims, waitlists and pickup times; locks claims so two people can't get the same thing; sends the emails | Free |
| **Google Drive** folder | Holds the photos | Free |
| `tests.html` | Self-test for the page — run it before every upload | — |

GitHub Pages only serves files, so the Sheet does the remembering. Nothing personal belongs in this repo: the access codes live only in Apps Script.

---

## Setting it up

1. **Sheet.** Create a Google Sheet, then **Extensions → Apps Script**.
2. **Backend.** Replace everything in the editor with `Code.gs` from this repo. In `SETTINGS`:
   - `FRIEND_CODE` — for friends (it goes inside the invite link). Make it long, e.g. three random words and a number.
   - `OWNER_CODE` — yours, for adding and editing. Long and different.
   - `SITE_URL` — your GitHub Pages address (used in the emails).
3. **Permissions.** Pick **`setup`** in the function list and **Run**. Allow access (on "Google hasn't verified this app": **Advanced → Go to … → Allow**). It creates the `Items`, `Slots` and `Log` tabs and the photo folder.
4. **Publish.** **Deploy → New deployment → Web app**, *Execute as: Me*, *Who has access: Anyone*. Copy the web-app URL (ends in `/exec`).
5. **Page.** In `index.html`, set `CONFIG.API_URL` to that URL. With `API_URL` empty the page runs on sample data (demo mode).
6. **GitHub Pages.** Upload `index.html`, the icons, `manifest.webmanifest`, `tests.html` and `.nojekyll`; then **Settings → Pages → Deploy from a branch → main / (root)**.

**Changed `Code.gs`?** **Deploy → Manage deployments → ✏️ → Version: New version → Deploy.** The URL stays the same. Without a new version the old code keeps running.

## Day to day

- **Add items** from your phone (owner link: `…/dibs/#k=YOUR-OWNER-CODE`, opened once). Up to 10 photos each, a quantity for sets, and W/D/H dimensions. Tick **Dimensions measured** once you've checked them with a tape measure.
- **Keep items** you're not giving away: tick **Keep — don't offer to friends** in the editor, or use **Keep it** on the item. Friends never receive kept items; they show under **Keeping** for you. **Offer to friends** puts one back on the list.
- **Dimension arrows.** On an item's page, **Dimension arrows** (or the ruler button on the cover photo in the editor) opens the arrow editor: the arrows start roughly placed, and you drag their end points onto the item's corners. The numbers come from the item's W/D/H. Friends see the arrows on that photo, in the full-screen view too, with a **Dimensions** button to hide them. Deleting the photo deletes its arrows.
- **Invite** with **Copy invite link**.
- **Claims and waitlist.** First come, first served. If the claimer changes their mind, it passes to the next person in line automatically.
- **Pickups** lists everything claimed, by pickup time and person. Add the times you're around there; **Copy list** gives a text version with dimensions, so people know what vehicle they need.
- **Everything is also in the Sheet** (`Items` tab). `status` is `available`, `claimed`, `gone` or `keep`. The `Log` tab records every change.

### Export for storage planning

**Export** (owner only) downloads `move-inventory-YYYY-MM-DD.json` with every item, including kept and gone ones. Each item has its id, title, category, room, status, disposition (`store` for kept items, otherwise `give`), quantity, whether it was measured, and dimensions converted to centimetres (`null` if width, depth or height is missing; the original text is in `dimensionsRaw`).

The export deliberately leaves out names, claim notes, prices, photos and tokens. The format (`"format": "move-inventory", "version": 1`) is a contract with the storage planner: change it only by agreement, and bump `version` for additions.

## Testing

Open `tests.html` from the site address (for example `https://yourname.github.io/dibs/tests.html`). It loads the page on sample data and checks dimension parsing, the export format, keep/quantity rules, permissions and the claim/waitlist flow. It never touches the live list. Everything should be green before you upload a new `index.html`.

Add `?demo` to the page address to click around on sample data without touching the live list.

## Privacy and security

- **The codes are the secret, not the URL.** The Apps Script URL has to be in the public page for it to work; without a valid code it returns nothing. Wrong codes are refused by the backend. Use long codes; if one leaks, change it in `SETTINGS`, publish a new version, and send a new invite link.
- **Friends see** items (not kept ones), and the names people typed when claiming or joining a waitlist. **Only the owner sees** claim notes, waitlist notes and the measured flag.
- **Photos** are in your Drive folder, shared "anyone with the link can view" so the page can show them. The links are long and random, but don't photograph anything private.
- **`GLYPH` and `DESTINATION`** in `CONFIG` are cosmetic and optional; they're shown on the page, so leave them blank if you'd rather not say where you're moving.
- The page asks search engines not to index it (`noindex`).

## Troubleshooting

| Symptom | Fix |
|---|---|
| "The server sent an unexpected reply" | The deployment's *Who has access* isn't **Anyone**, or `API_URL` is wrong. |
| A change to `Code.gs` does nothing | Publish a **new version** (see above). |
| Waitlist, pickup times, keep, export or arrows don't work | The page is newer than the backend: paste the current `Code.gs`, run `setup`, publish a new version. |
| Photos show a camera icon | Check the photo folder is shared "Anyone with the link". Work/school Google accounts can block this. |
| No emails | Run `sendTestEmail` in Apps Script; check spam. Personal Gmail sends about 100 a day. |
