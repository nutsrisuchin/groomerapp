/* ===================================================================
   db.js — Firestore-backed storage + per-admin PIN auth for
   Pawfect Grooming Studio.

   Stores "pets", "groomers", "bookings", "admins" as top-level
   Firestore collections, keyed by our own uid (not Firestore's auto
   id) so DB.put()/DB.del() stay simple. Every device that's signed
   in gets the same data live via onSnapshot — no manual refresh needed.

   Auth: each admin is a real Firebase Auth user, identified by an
   email derived from their name (e.g. "Mint" -> mint@pawfect.local),
   with their PIN as the password. This is a real server-side check
   (not just a UI gate). The bootstrap "Owner" account is the one
   manually created in the Firebase Console (SHOP_LOGIN_EMAIL) —
   Firestore Security Rules should always trust that email, plus
   anyone with a doc in the "admins" collection, e.g.:

     function isAdmin() {
       return request.auth != null &&
         (request.auth.token.email == 'shop@pawfect.local' ||
          exists(/databases/$(database)/documents/admins/$(request.auth.uid)));
     }
     match /{document=**} { allow read, write: if isAdmin(); }

   Removing someone from the "admins" collection revokes their data
   access immediately, even though their underlying Firebase Auth
   login isn't deleted (the client SDK can only delete the *current*
   user, not arbitrary others — full deletion needs the Firebase
   Console or a backend).

   Exposes a small promise-based API on window.DB.
=================================================================== */
(function () {
  firebase.initializeApp(FIREBASE_CONFIG);
  const auth = firebase.auth();
  const store = firebase.firestore();

  // Session persists across refreshes/reopens (Firebase's default) — Google Calendar
  // always needs reconnecting fresh regardless (that's a separate, deliberately
  // memory-only connection; see calendar.js), and the app-wide banner already prompts
  // for that independent of login state, so forcing a fresh PIN entry too added no
  // real benefit. Every collection re-syncs live via onSnapshot regardless of how the
  // session started, so an auto-resumed session reaching app logic before Firestore's
  // first snapshot arrives just means a brief flash of empty state, not stale data.
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
    .catch((err) => console.error("Failed to set auth persistence", err));

  const cache = { pets: [], groomers: [], bookings: [], admins: [] };
  const col = (name) => store.collection(name);

  const api = {};

  api.uid = function (prefix) {
    return (prefix || "id") + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  };

  // One-time paginated read of a collection ordered by `at` (newest first) — used by the
  // "Activity history" load-more list. This is a plain .get(), NOT a live listener, so it bills
  // once per call (the batch size) and never re-reads on its own. `afterAt` is the `at` value to
  // start after (pass the oldest `at` already loaded); omit for the first page. Single-field
  // order → auto-indexed, no composite index needed.
  api.getPage = async function (name, { afterAt = null, limit = 50 } = {}) {
    let q = col(name).orderBy("at", "desc");
    if (afterAt != null) q = q.startAfter(afterAt);
    const snap = await q.limit(limit).get();
    return snap.docs.map((d) => d.data());
  };

  // Reads come from the live local cache kept in sync by onSnapshot (see api.watch).
  api.getAll = (name) => Promise.resolve(cache[name] || []);
  api.get = (name, id) => Promise.resolve((cache[name] || []).find((x) => x.id === id));
  api.put = (name, val) => col(name).doc(val.id).set(val).then(() => val);
  api.del = (name, id) => col(name).doc(id).delete();

  // Collections we only ever need the most-recent slice of, kept live. The activity/notifications
  // log grows one doc per action forever, yet the UI only shows the newest handful — subscribing
  // to the whole collection meant re-reading the ENTIRE history on every app open, which was the
  // dominant Firestore read cost (reads climbed as the log grew). Cap the live listener to the
  // newest N by timestamp instead; older rows stay in the database, they're just not downloaded.
  // Keep N comfortably above what any view actually shows (Home shows 8). No composite index is
  // needed — ordering on a single field (`at`) is auto-indexed.
  const WATCH_LIMITS = { activity: 50 };

  // Subscribes to a collection; cb(name) fires on every change (including this device's own writes).
  // Returns an unsubscribe function.
  api.watch = function (name, cb) {
    let ref = col(name);
    const limit = WATCH_LIMITS[name];
    if (limit) ref = ref.orderBy("at", "desc").limit(limit);
    return ref.onSnapshot(
      (snap) => { cache[name] = snap.docs.map((d) => d.data()); cb(name); },
      (err) => console.error("Firestore listen failed for", name, err)
    );
  };

  api.seed = async function () {
    const snap = await col("groomers").get();
    if (snap.empty) {
      const defaults = [
        { name: "Mint", color: "#0b8043", calendarColorId: "10" }, // Basil
        { name: "Mikka", color: "#e67c73", calendarColorId: "4" }, // Flamingo
        { name: "Boat", color: "#3f51b5", calendarColorId: "9" },  // Blueberry
      ];
      for (const g of defaults) {
        const rec = { id: api.uid("grm"), createdAt: Date.now(), ...g };
        await col("groomers").doc(rec.id).set(rec);
      }
    }
  };

  // ---- per-admin PIN auth ----
  api.login = (email, pin) => auth.signInWithEmailAndPassword(email, pin);
  api.logout = () => auth.signOut();
  api.onAuthChange = (cb) => auth.onAuthStateChanged(cb);
  api.currentUid = () => (auth.currentUser ? auth.currentUser.uid : null);
  api.currentEmail = () => (auth.currentUser ? auth.currentUser.email : null);

  // Creates a new admin's Firebase Auth login *without* signing the current
  // admin out, by spinning up a throwaway secondary Firebase app instance —
  // the standard client-side workaround since the SDK only ever manages
  // "the current user" on the primary app.
  api.createAdmin = async function ({ name, email, pin, role }) {
    const secondary = firebase.initializeApp(FIREBASE_CONFIG, "secondary-" + Date.now());
    try {
      const cred = await secondary.auth().createUserWithEmailAndPassword(email, pin);
      const uid = cred.user.uid;
      await secondary.auth().signOut();
      const rec = { id: uid, uid, name, email, role: role || "admin", createdAt: Date.now() };
      await col("admins").doc(uid).set(rec);
      return rec;
    } finally {
      await secondary.delete();
    }
  };
  // Revokes data access for this admin (removes them from the "admins" collection).
  // Does not delete their underlying Firebase Auth login — see file header.
  api.removeAdmin = (uid) => col("admins").doc(uid).delete();

  window.DB = api;
})();
