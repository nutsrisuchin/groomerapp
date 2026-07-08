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
       function isAdmin() {
         return request.auth != null &&
           (request.auth.token.email == 'admin@groomingdale.com' ||
            exists(/databases/$(database)/documents/admins/$(request.auth.uid)));
       }
       match /{document=**} {
         allow read, write: if isAdmin();
       }
     }
   }
   ```
   *Publish.* This means: only the Owner account, or someone listed in the app's own
   **Admins** section, can read or write any data.
6. **Turn on PIN logins** — left sidebar → *Build → Authentication* → *Get started* →
   under *Sign-in method*, enable **Email/Password**.
7. **Create the Owner account** — Authentication → *Users* tab → *Add user* →
   - Email: `admin@groomingdale.com` (must match `SHOP_LOGIN_EMAIL` in `firebase-config.js` exactly)
   - Password: **this is the Owner PIN** — pick something 6+ characters (e.g. `482917`).

   This is the one account you set up by hand — it always has access, even if the
   `admins` collection is empty, so you can't get locked out. On the app's login screen,
   sign in with name `Owner` and this PIN, then use the **Admins** section to add
   everyone else (Mint, Mikka, Boat, etc.), each with their own name and PIN.

That's it — open `index.html` (locally or once deployed) and log in.

### Managing admins day-to-day
Once signed in as Owner (or any admin), open **Admins** → *＋ Add admin* → enter a name
and a PIN (6+ characters) → that person can now log in with that name + PIN from any device.
Removing an admin there revokes their data access immediately. Note: it doesn't delete
their underlying Firebase login — for that, go to Firebase Console → Authentication →
Users and delete it there too (optional; without the Firestore listing they can't reach
any data regardless).

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
  shower / hair clipping / hair styling, and a running **service history**.
- **Home** — search pets by **name and/or breed**, quick **New Booking**, and a groomer overview.
- **Bookings** — pick an existing pet (shows its photo, autofills breed/groomer/typical
  service times) or create a new pet profile right from the booking form. Each selected
  service needs its hours entered (used as the Google Calendar event duration later).
  Repeat **one-time / weekly / every 2 weeks / monthly**, with an optional **repeat-until**
  end date.
- **Groomers** — add/remove groomers, each with a color (the full Google Calendar palette,
  11 colors including yellow). Seeded with **Mint, Mikka, Boat**.
- **Admins** — add/remove people who can log into the app, each with their own name + PIN.
- **Calendar** — connect a Google account and set the shared Calendar ID that bookings sync to.

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
matching Calendar event (title = `Name · Breed`, color = the groomer's, duration = the sum
of that booking's service hours, recurrence = the chosen repeat rule + until date); deleting
a booking removes its event.

The connection lasts about an hour (browser memory only, nothing persisted) — reconnect
anytime from the Calendar tab. If it's not connected, bookings still save normally; Calendar
sync is always best-effort and never blocks or undoes a save.

### Switching from the demo calendar to the real one
Once testing looks good: share the shop's real Google Calendar with whichever account(s)
will connect (give them "Make changes to events" permission), add that account under
*Test users* in step 2 above, then just paste the real Calendar ID into the app's Calendar
tab and reconnect — no code changes needed.
