# CLAUDE.md

Guidance for Claude Code working in this repo. Sections marked **[Reusable]** describe
patterns that aren't specific to this app — they're worth copying wholesale into any
similar "no-build, vanilla JS + Firebase, hosted on GitHub Pages" project.

## Project snapshot

**Groomingdale** — a pet grooming shop management app (bookings, pets, groomers, schedule,
financial reporting, Google Calendar sync) for a small Thai grooming business. Vanilla
HTML/CSS/JS, no framework, no build step, no `package.json`. Backed by Firebase/Firestore.
Deployed on GitHub Pages, auto-deploys on push to `master`.

| File | Purpose |
|---|---|
| `index.html` | Page shell, login gate, nav markup |
| `styles.css` | All styling (~370 lines, one file, no preprocessor) |
| `app.js` | Everything else — state, views, modals, event handling (~2300 lines) |
| `db.js` | Firestore wrapper + PIN-based auth |
| `calendar.js` | Google Calendar OAuth + sync, isolated behind a `window.GCal` API |
| `firebase-config.js` | Firebase project config (safe to commit — not secret) |

## [Reusable] Architecture pattern: state cache + onSnapshot + optimistic local writes

- One in-memory `state` object holds everything the UI reads (`state.pets`, `state.bookings`,
  etc.), plus current-view/nav state (`state.view`, `state.scheduleDate`, ...).
- Each Firestore collection gets a live `onSnapshot` listener (wrapped as `DB.watch(name, cb)`
  in `db.js`) that replaces the relevant array in `state` and calls `render()`. This means
  every connected device sees every other device's changes without polling.
- Writes are optimistic: `upsertLocal(collection, record)` / `removeLocal(collection, id)`
  update `state` immediately so the UI reflects a change before Firestore's own snapshot
  round-trip confirms it — the confirming snapshot then just no-ops over the same data.
- No client-side router. `state.view` is a string; `render()` is a big if/else that calls the
  matching `viewXxx()` function and swaps `#view`'s `innerHTML`. Nav buttons just set
  `state.view` and call `render()`.
- Rendering is "blow away and rebuild": view functions return a full HTML string via template
  literals, `render()` sets `.innerHTML`, then `bindView()` re-attaches event listeners to the
  fresh DOM. There is no diffing/virtual DOM — this is fine at this app's scale and keeps the
  mental model simple (no framework, no stale-closure bugs), but means anything holding focus
  (a text input mid-typing) must NOT be re-rendered on every keystroke — see the
  `renderHomeResults()` pattern used for the live pet search, which re-renders only the
  results list, not the whole page, specifically so the search inputs keep focus/caret.

## [Reusable] Modal convention

- `openModal(html)` / `closeModal()` swap `#modal-body`'s content and toggle `#modal-host`'s
  `hidden`. There is **no delegated click handling for modal content** — `data-action`
  attributes only work in the main view because `bindView()` walks `[data-action]` after every
  `render()`. Modals are opened outside of `render()`, so every button inside a modal must be
  wired by hand: `$("#some-id").onclick = async () => { ... }`, written right after the
  `openModal(...)` call in the same function. Forgetting this is the single easiest mistake to
  make when adding a new modal — the button will render but silently do nothing.
- Modals close on backdrop click / Escape / any `[data-close-modal]` element, handled once
  globally — don't re-implement this per modal.
- A modal that needs the user to `Cancel` an existing record generally puts destructive
  actions (Delete) on the opposite side of the footer from Cancel/Save (`.spread` layout), only
  rendered when editing an existing record, never when creating a new one.

## [Reusable] `data-action` dispatch pattern (for content that *is* inside a normal render)

- Any element with `data-action="foo"` (plus optional `data-id`, `data-date`, etc.) gets its
  `.onclick` wired in `bindView()` to call `handleAction("foo", el.dataset)`.
- `handleAction` is one big `async function handleAction(action, data) { switch (action) { ... } }`
  — every mutation in the app funnels through here. This makes it trivial to reuse a mutation
  from somewhere else in the code: just call `handleAction("del-booking", { id })` directly
  (this is exactly how the booking-edit modal's Delete button reuses the Bookings list's
  delete logic instead of duplicating it).
