# WhatsApp automation

NG Home can send WhatsApp messages by itself:

| When | Who gets it | Message |
| --- | --- | --- |
| The maintenance bills are **published** | each flat's contact | the amount due and the due date |
| On the **reminder days** (5th and 10th unless changed), if the flat has not paid | each flat that still owes | your own reminder wording (Settings → WhatsApp Reminder) |
| A **late fine is added** to an unpaid bill | the flat's contact | the fine and the new amount due |
| A payment is **approved**, or the admin marks a flat paid | the person who paid | "we received ₹X", and any balance still due |

A flat's contact is its **tenant**, or its **owner** if there is no tenant (among the people who have a phone number).

## How it works

Events never send. They add a row to an outbox table (`whatsapp_messages`) and carry on, so a slow or logged-out
WhatsApp can never delay or fail a bill, a payment or a login. A background worker on the API server sends the rows
one at a time through [OpenWA](https://github.com/rmyndharis/OpenWA) (a self-hosted WhatsApp gateway):

- **9 am – 8 pm India time only.** Anything created at night waits for the morning.
- **6–14 seconds between messages**, random, and at most **250 a day** (`WHATSAPP_SEND_GAP_*`, `WHATSAPP_DAILY_CAP`).
- **Once per event.** Each message has a key, so running a job twice, or retrying, never sends twice. The key is also sent
  to OpenWA as its `Idempotency-Key`.
- **Stops cleanly.** If OpenWA is down, the session is logged out, or the API key is wrong, nothing is lost: messages stay
  queued and go out when it is back. A message that fails is retried twice more, 15 and 30 minutes later, then marked
  failed (a number that is not on WhatsApp is marked failed at once).
- A flat that has already **submitted a payment waiting for approval** is not reminded.

The late-fine message goes out when the fine is **actually added**, which is the day after the due date plus the grace
days in Settings → Billing. With a due date of the 10th and **grace days = 0**, that is the 11th. With grace days of 5 it
would be the 16th, because that is when the fine is really charged.

## One-time setup (the platform owner)

WhatsApp messages come from **one phone number** that is linked to OpenWA. Use a **dedicated number** (an inexpensive
SIM), not your personal one. OpenWA is an unofficial client, so WhatsApp can restrict or ban the number; the pacing above
keeps the risk low but cannot remove it. Keep email and the in-app notification as the fallback: they always go out.

1. **Deploy OpenWA** (Docker, on the same Coolify server as the API is simplest):
   `docker compose -f docker-compose.dev.yml up -d` from the OpenWA repository, or add it as a Coolify service. Set
   `SEND_PACING_ENABLED=true` for it as well. Keep it on a private network if you can; it needs only to be reachable from
   the API.
2. **Get its API key**: `docker exec openwa-api cat /app/data/.api-key`.
3. **Create a session and link the phone**: in the OpenWA dashboard (port 2785) create a session, start it, and scan the
   QR code from the dedicated number (WhatsApp → Linked devices → Link a device). Note the **session id**.
4. **Tell the API about it**, in the API's environment (Coolify), then redeploy the API:

   ```
   WHATSAPP_API_URL=http://<openwa-host>:2785
   WHATSAPP_API_KEY=<the key from step 2>
   WHATSAPP_SESSION_ID=<the session id from step 3>
   ```

5. **Each society** then switches it on: Settings → WhatsApp Automation. The card shows "Connected — sending from +…", the
   day's counts, and the latest messages. **Send a test** to your own number first.

## Checking on it

- Settings → WhatsApp Automation shows whether WhatsApp is connected, how many messages are waiting, how many were sent today
  and how many failed this week.
- If the status says the session is `qr_ready` or `disconnected`, the phone was unlinked: open the OpenWA dashboard and scan
  the QR code again. Queued messages then go out by themselves.
- Switching a society's automation **off** stops anything still waiting for it.
