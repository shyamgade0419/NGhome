# Electricity reminders

A flat saves its electricity connection (the company and the consumer number, called the USC in Telangana) and NG Home reminds
the residents on **the 8th of every month** to check and pay the bill. The day can be changed per connection (1st to 28th).

This is a saved number and a reminder. NG Home does **not** fetch the bill, does not know the amount or the due date, and does
**not** take payment. The "Pay" button opens the electricity company's own website in the resident's browser.

## For residents

- **App:** Home → Electricity. **Web:** Electricity in the sidebar.
- Choose the company from the list (or **Other**, naming it and optionally giving its own https website), enter the consumer
  number as printed on the bill, optionally give it a name ("Flat meter"), pick the day, and save.
- Each connection has a reminder switch, shows "Next reminder: 8 Dec 2026", and has a **Pay on the company's website** button.
- A flat can save up to 5 connections. The same number cannot be saved twice for a flat, however it is typed (spaces and capitals
  are ignored).

## The reminder

- Sent from **9 a.m. India time** on the chosen day, once a month, as an in-app notification and a phone alert (with sound) to
  **every resident of the flat**.
- Wording: "Time to check your electricity bill: Check and pay your *name* bill (consumer no. •••• 1234) before it is due." Only the
  last four characters of the number appear, since a notification can be read on a locked screen.
- If the server was down on the day, the reminder is still sent for up to two days after, then skipped until next month.
- Running the job twice, or on two servers at once, sends it once: the month is claimed with one atomic update first.
- Tapping the alert opens the Electricity screen.

## Privacy

A consumer number is personal. Only the flat's own residents can list, change or remove its connections; the society admin cannot
list them, and another flat's connection cannot be reached even by guessing its id. Numbers are stored in plain text (they are not
secrets, only personal), scoped by society and flat, and removed when the connection is removed or the society is deleted.

## The list of companies

The list (name, region, main website) lives on the server in `App/src/utilities/utility-providers.ts` and is sent to the apps, so a
wrong or moved address can be corrected without a new app release. The addresses there are each company's main website, written
from memory: **confirm them, and add the companies your societies use.**

## For developers

- Table `utility_connections`; API `GET/POST /utility-connections`, `PATCH/DELETE /utility-connections/:id`, `GET /utility-connections/providers`.
- The monthly job is `NotificationSchedulerService.utilityReminders`, run with the other timed notifications every 15 minutes
  (off in tests and with `NOTIFICATION_JOB=off`).
- Tests: `utilities/utility-reminders.spec.ts` (date logic, wording), `test/utility-connections.e2e-spec.ts` (real Postgres),
  and the app's `electricity-screen.test.tsx`.

## Later: showing the real bill

Showing "₹1,240 due on 25 Nov" automatically would need a BBPS (Bharat BillPay) partner: a company that fetches bills by consumer
number from the electricity company through an API, under a commercial agreement. That is deliberately not part of this.