- Destructive actions call `confirm(...)` synchronously inside the `case`, not before dispatch
  — so any caller of `handleAction` for a destructive action should expect a native confirm
  dialog to appear as a side effect.

## [Reusable] Firebase/Firestore setup pattern

- Firestore collections are flat and keyed by the app's own uid scheme (`DB.uid(prefix)` →
  `prefix_<timestamp36><random5>`), not Firestore's auto-generated doc IDs — keeps
  `DB.put`/`DB.del` simple (`doc(id).set(...)`, no need to track a separate Firestore ID).
- Auth is per-user PIN, not "real" passwords: each staff member is a real Firebase Auth user
  under a synthetic email derived from their name (`emailForName()` in `app.js`, currently
  `slugified-name@pawfect.local` — a leftover from this app's original name, kept as-is since
  it's just an internal auth identifier with no user-facing meaning), with their PIN as the
  password — a real server-side check via Firestore Security Rules, not just a UI gate. One
  bootstrap "Owner" account (`SHOP_LOGIN_EMAIL`, a fixed email the rules always trust) exists
  so the shop can never get locked out even if the `admins` collection is empty.
- `firebase.auth.Auth.Persistence.LOCAL` is used so login survives refreshes — deliberately
  decoupled from any third-party OAuth connection (see Calendar sync below), which always
  starts fresh regardless of app login state.

## [Reusable] Third-party sync pattern: eventual consistency, not two-way

This app syncs bookings to Google Calendar. The pattern here generalizes to any
"sync our data to an external service the user might view/edit through its own UI" problem:

- **Sync is one-way by design: app → external service, never the reverse**, unless an explicit
  import tool is built (see below). Trying to keep a live two-way mirror is a much harder
  problem (conflict resolution, webhooks/polling for the external side's changes) and wasn't
  needed here — staff use the app as the source of truth, Calendar is a read-mostly mirror
  for people who live in their calendar app.
- Every record that should sync carries `externalId` (here: `calendarEventId`) and a
  `dirty`-style flag (here: `calendarDirty`). A record with no `externalId` or `dirty:true` is
  "pending." A `reconcileCalendar()`-style function, called after every local mutation *and*
  opportunistically (on reconnect, on snapshot updates), walks all pending records and
  syncs them — this means **it doesn't matter which device made the change or which device is
  currently connected to the third-party API**: any connected device eventually flushes the
  whole backlog. This was the actual hard problem worth solving carefully — see
  `reconcileCalendar()` for the full comment explaining why.
- Deletions need their own small "tombstone" collection (here: `calendarTombstones`) recording
  just enough to delete the remote object (`eventId`, plus a label for the pending-sync UI) —
  you can't leave a `deleted:true` flag on the main record because the record itself is gone
  locally too.
- Third-party API errors are recorded back onto the record (`calendarSyncError`) and surfaced
  in a small "N items not yet synced" panel, but **never block or undo the local save** — the
  local write is always the thing that has to succeed; the external sync is always best-effort.
- Treat "gone" errors from the external API (404/410-equivalent) as a normal case to recover
  from (recreate), not a hard failure — the external object can vanish for reasons outside the
  app's control (manually deleted, calendar unshared, etc).
- If the user later wants to pull pre-existing external data *in* (see "Import tooling" below),
  that's a deliberately separate, explicitly-triggered one-time operation — resist the urge to
  make it automatic/continuous unless specifically asked, since blind two-way sync is where
  duplicate-record bugs live.

## [Reusable] One-time "import from external service" tool pattern

Built here as `calendarImportModal()` / `importCandidateFromEvent()` / `renderImportReview()`
in `app.js`. The shape generalizes to "pull pre-existing records from any external API into
this app's data model":

1. **Never write directly from the fetched external data** — always show an editable review
   list first (one row per candidate, every field an actual `<input>`/`<select>`, a checkbox
   to exclude it) and only commit on explicit confirm. Parsing/matching heuristics against
   real-world hand-entered external data (inconsistent naming, missing fields, wrong format)
   will always be imperfect — the review step is not optional polish, it's the actual safety
   mechanism.
2. **Make re-running the import safe by construction**: stamp every imported record with the
   source's external ID immediately, and always filter already-known external IDs out of the
   next fetch. This lets you tell users "safe to re-run any time" truthfully instead of as a
   hope.
3. **Surface ambiguity instead of guessing silently.** Any matching step that could have more
   than one right answer (here: matching an event's parsed pet name against possibly-multiple
   pets with the same name) must not just pick the first candidate — group those rows into a
   "needs attention" section with an explicit picker (see `ambiguousPets` in
   `importCandidateFromEvent`), so a wrong guess never rides in silently as a "success."
4. **Default date/number ranges generously, and say so.** The first bug hit in this tool was
   the date-range default only reaching up to "today," silently excluding future-dated
   existing bookings with no error — the fetch just came back looking correct but wrong. When
   defaulting any filter range for a "pull in everything that already exists" tool, default
   wide (here: ±24 months) and put a one-line hint next to the field saying so.
5. When a "zero results" state is reached, distinguish *why* in the message: "nothing came
   back from the API at all" (usually a wrong ID/wrong account — say so explicitly) is a
   different problem than "results came back but all were already-known/filtered" — collapsing
   both into "nothing to import" wastes the user's debugging time.

## [Reusable] Mobile / iOS Safari-first design rules

This app is used by shop staff on their phones, so these are checked for every new UI
element, not fixed reactively later. Concrete bugs that motivated each rule are noted.

- **Inputs/selects/textareas need `font-size: 16px` or larger.** Anything smaller triggers
  iOS Safari's auto-zoom-on-focus on every text field. Hit this app-wide once via a blanket
  `font-size:14px` on inputs; now enforced per new input group as it's added (see
  `.imp-row input, .imp-row select` in `styles.css` for the pattern on a recently-added form).
- **Tooltips (`title="..."`) don't work on touch devices at all.** Any information conveyed by
  hover must also be a visible caption/label — see the Calendar-color swatch in the import
  tool, which started as a `title` attribute and was deliberately changed to a visible caption
  line once this was reconsidered.
- **New CSS classes for mobile-specific UI need their own distinct class name** — don't reuse
  an existing class's name just because the visual style looks similar; a later
  responsive/media-query rule on that class can silently break the unrelated reuse. This
  specific bug happened twice in this app (the site nav dropdown, and the Schedule mode tabs
  both reusing `.topnav`).
- **Any element meant to be tappable needs a real touch target (~44px)**, not just an icon
  sized for a mouse cursor.
- **Test/reason about narrow-viewport layouts (<820px, and again <520px) explicitly.** Don't
  assume desktop-derived CSS (especially CSS grid columns like `.field-row`) degrades
  gracefully — this app's `.field-row` collapses to one column under 520px on purpose, and new
  multi-column form layouts should follow the same media query rather than inventing a new one.
- Elements meant to run fullscreen (PWA/home-screen use) should respect
  `env(safe-area-inset-*)` — see the sticky topbar and toast in this app.
- When genuinely unsure how something behaves on iPhone Safari vs. desktop Chrome (OAuth popup
  behavior, viewport height quirks, native `<input type="date">`/`<input type="month">`
  rendering), say so explicitly rather than assuming parity.

## [Reusable] Checkbox styling: two patterns, used deliberately in different places

Default: `appearance:none` on `input[type=checkbox]` plus a `::after` checkmark, styled
**globally** (`input[type="checkbox"],input[type="radio"]{ appearance:none; ... }` in
`styles.css`) rather than per-component. This works everywhere in the app *except* one known
exception: **iOS Safari doesn't reliably honor `appearance:none` on a checkbox packed tightly
next to a label inside a dense repeated row** (this app's per-service checkbox+hours row) — it
was observed rendering as a full-width toggle switch there instead of a small box. For that
specific shape (many checkbox+label pairs in a compact row, where the label should also be
tappable to toggle it), the more robust fallback is: make the real `<input>` invisible but
still present/focusable/accessible (`position:absolute; opacity:0; width:1px; height:1px;
pointer-events:none` — not `display:none`, which would break keyboard/screen-reader access),
immediately followed by a plain decorative `<span>` that does the actual drawing via a
`:checked + span` sibling selector, with the wrapping `<label>` making the whole row tappable.
See `.svc-real-checkbox`/`.svc-box` in `styles.css` for the exact implementation. Default to
the global `appearance:none` approach for a standalone checkbox (it's simpler); reach for the
hidden-input+sibling-span pattern specifically for dense repeated checkbox+label rows, and
verify on an actual iOS device/simulator if in doubt rather than assuming desktop Safari or
Chrome DevTools' device emulation caught the same rendering bug.

## [Reusable] GitHub Pages deployment gotchas

- No build step: pushing to `master` is the deploy. There is no staging environment.
- **The GitHub Pages CDN caches aggressively** — a push can take longer than expected to be
  visible, and during development this repeatedly looked like a real bug until verified via
  `curl -sI <url> | grep -Ei 'last-modified|age'` against the live URL to confirm whether the
  CDN was actually still serving a stale copy. Reach for that check before assuming a just-shipped
  fix is broken.
- `firebase-config.js` (API key, project ID, OAuth client ID) is safe to commit — none of those
  values are secret; access control is Firestore Security Rules + the PIN auth layer, not
  hiding this file. Don't reflexively `.gitignore` a Firebase web config out of habit copied
  from other stacks.

## [Reusable] Workflow conventions observed in this project

- **Always `node --check <file>.js` after every edit**, before considering a change done — this
  is a no-build project with no CI, so a syntax error would otherwise only surface live in the
  browser console.
- Commits are created only when explicitly asked, generally batched into one commit per
  logical feature (not one per file-edit), with a message explaining *why*, not just what
  changed — and pushed only when explicitly asked, even though this user pushes almost every
  time. Don't assume standing permission to push from one instance of "commit and push now."
- This app has no test suite and no browser-automation tool is available in this environment —
  verification is `node --check` (syntax only) plus careful code review, and any claim about
  actual rendered/runtime behavior should say plainly that it wasn't visually verified, rather
  than implying it was. The app also requires a live Firebase PIN login against real Firestore
  data to exercise most features, which further rules out casual local testing.
- When a user reports "X doesn't work" with a screenshot, prefer asking them to inspect one
  concrete piece of evidence (click the specific event, check one saved field) over guessing
  further — several bugs in this project (Calendar ID mismatch red herring, all-day-event
  exclusion, ambiguous pet-name matching) were only correctly diagnosed this way rather than by
  reasoning from the description alone.

## This project's data model (Groomingdale-specific)

Firestore collections: `pets`, `groomers`, `bookings`, `admins`, `settings`, `activity`,
`calendarTombstones`, `deletedBookings` (the Bin — soft-deleted bookings, same doc id as the
original, restorable via the Bookings page's "🗑 Bin" section; Owner/Admin only).

- **`bookings`**: `petId` (optional — a booking can reference a free-text `petName`/`breed`
  without a real pet record), `groomerId` (`null` = "No preference", rendered as its own
  Schedule column), `start` (ISO string), `recurrence` (`none`/`weekly`/`biweekly`/`monthly`)
  + `recurrenceUntil`, `services` (array of `SERVICES` labels) + `serviceHours` (per-service
  duration, drives Calendar event length), `totalCost` (staff-overridable, falls back to a
  weight-tier estimate when null), `notes`, `status` (`pending`/`completed`/`cancelled`) +
  `completedAt`, and the Calendar sync fields `calendarEventId`/`calendarDirty`/`calendarSyncError`.
- **`pets`**: `name`, `species` (`dog`/`cat` — pricing and breed lists are species-aware),
  `breed`, `weight`, `groomerId` (usual groomer, prefills new bookings).
- Pricing is weight-tier based, species-separated (`DOG_WEIGHT_TIERS`/`CAT_WEIGHT_TIERS` in
  `app.js`), no in-app editor yet — updating prices means editing those arrays and redeploying.
- Groomer colors are drawn from the fixed 11-color Google Calendar palette
  (`GROOMER_COLORS`), so a groomer's app color always has a matching `calendarColorId` for
  Calendar events — this is also what the Calendar import tool reverse-matches against to
  guess a groomer from an imported event's color.
