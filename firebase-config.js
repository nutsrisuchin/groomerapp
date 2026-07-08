/* ===================================================================
   firebase-config.js — YOUR project's connection details.
   Safe to commit/publish: these values are not secret. Access to your
   data is controlled by Firestore Security Rules + the shop PIN login,
   not by hiding this file.

   Fill in the 6 values below from:
   Firebase Console → Project settings (gear icon) → General →
   "Your apps" → Web app → SDK setup and configuration → Config
=================================================================== */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDBevWEX2vrHSOw-Z1gMCLIcFdRlCWyqi0",
  authDomain: "alpine-surge-501717-v9.firebaseapp.com",
  projectId: "alpine-surge-501717-v9",
  storageBucket: "alpine-surge-501717-v9.firebasestorage.app",
  messagingSenderId: "478232956382",
  appId: "1:478232956382:web:12c3937cb4589c50a9e14f",
};

/* The "Owner" login (see README) is this fixed bootstrap account — always
   trusted, so you can't get locked out. In Firebase Console → Authentication
   → Sign-in method, enable "Email/Password", then Authentication → Users →
   Add user, and create exactly this email with the Owner PIN (6+ characters)
   as the password. Everyone else gets their own name + PIN via the app's
   Admins section, which creates additional Firebase Auth logins behind the
   scenes — no need to touch this file again. */
const SHOP_LOGIN_EMAIL = "admin@groomingdale.com";

/* Google Calendar connection (see README). Not secret — this is a public
   OAuth client id, safe to publish. Created in Google Cloud Console →
   APIs & Services → Clients, with Authorized JavaScript origin set to
   this app's exact hosted origin (e.g. https://yourname.github.io). */
const GOOGLE_CLIENT_ID = "478232956382-47bodt6g72l7bqj8a8ql8e7566kbegnk.apps.googleusercontent.com";
