/**
 * The NG Home user guide — one source for the website (Site/app/help) and the in-app Help Center
 * (Web/app/(dashboard)/help). Plain data, so both render it their own way.
 *
 * Keep this file identical in Web/lib/guide.ts and Site/lib/guide.ts (the site is its own repository,
 * so it cannot import from here). Screenshots live in public/help/ in both.
 *
 * Inline formatting in text: **bold** and `code`.
 */

export type Block =
  | { type: 'p'; text: string }
  | { type: 'steps'; items: string[] }
  | { type: 'list'; items: string[] }
  | { type: 'tip'; text: string }
  | { type: 'warn'; text: string }
  | { type: 'shot'; src: string; alt: string; caption: string }
  | { type: 'table'; head: string[]; rows: string[][] };

export interface GuideSection {
  id: string;
  title: string;
  /** Who this section is for. */
  audience: 'admin' | 'resident' | 'everyone';
  /** One line, shown in the contents. */
  summary: string;
  blocks: Block[];
}

export interface GuidePart {
  id: string;
  title: string;
  intro: string;
  sections: GuideSection[];
}

export const GUIDE_UPDATED = '30 October 2026';

export const GUIDE: GuidePart[] = [
  /* ───────────────────────────── Getting started ───────────────────────────── */
  {
    id: 'start',
    title: 'Getting started',
    intro: 'What NG Home does, who uses it, and how to set a new society up from nothing to its first bill.',
    sections: [
      {
        id: 'overview',
        title: 'What NG Home is',
        audience: 'everyone',
        summary: 'One app for maintenance billing, money, the gate and day-to-day community life.',
        blocks: [
          { type: 'p', text: 'NG Home runs an apartment society: it raises the monthly maintenance bill, collects payments, keeps the society\'s accounts, and handles the gate (visitors, parcels, household help, vehicles, staff), plus complaints, notices and documents. It is free to use.' },
          { type: 'p', text: 'It works on the **web** (for the committee, who do most of the setup and accounts) and on the **mobile app** for Android (for residents, and for the security guard at the gate). Both talk to the same data, so what a resident does on their phone appears for the admin on the web at once.' },
          { type: 'table', head: ['Who', 'Typically uses', 'For'], rows: [
            ['Society admin', 'Web and mobile', 'Everything: settings, billing, payments, accounts, residents.'],
            ['Accountant', 'Web and mobile', 'Billing, payments, expenses, accounts and reports. Cannot change roles or waive fines.'],
            ['Committee member', 'Mobile and web', 'The gate log and approvals, household help, vehicles and parking, staff attendance.'],
            ['Security guard', 'Mobile only', 'The gate: visitors, parcels, household help, vehicles and staff check-in.'],
            ['Resident (owner or tenant)', 'Mobile, sometimes web', 'Their own bills and payments, visitors, deliveries, helpers, vehicles, complaints, notices.'],
          ] },
        ],
      },
      {
        id: 'dashboard',
        title: 'The dashboard',
        audience: 'admin',
        summary: 'The month at a glance: billed, collected, outstanding, balances.',
        blocks: [
          { type: 'shot', src: '/help/dashboard.jpg', alt: 'The admin dashboard with billed, collected, outstanding, expenses, bank balance and corpus fund', caption: 'The dashboard. Pick a month with the pills at the top; the bank balance and corpus fund are always current.' },
          { type: 'list', items: [
            '**Total Billed, Collected and Outstanding** are for the month you choose. Only published months appear.',
            '**Total Expenses** is that month\'s approved and paid spending.',
            '**Bank Balance** is the total of your accounts, and **Corpus Fund** is the balance of your corpus fund. Both are shown to the admin and accountant only.',
            'A yellow banner appears when payments are waiting for you to verify. **review now** opens them.',
          ] },
        ],
      },
      {
        id: 'first-setup',
        title: 'Set up a new society',
        audience: 'admin',
        summary: 'The order to do things in, from registering to the first published bill.',
        blocks: [
          { type: 'p', text: 'Do these once, in this order. Each step is explained in full later in this guide.' },
          { type: 'steps', items: [
            '**Register your society** on the web (the "Register your society" link on the sign-in page). You become its admin.',
            '**Settings → Society Settings:** check the name, address and contact details. They are printed on bills and statements.',
            '**Flats:** add each building and its flats (**Add Building**, **Add Flat**, or **Import CSV/Excel** for many at once). Give every flat its area if you will bill per square foot.',
            '**Accounts:** add the bank account your UPI ID pays into, and a Cash box. You cannot approve a payment until an account exists.',
            '**Billing → Opening Balances** (on the phone: Settings → Opening Balances): if your flats owe money from your paper or Excel records, enter it now, so the first bill already shows it as arrears. See "Moving from paper or Excel" below.',
            '**Settings → Billing:** set the due day, grace period and late fine.',
            '**Settings → Billing Rules → Add Rule:** add your regular maintenance amount, and any corpus you are collecting. This is where the amount lives; nothing is typed per flat.',
            '**Settings → UPI Payment:** enter the society\'s UPI ID so residents can pay from their phone.',
            '**Invite residents:** share the invite code from **Settings** (Resident Invite Code). Residents join with it, choose their flat and whether they own or rent it.',
            '**Billing → New Period → Generate Bills → Publish.** Residents see their bill the moment you publish.',
          ] },
          { type: 'shot', src: '/help/flats.jpg', alt: 'The Flats page listing two towers and their flats', caption: 'Flats: add buildings and flats first. Every other part of the app hangs off them.' },
          { type: 'tip', text: 'Set the water readings before you generate bills if your society bills water. Bills pick the water charge up when they are generated.' },
        ],
      },
      {
        id: 'joining',
        title: 'Residents joining, and owner or tenant',
        audience: 'admin',
        summary: 'Invite codes, approvals, and marking someone as an owner or a tenant.',
        blocks: [
          { type: 'p', text: 'A resident joins from the app or the web with the society\'s **invite code** (shown in Settings → Resident Invite Code; **Regenerate code** replaces it if it leaks). They enter their details, pick their flat, and say whether they are the **owner** or a **tenant**.' },
          { type: 'list', items: [
            'The first person to join a flat is let in straight away.',
            'Anyone joining a flat that already has a resident (a spouse, a tenant, a co-owner) waits in **Pending Approvals** at the top of Residents. The request says whether they claim to be an owner or a tenant. Approve or reject it.',
            'You can add someone yourself, or change a role, from **Settings → Roles & Permissions**.',
          ] },
          { type: 'shot', src: '/help/residents.jpg', alt: 'The Residents list with an Owner / Tenant column', caption: 'Residents: the Owner / Tenant column. Change it from the drop-down on the row (admin only).' },
        ],
      },
      {
        id: 'owner-tenant',
        title: 'Owner or tenant: who sees the corpus and bank balances',
        audience: 'admin',
        summary: 'Tenants see maintenance and expenses, but not the corpus fund or the bank balances.',
        blocks: [
          { type: 'p', text: 'Every resident is marked **Owner** or **Tenant**. Existing residents are owners until you change them, so after upgrading, go through the Residents list and mark your tenants.' },
          { type: 'table', head: ['', 'Owner', 'Tenant'], rows: [
            ['Their own bills, payments and the Maintenance Sheet', 'Yes', 'Yes'],
            ['Society expenses (if the society shows them to residents)', 'Yes', 'Yes'],
            ['Corpus and other funds', 'Yes, for funds you have made visible', 'Never'],
            ['Total bank balance', 'Yes, if you switched it on', 'Never'],
          ] },
          { type: 'p', text: 'This is enforced on the server, not just hidden on screen: a tenant\'s app is never sent the figures. The tenant\'s Society Finances page tells them the corpus and bank balances are for flat owners.' },
          { type: 'steps', items: [
            'Open **Residents** (web) or **Settings → Manage Residents** (mobile).',
            'On the web, use the **Owner / Tenant** drop-down on the person\'s row. On mobile, tap the **Owner** or **Tenant** tag on their row and confirm.',
            'The change takes effect at once, on the same login.',
          ] },
          { type: 'warn', text: 'Changing someone\'s role (for example making them a committee member) does not change whether they are an owner or a tenant.' },
        ],
      },
      {
        id: 'roles',
        title: 'Roles and what each can do',
        audience: 'admin',
        summary: 'Admin, accountant, committee member, staff, security guard and resident.',
        blocks: [
          { type: 'table', head: ['Role', 'Can'], rows: [
            ['Society Admin', 'Everything, including roles, deleting members, waiving late fines and closing periods.'],
            ['Accountant', 'Billing, payments, expenses, accounts, reports, salaries. Not roles, not waiving fines.'],
            ['Committee Member', 'Gate log, visitor rules, household help, vehicles and parking, staff attendance, and the society\'s finances view.'],
            ['Staff', 'Read the residents list and help with day-to-day records.'],
            ['Security Guard', 'The mobile gate screen only. No access to billing, residents or documents.'],
            ['Resident', 'Their own flat: bills, payments, visitors, deliveries, helpers, vehicles, complaints and notices.'],
          ] },
          { type: 'p', text: 'Change a role from **Settings → Roles & Permissions** with the drop-down beside each member. A person is a member of a society with one role, so someone can be both a resident and a committee member on the same flat.' },
        ],
      },
    ],
  },

  /* ───────────────────────────── Settings reference ───────────────────────────── */
  {
    id: 'settings',
    title: 'Settings reference',
    intro: 'Every setting, what it does, and what happens when you change it. On the web it is the Settings page; on mobile, Admin → Settings.',
    sections: [
      {
        id: 'settings-overview',
        title: 'The Settings page at a glance',
        audience: 'admin',
        summary: 'Where each setting lives on web and mobile.',
        blocks: [
          { type: 'shot', src: '/help/settings-overview.jpg', alt: 'The web Settings page: society details, billing, late fees, transparency and UPI', caption: 'Settings (web): society details, Billing, Late Fees, Transparency and UPI Payment, all on one page. Only the admin can change them.' },
          { type: 'table', head: ['Setting', 'Web', 'Mobile'], rows: [
            ['Society name, address, contact', 'Settings → Society Settings', 'Settings → Society Settings'],
            ['Due day, grace period, late fine', 'Settings → Billing and Late Fees', 'Settings → Billing Configuration'],
            ['Maintenance and corpus amounts', 'Settings → Billing Rules', 'Settings → Billing Rules'],
            ['What residents may see', 'Settings → Transparency', 'Settings → Notification Settings'],
            ['UPI ID', 'Settings → UPI Payment', 'Settings → Billing Configuration'],
            ['Roles', 'Settings → Roles & Permissions', 'Settings → Roles & Permissions'],
            ['Owner or tenant', 'Residents', 'Settings → Manage Residents'],
            ['Buildings and flats', 'Flats', 'Settings → Buildings & Flats'],
          ] },
        ],
      },
      {
        id: 'settings-society',
        title: 'Society details and invite code',
        audience: 'admin',
        summary: 'The name and address printed on bills, and the code residents join with.',
        blocks: [
          { type: 'list', items: [
            '**Society Name** and **Display Name:** the display name is the short name used on invoices; leave it blank to use the full name.',
            '**Address, City, State, Pincode, Contact Email, Contact Phone:** shown on bills and statements.',
            '**Resident Invite Code:** the code residents enter to join. **Regenerate code** invalidates the old one. People already in are not affected.',
          ] },
        ],
      },
      {
        id: 'settings-billing',
        title: 'Billing settings',
        audience: 'admin',
        summary: 'Cycle, due day, financial year, invoice prefix and grace days.',
        blocks: [
          { type: 'table', head: ['Field', 'What it does'], rows: [
            ['Currency', 'INR. Printed with amounts.'],
            ['Billing Cycle', 'How often you bill: Monthly, Quarterly, Yearly or Custom. Most societies use Monthly.'],
            ['Due Day of Month', 'The day of the month a bill is due, for example 10. A new period uses it as the due date.'],
            ['Financial Year Start', 'The month your accounts year begins (April in India).'],
            ['Invoice Prefix', 'The letters before each invoice number, for example INV gives INV-000013.'],
            ['Grace Period (days)', 'Days after the due date before a late fine applies. With a due day of 10 and 5 days of grace, a bill paid by the 15th is not fined.'],
          ] },
        ],
      },
      {
        id: 'settings-late-fee',
        title: 'Late fines',
        audience: 'admin',
        summary: 'Fixed or percentage fine, a cap, and how and when it is added.',
        blocks: [
          { type: 'p', text: 'Under **Late Fees** choose the **type**: a **Fixed** amount, or a **Percentage**. Enter the **rate** (the amount in rupees, or the percentage) and, optionally, a **Max Late Fee** so a percentage can never exceed a ceiling.' },
          { type: 'list', items: [
            'A bill is fined **once**, on the day after its due date plus the grace days, if any of it is still unpaid.',
            'A percentage is taken on **what is still unpaid on that month\'s bill**. Earlier months\' arrears were fined in their own month and are not fined again.',
            'It happens by itself every hour. On a published period\'s page, **Apply late fines** runs it immediately.',
            'The fine is a separate **Late fine** column on the bill and the Maintenance Sheet, and part of what the flat owes.',
            'To remove a fine, the admin clicks **Waive fine** on that bill and gives a reason. It is kept in the audit log and the bill is not fined again.',
          ] },
          { type: 'shot', src: '/help/period-detail.jpg', alt: 'A billing period with a Late fine column and Apply late fines and Waive fine buttons', caption: 'A published period: the Late fine column, the Apply late fines button, and Waive fine on each bill that has one.' },
          { type: 'tip', text: 'To switch fines off, set the rate to zero (or choose None on mobile).' },
        ],
      },
      {
        id: 'settings-transparency',
        title: 'What residents can see (Transparency)',
        audience: 'admin',
        summary: 'Six switches that control what residents see about the society\'s money and meetings.',
        blocks: [
          { type: 'table', head: ['Switch', 'What it does'], rows: [
            ['Require payment verification', 'Recommended. You approve each payment and choose the account it lands in. Off, a bill closes as soon as a resident types any transaction ID, and nothing checks it against your bank.'],
            ['Allow payment proof uploads', 'Residents may attach a screenshot or receipt to a payment.'],
            ['Show total bank balance to residents', 'Owners see the total across your accounts. Tenants never do. Each fund is shown or hidden separately, on the fund itself.'],
            ['Show expenses to residents', 'Residents see this month\'s approved and paid expenses by category. Tenants see them too.'],
            ['Publish monthly statement to residents', 'Residents see the society-wide Maintenance Sheet.'],
            ['Publish meeting minutes', 'Residents can read minutes of meetings.'],
          ] },
          { type: 'warn', text: 'Keep "Require payment verification" on. Turning it off removes the only check on money coming in.' },
        ],
      },
      {
        id: 'settings-upi',
        title: 'UPI payment',
        audience: 'admin',
        summary: 'Let residents pay from PhonePe, GPay, Paytm or BHIM.',
        blocks: [
          { type: 'p', text: 'Enter your society\'s **UPI ID** (for example `societyname@okaxis`). Residents then see **Pay via UPI** on their bill, which opens their UPI app with the amount filled in. After paying they enter the transaction ID (UTR) to confirm.' },
          { type: 'tip', text: 'No payment gateway is involved and there are no gateway fees: the money goes straight to your bank account. NG Home only records it.' },
        ],
      },
      {
        id: 'settings-charges',
        title: 'Billing rules: maintenance and corpus',
        audience: 'admin',
        summary: 'Set the maintenance amount and any corpus once, for every flat.',
        blocks: [
          { type: 'p', text: 'Charges are set **once**, in **Settings → Billing Rules**. When you generate a period\'s bills, every flat\'s bill picks up every rule that applies to that month. You never type a maintenance amount flat by flat, and nothing is entered in the Maintenance Sheet.' },
          { type: 'shot', src: '/help/settings-rules.jpg', alt: 'Billing Rules listing Monthly maintenance and Corpus fund with their amounts', caption: 'Billing Rules: each rule shows what it charges. "Show everything in this rule" opens the full detail.' },
          { type: 'steps', items: [
            'Click **Add Rule** (the **+** on mobile).',
            '**What is this charge?** Regular maintenance, Corpus fund or Other charge. It decides the label on the bill.',
            '**Name on the bill.** For example "Monthly maintenance".',
            '**How is it worked out?** The same amount for every flat, per square foot of the flat, or per resident.',
            'Enter the **amount** (or the rate).',
            'For regular maintenance, choose **Applies from** and, if it ends, **Until**. Leave Until blank to keep charging every month.',
            'Click **Add charge**.',
          ] },
          { type: 'shot', src: '/help/add-charge.jpg', alt: 'The Add a charge form set up for a corpus collected over four months', caption: 'Adding a corpus: a total per flat, how many months to collect it over, and the first month. NG Home divides it into equal monthly instalments.' },
        ],
      },
      {
        id: 'settings-corpus',
        title: 'Collecting a corpus',
        audience: 'admin',
        summary: 'In one go or in monthly instalments, and what happens to an unpaid one.',
        blocks: [
          { type: 'p', text: 'Choose **Corpus fund** as the kind of charge, enter the **total to collect from each flat**, how many **months** to collect it over, and the month the first instalment is billed.' },
          { type: 'list', items: [
            '**One go:** set the months to 1. It appears on that single month\'s bill.',
            '**Instalments:** a total of ₹12,000 over 4 months is ₹3,000 on each of four bills, then it stops by itself.',
            'It shows on every flat\'s bill as its own **Corpus fund** line, separate from maintenance.',
            'An instalment that is not paid stays **pending** and carries into the next month as arrears. When the flat pays, the oldest amount owing is cleared first.',
          ] },
          { type: 'shot', src: '/help/settings-rule-details.jpg', alt: 'The details of a corpus rule: total, amount per flat, months, dates', caption: 'Everything in a rule, in plain words: the total, the instalment, how many months, and when it applies.' },
          { type: 'tip', text: 'To change an amount from a certain month, switch the old rule off (the toggle) and add a new one that applies from that month. Bills already generated are not changed.' },
          { type: 'warn', text: 'A rule must carry an amount. A rule with no amount would bill nothing for every flat, so the app refuses to save one. Rules created in older versions with no amount show "No amount set" in red: switch them off and add the charge again.' },
        ],
      },
      {
        id: 'settings-other',
        title: 'Roles, notifications and your account',
        audience: 'admin',
        summary: 'Changing roles, sending announcements and your own profile.',
        blocks: [
          { type: 'list', items: [
            '**Roles & Permissions:** the drop-down beside each member sets their role. The bin removes them from the society.',
            '**Notifications:** admins and staff can compose a notice to every member. On mobile it also arrives as a phone notification.',
            '**My Account:** your name, email and phone, and changing your password.',
          ] },
        ],
      },
    ],
  },

  /* ───────────────────────────── Money ───────────────────────────── */
  {
    id: 'money',
    title: 'Billing and money',
    intro: 'The monthly cycle, the Maintenance Sheet, fines and arrears, payments, water, expenses, accounts and funds.',
    sections: [
      {
        id: 'billing-cycle',
        title: 'The monthly billing cycle',
        audience: 'admin',
        summary: 'Create a period, generate, review, publish and close.',
        blocks: [
          { type: 'shot', src: '/help/billing-periods.jpg', alt: 'The Billing Periods list showing October and September 2026', caption: 'Billing: one row per month, with what was billed, collected and is still pending.' },
          { type: 'steps', items: [
            '**Billing → New Period.** Choose the year and month, and the start, end and due dates.',
            '**Water Billing** (if you bill water): enter the meter readings and the month\'s water costs for this period.',
            'Open the period and click **Generate Bills**. A bill is made for every active flat from your Billing Rules and the water charges.',
            'Review the bills. You can add a discount or surcharge to a flat on the Maintenance Sheet.',
            '**Publish.** Residents see their bill and get a notification. A published period cannot be regenerated.',
            'When every payment is in and the month is finished, **Close Period** (admin only).',
          ] },
          { type: 'p', text: '**Deleting a period.** A period made by mistake can be deleted with the **Delete** button on the Billing list. It is offered only while the period holds nothing. A period that has bills, payments, water readings or a statement cannot be deleted, and neither can one that is published or closed. The app tells you why.' },
          { type: 'tip', text: 'Regenerating a draft period replaces its bills, so do it before publishing, not after.' },
        ],
      },
      {
        id: 'maintenance-sheet',
        title: 'The Maintenance Sheet',
        audience: 'everyone',
        summary: 'Every flat\'s bill for the month in one table.',
        blocks: [
          { type: 'shot', src: '/help/maintenance-sheet.jpg', alt: 'The Maintenance Sheet with maintenance, water readings, late fine and arrears for each flat', caption: 'The Maintenance Sheet: one row per flat, with the water readings behind each water charge.' },
          { type: 'table', head: ['Column', 'Meaning'], rows: [
            ['Maintenance', 'Regular maintenance plus any corpus instalment for the month, from your Billing Rules.'],
            ['Prev / Curr / Units / Rate', 'The water meter readings, the units used and the rate per kilolitre.'],
            ['Water', 'Units multiplied by the rate.'],
            ['Discount', 'A discount (or surcharge) applied to that flat\'s bill.'],
            ['Late fee', 'The late fine, if one has been added.'],
            ['Arrears', 'What the flat still owes from **earlier months**.'],
            ['Total payable', 'Maintenance + Water − Discount + Late fee + Arrears. Paid flats are greyed out.'],
          ] },
          { type: 'list', items: [
            '**Discount or surcharge** (admin): open a flat\'s bill from the sheet on mobile and choose **Apply Discount / Surcharge**, with a note. Allowed until the period is published.',
            '**Notes** (admin): click a cell in the Note column to add a private note, such as "Cheque received".',
            '**WhatsApp reminder:** the green icon on an unpaid row opens a ready-made message to that flat\'s number.',
            '**Print / PDF:** prints A4 landscape without the navigation.',
          ] },
        ],
      },
      {
        id: 'arrears',
        title: 'Unpaid dues carry forward',
        audience: 'everyone',
        summary: 'An unpaid month stays owing, shows as arrears next month, and clears when paid.',
        blocks: [
          { type: 'p', text: 'Nothing is lost when a flat does not pay. The unpaid amount stays on its own month\'s bill, shows as **Arrears** on the next month\'s sheet, and is part of the **Total payable**. Corpus instalments behave exactly the same way.' },
          { type: 'p', text: 'When a flat pays, the payment clears the **oldest month first**, then the next, and so on. So arrears never sit while a newer month looks paid. Anything paid beyond what the flat owes is kept as an advance (below).' },
          { type: 'list', items: [
            'The pay screens show the **total owed**, and say how much of it is earlier months.',
            'Each payment records how it was shared across months.',
            'A period\'s **Collected** and **Pending** totals update as payments are approved.',
          ] },
          { type: 'p', text: '**Paying ahead.** A resident can pay more than they owe. The payment first clears everything owed, oldest month first, and the rest is kept as that flat\'s **advance**. When the next period is **published**, the advance is applied to that flat\'s new bill automatically: it pays the whole bill if it is enough, otherwise it pays part and the rest is owed.' },
          { type: 'list', items: [
            'The resident sees **Advance paid** at the top of My Bills, and a **Pay in advance** button when they owe nothing.',
            'On the Maintenance Sheet, the **Advance** column shows how much of each flat\'s bill was paid from its advance.',
            'Every advance and every use of it is recorded, and the balance can never go below zero.',
            'A bill the advance has already paid is not fined.',
            'A payment above what the flat owes plus a year of its bill is refused as probably a typing mistake.',
          ] },
          { type: 'warn', text: 'There are no refunds yet. An advance can only be used against the flat\'s future bills, so check the amount before approving a large payment.' },
        ],
      },
      {
        id: 'opening-balances',
        title: 'Moving from paper or Excel',
        audience: 'admin',
        summary: 'Enter what each flat already owes, so the app starts with the right dues.',
        blocks: [
          { type: 'p', text: 'When a society switches from a paper ledger or an Excel sheet, some flats already owe money. **Opening Balances** is where you bring that over, once, so nobody has to be chased from two places.' },
          { type: 'steps', items: [
            'Open **Billing → Opening Balances** on the web, or **Settings → Opening Balances** in the app.',
            'Set **Records are correct up to** to the date your old records run to (for example 31 March).',
            'For each flat that owes, type the amount. Add a note if you like, such as "Paper ledger, page 14". Flats that owe nothing are left blank.',
            'Click **Save**. The dues appear at once.',
          ] },
          { type: 'shot', src: '/help/opening-balances.jpg', alt: 'The Opening Balances page listing every flat with an amount and a note, and the totals above it', caption: 'Opening Balances: every flat in one list, with what it owed and what is still to pay.' },
          { type: 'p', text: '**Many flats at once (web).** Click **Import CSV/Excel**, download the sheet with all your flats already listed, fill in the Amount column in Excel, and upload it. You see a preview first: each row says whether it is new, changed or has a problem, and nothing is saved until you confirm. Flat codes are matched forgivingly ("a 101" finds A-101), but never guessed when two flats look alike.' },
          { type: 'p', text: '**What the opening dues do.**' },
          { type: 'list', items: [
            'They are the flat\'s **oldest** due: a payment clears them before any new month.',
            'They show as **Arrears** on every Maintenance Sheet, and the resident sees them in My Bills as **Opening balance**.',
            'They appear in the Outstanding Dues report.',
            'No fine is added to them, however old the records are.',
            'If the flat has already paid an advance, it is put against the opening dues straight away.',
          ] },
          { type: 'p', text: '**Changing them.** An amount can be changed, or removed (clear it, or enter 0), until the first payment is made against it. After that it shows a padlock and is locked, because money has been counted against it. Do this before you publish the first bill if you can; if a month has already been billed, the app warns you that the new dues are added to bills residents have already seen.' },
          { type: 'warn', text: 'Check each amount before you save, and before approving the first payment for that flat. Once a payment has been made against an opening balance it cannot be edited.' },
        ],
      },
      {
        id: 'payments',
        title: 'Verifying payments',
        audience: 'admin',
        summary: 'Approve or reject what residents submit.',
        blocks: [
          { type: 'shot', src: '/help/payments.jpg', alt: 'The Payments list with approved, pending and cheque payments', caption: 'Payments: submitted by residents, approved by the admin or accountant.' },
          { type: 'steps', items: [
            'Open **Payments** and filter by **Pending**.',
            'Open a payment to see the UTR, amount, method, the flat, and any receipt the resident attached.',
            '**Approve:** choose the account the money landed in. The account is credited, a ledger entry is written, and the flat\'s oldest dues are cleared.',
            '**Reject:** give a reason. The resident is told and can submit again.',
          ] },
          { type: 'tip', text: 'You need at least one account (Accounts) before you can approve anything.' },
        ],
      },
      {
        id: 'water',
        title: 'Water billing and meters',
        audience: 'admin',
        summary: 'Meter readings, the month\'s costs, and a meter that counts down.',
        blocks: [
          { type: 'p', text: 'Open **Water Billing**, choose the period, and enter the month\'s **municipal bill, tanker cost, common electricity bill** and the **percentage of electricity used by the water motor**. NG Home adds these into one total, divides it by the total units used across all flats, and charges each flat its own units at that rate.' },
          { type: 'steps', items: [
            'Choose the billing period.',
            'Enter the four cost figures.',
            'For each flat enter the closing reading. The opening reading is last month\'s closing, carried forward.',
            'Click **Calculate & Save**. Do this before you generate and publish the period.',
          ] },
          { type: 'shot', src: '/help/water.jpg', alt: 'Water Billing with meter readings for each flat and a flat marked counts down', caption: 'Water Billing: opening and closing readings per flat. The flat whose meter counts down carries a "counts down" tag, and its 26 units are worked out the other way round.' },
          { type: 'p', text: '**A meter that counts down.** A faulty meter can run backwards (98362 last month, 98336 now, so 26 units used). On the web, open **Flats**, edit that flat and tick **Water meter counts down**. Then enter readings exactly as the meter shows them: for that flat the units are worked out as earlier minus later, so 26. Every other flat is unchanged. Untick it when the meter is fixed.' },
          { type: 'warn', text: 'The app never guesses the direction from the numbers. A reading lower than the last one on an ordinary flat is refused, because a typo or a replaced meter looks just the same.' },
        ],
      },
      {
        id: 'expenses',
        title: 'Expenses and receipts',
        audience: 'admin',
        summary: 'Record spending, approve it, mark it paid, and photograph the bill.',
        blocks: [
          { type: 'shot', src: '/help/expenses.jpg', alt: 'The Expenses list with paid, approved and pending expenses', caption: 'Expenses move through Pending, Approved and Paid. Only Mark Paid reduces an account\'s balance.' },
          { type: 'steps', items: [
            '**Log Expense:** the description, amount, category, vendor and date.',
            '**Approve** records that the committee agreed to the spend. No money moves yet.',
            '**Mark Paid** and choose the account it came out of. This reduces the balance and writes the ledger entry.',
          ] },
          { type: 'p', text: '**Receipts.** On the mobile app, **Add Expense** has a **Receipt** section: **Take photo** opens the camera to photograph the bill, and **Photo or PDF** attaches one from the phone. You can attach up to six. On any expense card, **Add receipt** adds one later, tap a receipt to open it, and the cross removes it. Receipts can be added to any expense that is not rejected, and cannot be removed once the expense is paid.' },
          { type: 'tip', text: 'The camera asks for permission the first time. If you said no, the app tells you how to turn it on in your phone\'s settings.' },
        ],
      },
      {
        id: 'accounts-funds',
        title: 'Accounts, funds and the corpus',
        audience: 'admin',
        summary: 'Where the money is tracked, and who can see it.',
        blocks: [
          { type: 'p', text: '**Accounts** are where money is tracked: a bank account or a cash box. An account is a record, not a connection to your bank; its balance moves as you approve payments and mark expenses paid. **Funds** (the corpus, a sinking fund) are earmarks inside your accounts, not separate bank accounts, which is why the page shows Total Bank Balance and Total Fund Balance as two figures.' },
          { type: 'shot', src: '/help/accounts.jpg', alt: 'Accounts and Funds with two bank accounts and two reserve funds', caption: 'Accounts & Funds: your accounts with their balances, and the reserve funds, each with a "Visible to residents" setting.' },
          { type: 'steps', items: [
            '**Accounts → New Account:** name, type (Savings, Current, Cash), optional bank details and the opening balance.',
            '**New Fund:** name it, enter what it holds today, and decide whether **residents can see it**. This is off by default.',
            '**Add Money** on a fund records a contribution. Leave "Also credit a bank account" off when the money already arrived as resident payments.',
          ] },
          { type: 'warn', text: 'Tenants never see funds or the bank balance, whatever you set. Owners see only the funds you made visible, and the bank total only if you switched that on.' },
        ],
      },
      {
        id: 'reports',
        title: 'Reports and salaries',
        audience: 'admin',
        summary: 'Dues, collection, expenses, balances, and staff pay.',
        blocks: [
          { type: 'shot', src: '/help/reports.jpg', alt: 'The Reports page showing outstanding dues', caption: 'Reports: Outstanding Dues, Collection Summary, Expense Summary and Account Balances.' },
          { type: 'list', items: [
            '**Outstanding Dues** lists every unpaid bill with the flat, the resident and the amount.',
            '**Salaries** keeps the staff list and monthly pay records, and marking one paid writes it to the account.',
            '**Audit Logs** records who did what, such as approvals, role changes, waived fines and deleted periods.',
          ] },
        ],
      },
    ],
  },

  /* ───────────────────────────── Community & gate ───────────────────────────── */
  {
    id: 'community',
    title: 'Gate and community',
    intro: 'Visitors, parcels, household help, vehicles, staff, and the day-to-day community tools.',
    sections: [
      {
        id: 'visitors',
        title: 'Visitors and the gate',
        audience: 'everyone',
        summary: 'Invitations, walk-ins, approval, and the gate log.',
        blocks: [
          { type: 'p', text: 'Residents can **invite a guest** from the app and share the invitation code, so the guard lets them in without a call. For anyone else, the guard registers a **walk-in** on the mobile gate screen and the resident is asked to allow or refuse. Every visit is logged with who registered it.' },
          { type: 'shot', src: '/help/visitors.jpg', alt: 'The Visitors gate log with search and filters', caption: 'Visitors (committee and admin): the gate log. A visit nobody has answered can be decided here.' },
          { type: 'list', items: [
            'The guard works on the mobile **Gate** screen, which has tabs for Visitors, Parcels, Help, Vehicles and Staff.',
            '**Visitor rules** (button on the web page) lets the committee set how the gate behaves.',
            'Search the log by name, phone, vehicle or flat, and filter by status, type and date.',
          ] },
        ],
      },
      {
        id: 'parcels',
        title: 'Parcels and deliveries',
        audience: 'everyone',
        summary: 'Tell the gate what to expect, and know when it arrives.',
        blocks: [
          { type: 'p', text: 'A resident can tell the gate to expect a delivery and say whether it may come in or be left at the gate. When the guard receives a parcel for a flat they log it, the resident is notified, and it is marked collected when handed over. The committee sees all of it under **Parcels**.' },
        ],
      },
      {
        id: 'household-help',
        title: 'Household help',
        audience: 'everyone',
        summary: 'Maids, cooks, drivers and others, with a code for the gate.',
        blocks: [
          { type: 'p', text: 'A resident registers their helper (name, role, phone) from the app. The committee **verifies** them, and the helper gets a code the guard scans or types to log their entry and exit. A helper can work for more than one flat. The committee can **Suspend** a helper at any time, and the **Attendance** tab shows when each came and went.' },
          { type: 'shot', src: '/help/household-help.jpg', alt: 'The Household help register with Verify and Suspend actions', caption: 'Household help (committee): the register of everyone who works in the society\'s homes.' },
        ],
      },
      {
        id: 'vehicles',
        title: 'Vehicles and parking',
        audience: 'everyone',
        summary: 'Register vehicles, manage parking slots, look up a number plate.',
        blocks: [
          { type: 'p', text: 'Residents register their vehicles (number plate and type). A plate can be live on only one flat at a time. The committee creates **parking slots** (including visitor slots), allocates them to flats and assigns a vehicle to a slot. The guard can look a plate up at the gate.' },
          { type: 'shot', src: '/help/vehicles.jpg', alt: 'Vehicles and parking listing registered vehicles with their flats', caption: 'Vehicles & Parking (committee): who has registered what, and the Parking tab for slots.' },
        ],
      },
      {
        id: 'staff-attendance',
        title: 'Staff attendance and duty roster',
        audience: 'admin',
        summary: 'Shifts, who is on duty, and who came when. It does not change pay.',
        blocks: [
          { type: 'shot', src: '/help/staff-attendance.jpg', alt: 'Staff attendance Day view with planned shifts and check-in times', caption: 'Staff attendance: the Day tab shows each person\'s planned shift and what was recorded.' },
          { type: 'steps', items: [
            '**Shifts:** create shifts such as Morning 06:00 to 14:00. A night shift can run past midnight.',
            '**Roster:** assign people to a shift (and a post such as "Main gate") for a range of dates, or mark a day off.',
            'The guard checks people **in and out** from the Staff tab on the mobile gate screen.',
            '**Day:** correct anyone\'s status, or mark everyone unmarked as present.',
            '**Summary:** a month of present, half day, absent, leave, late and hours worked, per person.',
          ] },
          { type: 'tip', text: 'Attendance does not calculate pay. The summary shows days worked and absences for whoever prepares salaries.' },
        ],
      },
      {
        id: 'helpdesk',
        title: 'Helpdesk',
        audience: 'everyone',
        summary: 'Raise a complaint, follow it, and reply.',
        blocks: [
          { type: 'shot', src: '/help/helpdesk.jpg', alt: 'The Helpdesk list of open requests with category and priority', caption: 'Helpdesk: each request has a category, priority and status. Open one to read and reply.' },
          { type: 'steps', items: [
            '**New Request:** choose a category (plumbing, electrical, lift and so on) and a priority, then describe the problem.',
            'Open a request\'s conversation to reply. Both sides are notified when the other writes.',
            '**Update** (admin) changes the status, for example to In Progress or Resolved. Replying does not change it by accident.',
          ] },
        ],
      },
      {
        id: 'community-tools',
        title: 'Announcements, meetings, documents and amenities',
        audience: 'everyone',
        summary: 'Notices, minutes, files and bookable facilities.',
        blocks: [
          { type: 'shot', src: '/help/community.jpg', alt: 'The Community page with two announcements', caption: 'Community: announcements to all residents, newest first.' },
          { type: 'list', items: [
            '**Community:** admins post notices (a shutdown, the AGM). Residents see them at once.',
            '**Meetings:** agendas and minutes. Minutes are shown to residents only when "Publish meeting minutes" is on.',
            '**Documents:** the society\'s bye-laws and circulars. The admin can upload a file or add a link, and chooses who may see it. Residents can also keep private documents for their own flat.',
            '**Amenities:** set up facilities such as a clubhouse with their hours and fees. Residents book a slot from the app.',
          ] },
        ],
      },
    ],
  },

  /* ───────────────────────────── Residents ───────────────────────────── */
  {
    id: 'residents',
    title: 'For residents and tenants',
    intro: 'What you can do in the app as a flat owner or tenant.',
    sections: [
      {
        id: 'my-bills',
        title: 'My bills and paying',
        audience: 'resident',
        summary: 'See what you owe, and pay with UPI.',
        blocks: [
          { type: 'shot', src: '/help/my-bills.jpg', alt: 'My Bills showing total pending and a list of monthly bills', caption: 'My Bills: what you owe and what you have paid, with each month\'s bill below.' },
          { type: 'steps', items: [
            'Open **My Bills**. The top shows what you owe and what you have paid.',
            'Tap a bill to see the breakdown: maintenance, corpus, water, any late fine, and arrears from earlier months.',
            'Tap **Pay via UPI**. Your UPI app opens with the amount filled in. The amount is **everything you owe**, and the screen says how much is from earlier months.',
            'After paying, enter the transaction ID (UTR) and, if you like, attach the receipt, then confirm.',
            'The admin approves it, and you are notified. Your oldest dues are cleared first.',
          ] },
          { type: 'shot', src: '/help/pay-upi.jpg', alt: 'A bill breakdown and the Pay via UPI panel showing the total owed and earlier months', caption: 'A bill opened out: maintenance, corpus, water and any late fee, then the UPI panel. The amount to pay is the total owed, and it says how much is from earlier months.' },
          { type: 'tip', text: 'If you pay part of what you owe, it clears the oldest month first, then the next.' },
        ],
      },
      {
        id: 'tenant-view',
        title: 'What a tenant sees',
        audience: 'resident',
        summary: 'Your bills, the Maintenance Sheet and expenses, but not the corpus or bank balances.',
        blocks: [
          { type: 'shot', src: '/help/tenant-finances.jpg', alt: 'A tenant\'s Society Finances page showing expenses and a note that corpus and bank balances are for owners', caption: 'A tenant\'s Society Finances page: this month\'s expenses, and a note that the corpus and bank balances are for flat owners.' },
          { type: 'p', text: 'If your society has marked you as a **tenant**, you see everything about your own flat and the society\'s running costs, but the **corpus fund and the bank balances are shown to flat owners only**. Your Society Finances page says so. If you are in fact an owner, ask your society admin to update your details.' },
        ],
      },
      {
        id: 'resident-daily',
        title: 'Visitors, deliveries, helpers and vehicles',
        audience: 'resident',
        summary: 'Everyday use of the app.',
        blocks: [
          { type: 'list', items: [
            '**Visitors:** invite a guest and share the code, or allow or refuse a walk-in when the gate asks.',
            '**Deliveries:** tell the gate what to expect and whether to let it in or hold it.',
            '**Household help:** register your maid, cook or driver so the gate recognises them.',
            '**Vehicles and parking:** register your vehicles and see your parking slot.',
            '**Helpdesk:** raise a complaint and follow it.',
            '**Documents:** keep your own private files, such as a tax receipt, against your flat.',
            '**Notifications:** your phone alerts you to bills, approvals, parcels and notices, and the app keeps a history.',
          ] },
        ],
      },
    ],
  },

  /* ───────────────────────────── FAQ ───────────────────────────── */
  {
    id: 'faq',
    title: 'Questions and troubleshooting',
    intro: 'Quick answers to the things people ask most.',
    sections: [
      {
        id: 'faq-admin',
        title: 'For the admin',
        audience: 'admin',
        summary: 'Zero bills, missing figures, refused entries and deletions.',
        blocks: [
          { type: 'table', head: ['Problem', 'Why, and what to do'], rows: [
            ['Maintenance shows ₹0 on every bill', 'The rule has no amount. Under Billing Rules, switch it off and add the charge again with its amount, then regenerate the draft period.'],
            ['I cannot approve a payment', 'There is no account yet. Add one under Accounts.'],
            ['A water reading is refused as lower than the last', 'Either it is a typo, or that flat\'s meter counts down. For a meter that counts down, tick "Water meter counts down" on that flat.'],
            ['A payment is refused as "more than this flat can pay at once"', 'It is above what the flat owes plus a year of its bill, which is almost always an extra zero. Check the amount.'],
            ['A flat has an advance but its bill is not paid', 'The advance is applied when the period is published. If the bill was published before the payment was approved, it was cleared by that payment instead.'],
            ['A flat owes money from before we started using the app', 'Enter it under Billing → Opening Balances. It becomes the flat\'s oldest due, shows as arrears, and is cleared first by the next payment.'],
            ['I cannot change or remove an opening balance', 'A payment has been made against it, so it is locked. An opening balance can be changed or removed only until the first payment.'],
            ['I cannot delete a billing period', 'It has bills, payments, water readings or a statement, or it is published or closed. Only an empty period can be deleted.'],
            ['A flat was fined and should not have been', 'Open the period and click Waive fine on that bill, with a reason. Check the due day and grace period in Settings too.'],
            ['A tenant can see the corpus', 'They are marked as an owner. Change them to Tenant on the Residents page.'],
            ['An owner cannot see the corpus', 'The fund is not set visible to residents, or they are marked as a tenant.'],
            ['Someone shows as the wrong role', 'Change it from Settings → Roles & Permissions.'],
          ] },
        ],
      },
      {
        id: 'faq-resident',
        title: 'For residents',
        audience: 'resident',
        summary: 'Paying, approvals and what you can see.',
        blocks: [
          { type: 'table', head: ['Question', 'Answer'], rows: [
            ['Why is the amount to pay more than this month\'s bill?', 'It includes earlier months you have not paid. Payments clear the oldest month first.'],
            ['Why was I charged a late fine?', 'The bill was not fully paid by the due date plus the grace days. Ask the admin if you think it is wrong; they can waive it.'],
            ['My payment says pending', 'The admin has to approve it. You are notified when they do.'],
            ['I cannot see the corpus or bank balance', 'These are shown to flat owners only. If you own your flat, ask the admin to mark you as an owner.'],
            ['I joined but cannot sign in', 'If someone else already lives in your flat, the admin has to approve you first.'],
          ] },
        ],
      },
    ],
  },
];

/** Plain text of a section, for searching. */
export function sectionText(s: GuideSection): string {
  const parts: string[] = [s.title, s.summary];
  for (const b of s.blocks) {
    if (b.type === 'p' || b.type === 'tip' || b.type === 'warn') parts.push(b.text);
    else if (b.type === 'steps' || b.type === 'list') parts.push(...b.items);
    else if (b.type === 'table') parts.push(...b.head, ...b.rows.flat());
    else if (b.type === 'shot') parts.push(b.caption, b.alt);
  }
  return parts.join(' ').replace(/[*`]/g, '').toLowerCase();
}
