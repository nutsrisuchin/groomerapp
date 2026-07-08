/* ===================================================================
   calendar.js — Google Calendar sync for Pawfect Grooming Studio.

   Uses Google Identity Services (GIS) for a client-side-only OAuth2
   token (no backend needed). The token lives ~1 hour; once connected,
   this module auto-renews it silently (no popup) about 5 minutes
   before it expires, so it stays connected for as long as the browser
   tab stays open and the Google session is still active — no repeated
   manual clicks. If the silent renewal ever fails (Google session
   logged out, consent revoked, etc.), it falls back to "not connected"
   and a manual Connect click is needed. Booking sync is always
   best-effort: a Firestore write always succeeds/fails on its own; the
   Calendar call happens after, and failures there never block or undo it.

   Exposes a small promise-based API on window.GCal.
=================================================================== */
(function () {
  let accessToken = null;
  let tokenExpiry = 0;
  let tokenClient = null;
  let refreshTimer = null;
  let pending = null; // { resolve, reject } for an in-flight explicit connect()
  let statusListener = null;

  function whenGisReady() {
    return new Promise((resolve) => {
      if (window.google && google.accounts && google.accounts.oauth2) { resolve(); return; }
      const check = setInterval(() => {
        if (window.google && google.accounts && google.accounts.oauth2) { clearInterval(check); resolve(); }
      }, 100);
    });
  }

  function scheduleSilentRefresh(expiresInSec) {
    clearTimeout(refreshTimer);
    const delayMs = Math.max(expiresInSec - 300, 10) * 1000; // renew 5 min before expiry
    refreshTimer = setTimeout(() => { if (tokenClient) tokenClient.requestAccessToken({ prompt: "" }); }, delayMs);
  }

  function handleTokenResponse(resp) {
    if (resp.error) {
      accessToken = null; tokenExpiry = 0;
      if (pending) { pending.reject(new Error(resp.error)); pending = null; }
      if (statusListener) statusListener(false);
      return;
    }
    accessToken = resp.access_token;
    const expiresIn = Number(resp.expires_in) || 3500;
    tokenExpiry = Date.now() + expiresIn * 1000;
    scheduleSilentRefresh(expiresIn);
    if (pending) { pending.resolve(); pending = null; }
    if (statusListener) statusListener(true);
  }

  async function ensureTokenClient() {
    if (tokenClient) return;
    await whenGisReady();
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: "https://www.googleapis.com/auth/calendar.events",
      callback: handleTokenResponse,
    });
  }

  const api = {};

  api.isConnected = () => !!accessToken && Date.now() < tokenExpiry;
  api.disconnect = () => { accessToken = null; tokenExpiry = 0; clearTimeout(refreshTimer); };
  // Notified on every silent renewal success/failure too, so the UI can react without a click.
  api.onStatusChange = (fn) => { statusListener = fn; };

  // Must be called from directly inside a user click handler the first time (popup permission).
  api.connect = async function () {
    await ensureTokenClient();
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
      tokenClient.requestAccessToken({ prompt: "" });
    });
  };

  async function call(method, calendarId, path, body, retried) {
    if (!api.isConnected()) {
      if (retried) throw new Error("not-connected");
      try { await api.connect(); } catch (err) { throw new Error("not-connected"); }
    }
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${path}`;
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      accessToken = null;
      if (!retried) { try { return await call(method, calendarId, path, body, true); } catch (err) { /* fall through */ } }
      throw new Error("token-expired");
    }
    if (!res.ok) {
      let detail = "";
      try {
        const text = await res.text();
        try {
          const parsed = JSON.parse(text);
          detail = (parsed && parsed.error && (parsed.error.message || (parsed.error.errors && parsed.error.errors[0] && parsed.error.errors[0].message))) || text;
        } catch (parseErr) { detail = text; } // not JSON — show the raw body, whatever it is
      } catch (readErr) { /* couldn't read the body at all */ }
      throw new Error(`calendar-api-${res.status}${detail ? `: ${detail}` : ""}`);
    }
    return res.status === 204 ? null : res.json();
  }

  const RRULE_BASE = { weekly: "FREQ=WEEKLY", biweekly: "FREQ=WEEKLY;INTERVAL=2", monthly: "FREQ=MONTHLY" };

  function buildEventBody(booking, groomer) {
    const hours = Object.values(booking.serviceHours || {}).reduce((a, v) => a + (Number(v) || 0), 0) || 1;
    const end = new Date(new Date(booking.start).getTime() + hours * 3600 * 1000).toISOString();
    const parts = [booking.petName, booking.breed, (booking.services || []).join(", ")].filter(Boolean);
    // Google rejects the request outright ("Missing time zone definition") if it can't be
    // certain the dateTime is unambiguous — always pin an explicit IANA zone as a safety
    // net, even though booking.start should normally already carry a "Z"/UTC offset.
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const event = {
      summary: parts.join(" "),
      start: { dateTime: booking.start, timeZone },
      end: { dateTime: end, timeZone },
    };
    if (groomer && groomer.calendarColorId) event.colorId = groomer.calendarColorId;
    if (booking.recurrence && booking.recurrence !== "none" && RRULE_BASE[booking.recurrence]) {
      let rule = RRULE_BASE[booking.recurrence];
      if (booking.recurrenceUntil) rule += `;UNTIL=${booking.recurrenceUntil.replace(/-/g, "")}T235959Z`;
      event.recurrence = [`RRULE:${rule}`];
    }
    return event;
  }

  // 404 (never existed / already purged) and 410 (Google's "already deleted" response for
  // an event it still remembers as cancelled) both mean the same thing for our purposes:
  // there's nothing left to delete/update on Calendar's side.
  function isGoneError(err) {
    const msg = String(err.message);
    return msg.startsWith("calendar-api-404") || msg.startsWith("calendar-api-410");
  }

  // Creates or updates the Calendar event for a booking. Returns the event id.
  api.syncBooking = async function (calendarId, booking, groomer) {
    const body = buildEventBody(booking, groomer);
    if (booking.calendarEventId) {
      try {
        const updated = await call("PATCH", calendarId, `/${booking.calendarEventId}`, body);
        return updated.id;
      } catch (err) {
        if (!isGoneError(err)) throw err;
        // Event was removed on the Calendar side — fall through and recreate it.
      }
    }
    const created = await call("POST", calendarId, "", body);
    return created.id;
  };

  api.deleteBooking = async function (calendarId, eventId) {
    if (!eventId) return;
    try { await call("DELETE", calendarId, `/${eventId}`); }
    catch (err) { if (!isGoneError(err)) throw err; }
  };

  window.GCal = api;
})();
