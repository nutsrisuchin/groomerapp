/* ===================================================================
   calendar.js — Google Calendar sync for Pawfect Grooming Studio.

   Uses Google Identity Services (GIS) for a client-side-only OAuth2
   token (no backend needed). The token lives ~1 hour and only in
   memory — whoever's using the app just clicks "Connect Google
   Calendar" again if it expires. Booking sync is always best-effort:
   a Firestore write always succeeds/fails on its own; the Calendar
   call happens after, and failures there never block or undo it.

   Exposes a small promise-based API on window.GCal.
=================================================================== */
(function () {
  let accessToken = null;
  let tokenExpiry = 0;

  function whenGisReady() {
    return new Promise((resolve) => {
      if (window.google && google.accounts && google.accounts.oauth2) { resolve(); return; }
      const check = setInterval(() => {
        if (window.google && google.accounts && google.accounts.oauth2) { clearInterval(check); resolve(); }
      }, 100);
    });
  }

  const api = {};

  api.isConnected = () => !!accessToken && Date.now() < tokenExpiry;
  api.disconnect = () => { accessToken = null; tokenExpiry = 0; };

  // Must be called from directly inside a user click handler (popup permission).
  api.connect = async function () {
    await whenGisReady();
    return new Promise((resolve, reject) => {
      const tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: "https://www.googleapis.com/auth/calendar.events",
        callback: (resp) => {
          if (resp.error) { reject(new Error(resp.error)); return; }
          accessToken = resp.access_token;
          tokenExpiry = Date.now() + (Number(resp.expires_in) || 3500) * 1000;
          resolve();
        },
      });
      tokenClient.requestAccessToken({ prompt: "" });
    });
  };

  async function call(method, calendarId, path, body) {
    if (!api.isConnected()) throw new Error("not-connected");
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${path}`;
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) { accessToken = null; throw new Error("token-expired"); }
    if (!res.ok) throw new Error(`calendar-api-${res.status}`);
    return res.status === 204 ? null : res.json();
  }

  const RRULE_BASE = { weekly: "FREQ=WEEKLY", biweekly: "FREQ=WEEKLY;INTERVAL=2", monthly: "FREQ=MONTHLY" };

  function buildEventBody(booking, groomer) {
    const hours = Object.values(booking.serviceHours || {}).reduce((a, v) => a + (Number(v) || 0), 0) || 1;
    const end = new Date(new Date(booking.start).getTime() + hours * 3600 * 1000).toISOString();
    const event = {
      summary: booking.breed ? `${booking.petName} · ${booking.breed}` : booking.petName,
      start: { dateTime: booking.start },
      end: { dateTime: end },
    };
    if (groomer && groomer.calendarColorId) event.colorId = groomer.calendarColorId;
    if (booking.recurrence && booking.recurrence !== "none" && RRULE_BASE[booking.recurrence]) {
      let rule = RRULE_BASE[booking.recurrence];
      if (booking.recurrenceUntil) rule += `;UNTIL=${booking.recurrenceUntil.replace(/-/g, "")}T235959Z`;
      event.recurrence = [`RRULE:${rule}`];
    }
    return event;
  }

  // Creates or updates the Calendar event for a booking. Returns the event id.
  api.syncBooking = async function (calendarId, booking, groomer) {
    const body = buildEventBody(booking, groomer);
    if (booking.calendarEventId) {
      try {
        const updated = await call("PATCH", calendarId, `/${booking.calendarEventId}`, body);
        return updated.id;
      } catch (err) {
        if (String(err.message) !== "calendar-api-404") throw err;
        // Event was removed on the Calendar side — fall through and recreate it.
      }
    }
    const created = await call("POST", calendarId, "", body);
    return created.id;
  };

  api.deleteBooking = async function (calendarId, eventId) {
    if (!eventId) return;
    try { await call("DELETE", calendarId, `/${eventId}`); }
    catch (err) { if (String(err.message) !== "calendar-api-404") throw err; }
  };

  window.GCal = api;
})();
