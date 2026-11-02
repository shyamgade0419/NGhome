# WhatsApp automation

NG Home can send WhatsApp messages by itself:

| When | Who gets it | Message |
| --- | --- | --- |
| The maintenance bills are **published** | each flat's contact | the amount due and the due date |
| On the **reminder days** (5th and 10th unless changed), if the flat has not paid | each flat that still owes | your own reminder wording |
| A **late fine is added** to an unpaid bill | the flat's contact | the fine and the new amount due |
| A payment is **approved**, or the admin marks a flat paid | the person who paid | "we received ₹X", and any balance still due |

A flat's contact is its **tenant**, or its **owner** if there is no tenant (among the people who have a phone number).

**Each society uses its own WhatsApp number**, in one of two ways that the society chooses between (Settings → Billing Rules →
WhatsApp → *How your messages are sent*):

| | Link my own number (OpenWA) | Official WhatsApp Business (Meta Cloud API) |
| --- | --- | --- |
| What it is | the society scans a QR code with a dedicated SIM; the platform's OpenWA gateway runs it | the society's own Meta WhatsApp Business account |
| Cost | free (the server's memory: 300–500 MB per number) | Meta bills the society's own account per delivered message; NG Home adds nothing |
| Ban risk | yes, it is unofficial, so sending is slow, daytime-only, capped | none |
| Wording | the society's own reminder wording; fixed wording for the other three | four fixed templates Meta must approve first |
| Needs the platform's gateway | yes | no |

Either way, one society never sends from another's number and never sees it, and the platform owner's **Allowed** switch on
Platform console → Societies governs both.

## Who does what

| | Where | What |
| --- | --- | --- |
| **Platform owner** | Coolify | runs the OpenWA gateway (once) |
| **Platform owner** | Platform console → Settings → WhatsApp messages | saves the gateway's address and key (once) |
| **Platform owner** | Platform console → Societies → **WhatsApp** pill | allows a society to use WhatsApp (every society starts **Off**) |
| **Society admin** | Settings → Billing Rules → WhatsApp → **Link my own number** | presses **Connect a phone** and scans the QR code with the society's own number |
| **Society admin** | Settings → Billing Rules → WhatsApp → **Official WhatsApp Business** | instead of the QR code: enters the Meta phone number ID, access token and (optionally) Business Account ID, then sends the four templates to Meta |
| **Society admin** | Settings → Billing Rules → WhatsApp | writes the reminder wording, picks the reminder days, sends a test, switches the messages on |

## How it works

Events never send. They add a row to an outbox table (`whatsapp_messages`) and carry on, so a slow or logged-out
WhatsApp can never delay or fail a bill, a payment or a login. A background worker on the API server sends the rows
one at a time through [OpenWA](https://github.com/rmyndharis/OpenWA) (a self-hosted WhatsApp gateway), each society through
its own session:

- **9 am – 8 pm India time only.** Anything created at night waits for the morning.
- **6–14 seconds between messages**, random, and at most **250 a day per number** (`WHATSAPP_SEND_GAP_*`, `WHATSAPP_DAILY_CAP`).
- **Once per event.** Each message has a key, so running a job twice, or retrying, never sends twice. The key is also sent
  to OpenWA as its `Idempotency-Key`.
- **One society never holds up another.** A society whose phone is logged out, or that has reached its daily limit, is
  skipped for that run; the others still send. Its messages wait and go out when it is back.
- **Stops cleanly.** If OpenWA is down or the API key is wrong, nothing is lost: messages stay queued and go out when it is
  back. A message that fails is retried twice more, 15 and 30 minutes later, then marked failed (a number that is not on
  WhatsApp is marked failed at once).
- **Reconnects by itself.** If a society's session has merely dropped (for example OpenWA was restarted), the sender starts it
  again, at most once every ten minutes. A session that needs a new QR scan is not restarted in a loop.
- A flat that has already **submitted a payment waiting for approval** is not reminded.

The late-fine message goes out when the fine is **actually added**, which is the day after the due date plus the grace
days in Settings → Billing. With a due date of the 10th and **grace days = 0**, that is the 11th. With grace days of 5 it
would be the 16th, because that is when the fine is really charged.

## One-time setup (the platform owner)

1. **Run OpenWA** in Coolify with `docs/openwa/docker-compose.yml`: paste it into a *Docker Compose Empty* resource, set the
   `OPENWA_API_KEY` variable to a long random secret, and give the service a domain with port 2785. It sets the persistent
   volume, the automatic restart and the pacing for you.
2. **The gateway key** is the `OPENWA_API_KEY` you just set.
3. Sign in to the **Platform console** and open **Settings → WhatsApp messages** (platform admins only): enter the gateway
   address (the domain you gave it, for example `https://wa.novagade.in`) and the key, and press **Save gateway**.
4. **Allow a society.** In the Platform console open **Societies** and press the **WhatsApp** pill on the society's row so it
   reads **Allowed**. Do this for your own society first.
5. **The society links its number.** The society's admin opens **Settings → Billing Rules → WhatsApp**, presses **Connect a
   phone**, and on the phone with the society's own number scans the QR code (WhatsApp → Linked devices → Link a device). The
   panel then shows "Linked to +…".
6. In the same place: **Send test** to your own number first, switch **Send WhatsApp messages automatically** on, and **Save**.

The gateway address and key saved in the app win over the `WHATSAPP_API_URL` and `WHATSAPP_API_KEY` environment variables,
which still work as a fallback if you prefer them. The key is stored encrypted and never shown again. (`WHATSAPP_SESSION_ID`
is no longer used: each society has its own session.)

## Which societies may use WhatsApp

A society can only link a number and send if you allow it. Platform console → Societies has a **WhatsApp** pill on each row:
**Off** (the default for every society, new ones included) or **Allowed**.

- A society that is Off sees a note in its WhatsApp settings and cannot connect, switch the messages on, or send a test.
- Pressing **Allowed** back to **Off** stops that society straight away, drops anything it still had waiting, and stops its
  session on the gateway to free the memory it uses. Its link to the phone is kept, so allowing it again brings it back.
  What was already sent stays in its history, and no other society is affected.
- A suspended or deleted society never sends and its session is stopped. Erasing a society for good removes its session from
  the gateway.
- Each change is recorded in the audit log.

## Memory: how many societies the server can carry

Every linked number runs its own browser inside OpenWA, which uses roughly **300–500 MB**. The compose file limits the
container to 2 GB, which fits about three societies. For more, raise `mem_limit` in the compose file (and make sure the
server has the memory), or switch OpenWA to its lighter engine, which uses far less but carries a higher ban risk. The Platform
console card shows every linked number and its status, and flags any session on the gateway that belongs to no society.

## Does it stay logged in?

Yes. Scanning the QR code links a number once, and OpenWA keeps that link on its data volume, so it survives restarts and
redeploys of both OpenWA and NG Home. A society scans again only if:

- it **unlinks** the device on the phone (WhatsApp → Linked devices) or presses **Unlink this number** in the app;
- the OpenWA **data volume is lost or recreated**;
- the phone has been **offline for about two weeks** (WhatsApp's own rule for linked devices): keep it charged and online;
- WhatsApp **restricts or bans** the number.

Settings → Billing Rules → WhatsApp shows whether the society's number is connected, how many messages are waiting, and how
many failed. If it says the number needs a QR code, press **Connect a phone** again. Queued messages then go out by themselves.

A ban or a logout affects only the society whose number it is.

## The official WhatsApp Business option (Meta Cloud API)

A society that wants no QR code and no ban risk connects its own Meta WhatsApp Business account. It is the society's account,
so the society pays Meta directly and the platform owner has nothing to set up.

**What the society needs from Meta:** a business account with a WhatsApp number registered to the Cloud API, a payment method
in WhatsApp Manager, the **Phone number ID**, a **token** (a system-user token with `whatsapp_business_messaging` and
`whatsapp_business_management`, because the 24-hour test token expires), and, so NG Home can create the templates for it, the
**WhatsApp Business Account ID**.

**Templates.** WhatsApp lets a business send free text only within 24 hours of the person messaging it, so every automatic
message goes as a template Meta approved beforehand. NG Home has four, in the UTILITY category: `ng_bill_published`,
`ng_payment_reminder`, `ng_late_fine` and `ng_payment_received`. **Send the missing templates to Meta** creates them on the
society's account, and the panel shows each one's verdict (Waiting for Meta, Approved, Rejected). Approval usually takes minutes
to a day. Until all four are approved, messages wait in the queue. The wording is fixed once approved, so the society's own
reminder wording applies only to WhatsApp links sent by hand. The templates are defined in
`App/src/whatsapp/whatsapp-cloud-templates.ts`.

**How it behaves.**

- Connecting checks the details with Meta first, so a wrong id or token is refused with Meta's own explanation. The token is
  stored encrypted and never shown again; a blank token field keeps the saved one.
- The same outbox, the same rules about who gets a message (tenant, else owner), the same reminder days, once per event, and
  the same 9 am to 8 pm window. There is no 250-a-day cap of our own and the 6 to 14 second gap is only 0.25 s, because Meta
  has its own limits and nothing here can get the number banned.
- If Meta refuses the token, the account is limited, or a template is not approved, only that society's messages wait (the
  others still send) and its settings screen says why. A number that is not on WhatsApp, or not on the account's test list,
  fails that one message.
- **Send test** sends Meta's own pre-approved `hello_world` template, since a test to a number that never messaged the business
  has to be a template too.
- Choosing the other way, or disconnecting, drops what was waiting, because it was written for the other way. Moving to Meta also
  stops the society's OpenWA session to free the gateway's memory; the link to the phone is kept.
- Not built: Meta's webhook for delivery receipts (a message shows Sent once Meta accepts it, not Delivered or Read), and
  replies from residents are not read.

Environment (optional): `WHATSAPP_CLOUD_API_VERSION` (default `v21.0`), `WHATSAPP_CLOUD_API_BASE` (default
`https://graph.facebook.com`), `WHATSAPP_CLOUD_GAP_MS` (default 250).
