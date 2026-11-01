# WhatsApp automation

NG Home can send WhatsApp messages by itself:

| When | Who gets it | Message |
| --- | --- | --- |
| The maintenance bills are **published** | each flat's contact | the amount due and the due date |
| On the **reminder days** (5th and 10th unless changed), if the flat has not paid | each flat that still owes | your own reminder wording |
| A **late fine is added** to an unpaid bill | the flat's contact | the fine and the new amount due |
| A payment is **approved**, or the admin marks a flat paid | the person who paid | "we received ₹X", and any balance still due |

A flat's contact is its **tenant**, or its **owner** if there is no tenant (among the people who have a phone number).

Everything is set up in the app: the phone is linked once in the **Platform console → Settings → WhatsApp messages**, and each society switches the messages on, and sets the reminder wording and days, under **Settings → Billing Rules → WhatsApp**. Nothing has to be set in Coolify except
running the WhatsApp gateway itself.

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
- **Reconnects by itself.** If the linked session has merely dropped (for example OpenWA was restarted), the sender starts
  it again, at most once every ten minutes. A session that needs a new QR scan is not restarted in a loop.
- A flat that has already **submitted a payment waiting for approval** is not reminded.

The late-fine message goes out when the fine is **actually added**, which is the day after the due date plus the grace
days in Settings → Billing. With a due date of the 10th and **grace days = 0**, that is the 11th. With grace days of 5 it
would be the 16th, because that is when the fine is really charged.

## One-time setup (the platform owner)

WhatsApp messages come from **one phone number** that is linked to OpenWA. Use a **dedicated number** (an inexpensive
SIM), not your personal one. OpenWA is an unofficial client, so WhatsApp can restrict or ban the number; the pacing above
keeps the risk low but cannot remove it. Keep email and the in-app notification as the fallback: they always go out.

1. **Run OpenWA** on your server (Docker, on the same Coolify server as the API is simplest). Give it a **persistent
   volume** for `/app/data`, and set `AUTO_START_SESSIONS=true` so it brings a linked session back after a restart.
   Set `SEND_PACING_ENABLED=true` as well. Keep it on a private network if you can; it only needs to be reachable from the API.
2. **Get its API key**: `docker exec openwa-api cat /app/data/.api-key`.
3. Sign in to the **Platform console** and open **Settings → WhatsApp messages** (platform admins only; one number serves every society):
   enter the gateway address (for example `http://openwa:2785`) and the key, and press **Save gateway**.
4. Press **Connect a phone**. A QR code appears. On the dedicated number's phone: WhatsApp → Linked devices → Link a
   device → scan it. The panel then shows "Linked to +…".
5. Then, in a society's **Settings → Billing Rules → WhatsApp**, switch **Send WhatsApp messages automatically** on, press **Send test** to your own number first, then **Save WhatsApp Settings**.

The connection saved in the app wins over the `WHATSAPP_API_URL`, `WHATSAPP_API_KEY` and `WHATSAPP_SESSION_ID`
environment variables, which still work as a fallback if you prefer them. The key is stored encrypted and never shown again.

## Does it stay logged in?

Yes. Scanning the QR code links the number once, and OpenWA keeps that link on its data volume, so it survives restarts and
redeploys of both OpenWA and NG Home. You scan again only if:

- you **unlink** the device on the phone (WhatsApp → Linked devices) or press **Unlink this phone** in the app;
- the OpenWA **data volume is lost or recreated**;
- the phone has been **offline for about two weeks** (WhatsApp's own rule for linked devices): keep it charged and online;
- WhatsApp **restricts or bans** the number.

Settings → Billing Rules → WhatsApp shows whether it is connected, how many messages are waiting, and how many failed. If it
says the session needs a QR code, open the Platform console → Settings → WhatsApp messages and press **Connect a phone** again. Queued messages then go out
by themselves.
