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

## Files
| File | Purpose |
|------|---------|
| `index.html` | Page shell + login gate |
| `styles.css` | Styling |
| `firebase-config.js` | Your Firebase project's connection details (fill in, see setup above) |
| `db.js` | Firestore storage + per-admin PIN auth |
| `app.js` | App logic & screens |

## Google Calendar (next phase — not wired yet)
The data is already shaped for it:
- Each **groomer** carries a Google Calendar `calendarColorId` (colors map to Calendar's palette).
- Each **booking** has a reserved `calendarEventId`, a `recurrence` value that maps to an
  RRULE (`weekly` → `FREQ=WEEKLY`, `biweekly` → `FREQ=WEEKLY;INTERVAL=2`, `monthly` → `FREQ=MONTHLY`),
  an optional `recurrenceUntil` end date, and `serviceHours` (hours per service) to compute
  the event's duration.

**Planned:** on saving a booking, create/update a Calendar event whose **title** = `Name · Breed`,
**color** = groomer's color, **duration** = sum of `serviceHours`, and **recurrence** = the
chosen repeat rule (+ until date); deleting removes the event. This needs a Google OAuth
client (Calendar API) — I'll add a "Connect Google Calendar" button then.
