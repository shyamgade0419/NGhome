# Online payments (the society's own Razorpay)

A resident can pay a bill from the app. The payment goes to **the society's own Razorpay account** and Razorpay pays it into
the society's bank. NG Home never receives, holds or moves the money, and has no payment account of its own: it only asks
Razorpay (with the society's keys) to make a payment page for one bill, and later asks whether that page was paid.

It is optional. A society that does not connect Razorpay keeps the existing flow: pay by UPI, submit the reference, an admin approves.

## Setting it up (the society admin)

1. In the Razorpay dashboard: **Account & Settings → API Keys → Generate Key**. Copy the Key ID and the Key Secret (shown once).
   Start with **Test mode** keys (`rzp_test_…`); nothing real is charged. Switch to Live keys (`rzp_live_…`) when happy.
2. In NG Home (web): **Settings → Online Payments**. Paste both, choose the society account the money is credited to in the
   books (the bank account Razorpay pays into), and switch on **Let residents pay online**.
3. NG Home checks the keys with Razorpay before saving, and refuses wrong ones in Razorpay's own words. The Key Secret is stored
   encrypted (AES-256-GCM, the same box as the mail password and the Meta token) and is never sent back to any screen or written
   to the audit log. Leaving the secret blank keeps the saved one; changing the Key ID requires typing the secret again.
4. Payment Links must be available on the Razorpay account. No webhook needs to be set up.

Only the society admin can connect or change it. The accountant can see the connection and the latest payments.

## What a resident sees

**Pay online** on the bill (web: My Bills; app: Submit Payment). They choose the amount (starts at everything owed; more than owed
becomes advance credit, up to the same ceiling as any other payment), and Razorpay's page opens: UPI apps, cards, netbanking. When
they have paid, the bill updates by itself, they get the usual "payment received" notification and the WhatsApp message with the
receipt link. No UTR to type, nothing for an admin to approve.

## How "paid" is decided

Never from the resident's phone and never from a page address. Every time the answer is needed, the server reads the payment link
from Razorpay with the society's own keys:

- the app asks while it waits (every 4 seconds, and the moment the person returns to the app);
- the page Razorpay sends the person back to (`/api/v1/public/online-payments/return`) acts only on a callback signed with the
  society's secret, and even then reads Razorpay for the truth;
- a background pass (every 2 minutes) reads open payments, so a person who paid in their UPI app and never came back is still
  recorded, and retries any that were paid but could not yet be recorded.

A payment is applied **exactly once** however many of these arrive, even at the same instant: the order is claimed atomically, the
Razorpay payment id is unique, and the payment row is unique per (flat, payment id).

## In the books

An online payment is recorded as an approved UPI payment, the same way an approved payment is: the money is credited to the
chosen account, the flat's oldest dues are settled first, the audit trail has a `PAYMENT_APPROVED` entry, and the resident is told.
The ledger line reads "Online payment received — pay_…".

If the books cannot take it (the bill was settled another way meanwhile, or the amount is more than the flat can pay), the money is
already at Razorpay, so it is never dropped: it is left as a **pending payment** with a note, which the admin sees in Payments and
settings ("Needs your approval"). They approve it or refund it from the Razorpay dashboard.

## What it does not do

- **Fees.** Razorpay takes its fee before paying the society, so the bank receives slightly less than the amount credited in the
  books. Record the difference as an expense, or adjust the account, as with any bank charge. Check Razorpay for current rates.
- **Refunds** are made in the Razorpay dashboard. A refunded payment is not reversed automatically in NG Home.
- **Settlement timing** is Razorpay's (a day or two). The books are credited when the payment is confirmed.
- A payment page lasts one hour. After that it expires, no money is taken, and the resident starts again (at most 5 unfinished
  payments per person at a time).

## For developers

- Tables: `society_payment_gateway` (keys, account, switch; one row per society) and `gateway_orders` (one row per started payment).
- Code: `App/src/online-payments/` (`razorpay.ts` client and signature check, `online-payments.service.ts`, controllers, background
  job, return page) and `PaymentsService.recordOnline` (the settlement).
- `RAZORPAY_API_BASE` overrides Razorpay's host (tests only). `ONLINE_PAYMENTS_JOB=off` stops the background pass.
- Tests: `online-payments/razorpay.spec.ts` (unit) and `test/online-payments.e2e-spec.ts` (real Postgres, a fake Razorpay).
