# 🐾 Pawfect — Grooming Studio

A web app to manage pet grooming profiles and bookings, shared live across every
device at the shop (Firebase/Firestore). Each admin signs in with their own name + PIN.

## One-time setup (do this before the app will work)

The app needs its own free Firebase project to store shared data. About 10 minutes.

1. **Create the project** — go to [console.firebase.google.com](https://console.firebase.google.com) →
   *Add project* → give it a name (e.g. `pawfect-grooming`) → you can skip Google Analytics.
2. **Register a Web app** — in the project, click the `</>` (Web) icon → nickname it anything →
   *Register app*. You'll see a `firebaseConfig` object with 6 values
   (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`).
3. **Paste those 6 values** into [firebase-config.js](firebase-config.js) in this folder,
   replacing the `PASTE_...` placeholders.
4. **Create the database** — left sidebar → *Build → Firestore Database* → *Create database* →
   start in **production mode** → pick any region close to you.
5. **Set security rules** — Firestore Database → *Rules* tab → replace the contents with:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       function isOwner() {
         return request.auth != null && request.auth.token.email == 'admin@groomingdale.com';
       }
       function myAdmin() {
         return get(/databases/$(database)/documents/admins/$(request.auth.uid)).data;
       }
       function isStaff() {
         return request.auth != null &&
           (isOwner() || exists(/databases/$(database)/documents/admins/$(request.auth.uid)));
       }
       // Admins created before roles existed have no `role` field — treat that as "admin"
       // so nobody who already had full access loses it.
       function myRole() {
         return isOwner() ? 'owner' : (('role' in myAdmin()) ? myAdmin().role : 'admin');
       }
       function canDelete() { return isOwner() || myRole() == 'admin'; }

       match /admins/{id} {
         allow read: if isStaff();
         allow create, update, delete: if isOwner();
       }
       match /pets/{id} {
         allow read, create, update: if isStaff();
         allow delete: if canDelete();
       }
       match /groomers/{id} {
         allow read, create, update: if isStaff();
         allow delete: if canDelete();
       }
       match /bookings/{id} {
         allow read, create, update: if isStaff();
         allow delete: if canDelete();
       }
       match /activity/{id} {
         allow read, create: if isStaff();
       }
       match /calendarTombstones/{id} {
         allow read, write: if isStaff(); // background Calendar-sync cleanup, not a role-gated action
       }
       match /deletedBookings/{id} {
         allow read, create, delete: if canDelete(); // the Bin — same role gate as deleting a booking
       }
       match /settings/roles {
         allow read: if isStaff();
         allow write: if isOwner();
       }
       match /settings/{id} {
         allow read: if isStaff();
         allow write: if isStaff() && id != 'roles';
       }
     }
   }
   ```
   *Publish.* This means: only the App Owner account, or someone listed in the app's own
   **Admins** section, can read or write any data — and within that, only the App Owner can
   add/remove people or change role access, and only the App Owner or someone with the Admin
   role can delete a pet, booking, or groomer (the Groomer role can add and edit, never delete).
6. **Turn on PIN logins** — left sidebar → *Build → Authentication* → *Get started* →
   under *Sign-in method*, enable **Email/Password**.
7. **Create the App Owner account** — Authentication → *Users* tab → *Add user* →
   - Email: `admin@groomingdale.com` (must match `SHOP_LOGIN_EMAIL` in `firebase-config.js` exactly)
   - Password: **this is the App Owner PIN** — pick something 6+ characters (e.g. `482917`).

   This is the one account you set up by hand — it always has full access to every section,
   even if the `admins` collection is empty, so you can't get locked out. On the app's login
   screen, sign in with name `App Owner` (or the older `Owner`, still accepted) and this PIN,
   then use the **Admins** section to add everyone else, each as either an **Admin** (full
   add/edit/delete within their sections) or a **Groomer** (add/edit, never delete), with
   their own name and PIN.

That's it — open `index.html` (locally or once deployed) and log in.

### Managing people day-to-day
Once signed in as App Owner, open **Admins** → *＋ Add person* → pick a role (Admin or
Groomer), enter a name and a PIN (6+ characters) → that person can now log in with that name
+ PIN from any device, and only sees the nav sections their role is allowed. Removing someone
there revokes their data access immediately; changing their role dropdown takes effect on
their next page load (or immediately, if they're active and something re-renders). Note:
removing someone doesn't delete their underlying Firebase login — for that, go to Firebase
Console → Authentication → Users and delete it there too (optional; without the Firestore
listing they can't reach any data regardless). There's no in-app way to change anyone's PIN
(your own included) — Firebase's client SDK only allows that from the Firebase Console:
Authentication → Users → find their email (shown on the Admins page) → Reset password.

The **Role access** panel on the same page (App Owner only) sets which nav sections the
Admin and Groomer roles can see — the Admins section itself is never selectable there; it's
always App Owner-only. New installs default Admin to every section and Groomer to
Home/Pets/Bookings/Schedule — adjust and *Save role access* to fit your shop.

## Hosting it for free (GitHub Pages)

1. Push this whole folder to a GitHub repo.
2. Repo → **Settings → Pages** → Source: branch `main`, folder `/ (root)` → Save.
3. GitHub gives you a URL like `https://<username>.github.io/<repo>/` within a minute or two —
   share that with your groomers. It works from any phone, tablet, or computer, and everyone
   sees the same live data.

> The values in `firebase-config.js` are safe to publish/commit — they're not secret keys.
> Access is controlled by the PIN + Firestore rules above, not by hiding this file.

## What's inside
- **Pets** — photo, name, dog/cat, breed, weight, assigned groomer, typical time for
  Basic / Hair Styling, a running **service history**, and (once weight is set) an
  **estimated price** for each service based on the shop's weight-tier price sheet.
- **Home** — search pets by **name and/or breed**, quick **New Booking**, a groomer overview,
  and a **Notifications** feed showing recent bookings and groomer changes (who did what,
  and when) — synced live, so everyone sees the same activity regardless of device.
- **Bookings** — pick an existing pet (shows its photo, autofills breed/groomer/typical
  service times) or create a new pet profile right from the booking form. Each selected
  service needs its hours entered (used as the Google Calendar event duration later), and
  the **total cost** defaults to a live estimate from the pet's weight tier but can be
  overwritten by hand at any time (a "use this" link brings back the estimate). Groomer can
  be a specific person or **No preference** (shows in its own "No preference" column on the
  Schedule Day view). Repeat **one-time / weekly / every 2 weeks / monthly**, with an
  optional **repeat-until** end date. Each booking row has a 📋 button that copies a
  ready-to-send confirmation message to the clipboard —
  `confirmed น้อง {name} {breed} {date & time}` — for pasting straight to the customer (uses
  the upcoming date for recurring bookings), plus the estimated total if the pet's weight is known.
  Once a booking's date (or, for recurring ones, its repeat-until date) has passed without being
  resolved, it moves into a **Past bookings — needs confirmation** section with **✓ Complete**
  / **✕ Cancel** buttons; confirming moves it into **Completed Bookings** or **Cancelled
  Bookings** (collapsed by default, cancelling also removes its Google Calendar event same as
  deleting).
- **Financial** — pick any month and see total revenue, how many customers were served, and
  a per-groomer breakdown of bookings and earnings for that month. Figures are based on
  **when a booking was marked Completed**, not its original scheduled date (so a recurring
  booking resolved late still counts for the month it was actually closed out).
- **Groomers** — add/remove groomers, each with a color (the full Google Calendar palette,
  11 colors including yellow). Seeded with **Mint, Mikka, Boat**.

### Pricing (weight-tier based, dog and cat)
Basic maps to the price sheet's "Basic" range (shown as a range since it depends on hair
length, which isn't tracked); Hair Styling maps to "Full Groom". Dogs and cats have separate
weight-tier tables (`DOG_WEIGHT_TIERS` / `CAT_WEIGHT_TIERS` near the top of `app.js`) since
the shop prices them differently — the booking form's Dog/Cat selector picks which one
applies. There's no in-app settings screen for this yet, so updating prices means editing
those arrays directly and redeploying. Estimates only appear once a pet's weight is set.

### Breeds
The breed suggestion list also depends on species — `DOG_BREEDS` / `CAT_BREEDS` (20 each)
in `app.js`. Typing anything not on the list still works fine and gets remembered as a
suggestion for next time (shared across both species, for simplicity).
- **Admins** (App Owner only) — add/remove people who can log into the app, each with their
  own name + PIN and a role (**Admin**: full add/edit/delete within their sections; **Groomer**:
  add/edit, never delete), plus a **Role access** panel setting which nav sections each role
  can see.
- **Calendar** — connect a Google account and set the shared Calendar ID that bookings sync to.
- **Schedule** — Day / Week / Month views, built entirely from the app's own booking data
  (instant, always up to date regardless of Google Calendar connection status):
  - **Day** — one timeline column per groomer, booked slots as colored blocks, plus a text
    list of open time ranges per groomer underneath.
  - **Week** — a 7-day timeline (all groomers mixed into each day, color-coded), click a
    day's header to jump into its Day view.
  - **Month** — a traditional calendar grid; each day shows up to 3 bookings as small colored
    pills (+N more if busier), click any day to jump into its Day view.
  - Navigate by Prev/Next (steps a day/week/month depending on the active view), Today, or
    jump straight to any date. Business hours and closed days are editable from this tab
    (defaults to 10:00–19:00, closed Tuesdays).

## Files
| File | Purpose |
|------|---------|
| `index.html` | Page shell + login gate |
| `styles.css` | Styling |
| `firebase-config.js` | Your Firebase project's connection details (fill in, see setup above) |
| `db.js` | Firestore storage + per-admin PIN auth |
| `calendar.js` | Google Calendar OAuth connection + event sync |
| `app.js` | App logic & screens |

## Google Calendar

Bookings sync to **one shared Google Calendar** — a groomer's color tells their events
apart, no per-groomer calendar needed. Setup happens once; after that, anyone with edit
access to that calendar just clicks **Connect** in the app to start syncing from their browser.

### One-time setup (Google Cloud Console)
Uses the same Google Cloud project as Firebase — no new project needed.
1. **Enable the Calendar API** — [console.cloud.google.com/apis/library/calendar-json.googleapis.com](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com),
   confirm your project is selected → **Enable**.
2. **Configure OAuth consent** — APIs & Services → *Google Auth Platform* → **Get started** →
   fill in app name + your email → Audience: **External** → Contact: your email → Create.
   Then **Data Access** → *Add or remove scopes* → add `.../auth/calendar.events` (use "Manually
   add scopes" if it's not in the list — that means the Calendar API isn't enabled yet, see step 1)
   → Save. Then **Audience** → *Test users* → add every Google account that will connect
   (your demo account now, the shop's real account later).
3. **Create the OAuth Client ID** — **Clients** → *Create client* → Web application →
   Authorized JavaScript origins: your exact hosted origin, e.g. `https://yourname.github.io`
   (origin only, no path) → Create. Copy the Client ID (ends in `.apps.googleusercontent.com`,
   not secret) into `GOOGLE_CLIENT_ID` in [firebase-config.js](firebase-config.js).
4. **Get the shared Calendar ID** — open the shop's shared Google Calendar → Settings →
   find it in the calendar list → **Integrate calendar** → copy the **Calendar ID**.

### In the app
Open the **Calendar** tab → paste the Calendar ID → *Save Calendar ID* → **Connect Google
Calendar** (signs in with whichever Google account is connecting; needs edit access to that
calendar). From then on, in that browser: creating or editing a booking creates/updates a
matching Calendar event (title = `Name Breed Service`, color = the groomer's, duration = the sum
of that booking's service hours, recurrence = the chosen repeat rule + until date); deleting
a booking removes its event.

Each token only lasts about an hour, but once connected the app silently renews it in the
background (no popup, no click) for as long as that browser tab stays open and you remain
logged into Google — so in practice it stays connected all day. It only drops back to "Not
connected" if you close the browser, log out of Google, or revoke access; reconnect anytime
from the Calendar tab. (Nothing about the connection is ever written to Firestore — this is
browser memory only, deliberately, since a true always-on connection that survives restarts
would need a small backend to hold a real refresh token.) If it's not connected, bookings
still save normally; Calendar sync is always best-effort and never blocks or undoes a save.

The app *does* keep you logged in across a refresh or reopened browser (Firebase's normal
session persistence) — but the Calendar connection never does, on purpose (see above), so
it's always starting fresh regardless of how the app login happened. If Calendar sync is
set up (a Calendar ID is saved) but this browser isn't connected, a yellow banner appears
at the top of every page with a **Connect** button, and stays there (not a one-time popup
that's easy to miss or accidentally dismiss) until you connect or explicitly dismiss it for
that session. Google requires an actual click to open the sign-in popup, so this can't
happen fully automatically, but nothing has to be remembered — the reminder is just always
visible when it's relevant, independent of whether you just logged in or the session was
auto-resumed.

### Multi-device syncing: it doesn't matter who's connected
Only one device needs to be connected at any given moment for everyone's changes to reach
Calendar — sync isn't tied to whoever made the change. Every booking create/edit marks
itself as needing a sync, and every deletion of a synced booking leaves a small "pending
deletion" record in Firestore (`calendarTombstones`) — regardless of whether *that* device
is connected. Any device that *is* connected — reacting to its own actions, to live updates
from other devices, or right after connecting — clears this backlog: creates/updates
whatever's pending, and deletes whatever's tombstoned. So if the front-desk PC stays
connected all day, a booking cancelled from someone's phone (not connected) still disappears
from Calendar within moments, without that phone ever needing its own connection. If nobody
is connected when a change happens, it just waits — the next device to connect catches up
automatically.

One known, low-impact limitation: if two devices happen to be connected and processing the
same brand-new booking at the exact same moment, it could create two duplicate Calendar
events instead of one (no locking between devices). Rare in practice for a small shop, and
easy to spot and delete manually if it ever happens.

### Switching from the demo calendar to the real one
Once testing looks good: share the shop's real Google Calendar with whichever account(s)
will connect (give them "Make changes to events" permission), add that account under
*Test users* in step 2 above, then just paste the real Calendar ID into the app's Calendar
tab and reconnect — no code changes needed.

If that calendar already has bookings on it from before the app existed, they won't appear
in the app automatically — sync only ever writes app → Calendar, it never reads existing
events on its own. Use **Import from Calendar** (Calendar tab, once a Calendar ID is saved)
to pull them in as bookings: pick a date range, it fetches those events and, for each one,
parses the title (built as `Name Breed Service Remark`, same format the app itself writes)
into pet name / breed / service / remark, guessing the groomer from the event's color. You
review and fix each row (anything it couldn't confidently parse just lands in the remark
field) before confirming. Each imported booking is tagged with the source event's id, so
re-running the import later — or editing/cancelling that booking in the app afterward — never
creates a duplicate event; events already linked to a booking are skipped automatically.
