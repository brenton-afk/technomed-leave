# TechnoMed Portal — fix list from team feedback (12–28 Oct 2026)

Source: TM PORTAL FEEDBACK WhatsApp group (Toni, Ben, Mat, Erin, Aimee, Brenton) plus screenshots.

## How to use this file

1. Save this file in the root of the portal repository as `PORTAL_FIXES.md`.
2. Do the **"Before you start (Brenton, not code)"** steps first. Two of the biggest bugs are account settings, not code.
3. In the terminal, start Claude Code in the repo and paste the **Master prompt** below.
4. Work through one task at a time. Each task has its own prompt, acceptance criteria and test steps. Commit after each task.

---

## Before you start (Brenton, not code)

- [~] **Verify technomed.com.au in Resend.** DNS records added 1 Nov 2026 at **Crazy Domains** (the DNS host; not Vodien): DKIM (`resend._domainkey`), SPF and MX on `send`, DMARC (`p=none`), plus a Google Workspace SPF on the main domain. Public DNS confirms they are live; Resend status was **Pending** at the time. **Confirm Resend shows "Verified" before starting Task 1.**
- [x] **Anthropic API billing.** Done 1 Nov 2026: AmEx card on file, auto-reload on (tops up to US$15 when the balance falls below US$5), US$480 promotional credit until 10 Nov 2026. Normal usage is about US$2–3 a month. Still to do: lower the monthly spend limit from US$1,000 to US$20 and add an email alert at US$10.
- [ ] **Ask Calvary IT about wifi in the corridor and theatre 6.** Aimee reported the portal not loading there. Task 7 makes the app cope with poor signal, but a dead spot needs fixing at the source too.
- [x] **Notification contacts for Signus, KT Medical and Neurophys** confirmed 1 Nov 2026 (seeded in Task 8). Still needed: contacts for the other loan-kit suppliers (Device Technologies, E4, Globus).

---

## Master prompt (paste this first)

```
You are working on the TechnoMed portal in this repository. It is used by a small medical
device distribution team in Hobart to manage surgical case bookings (synced with the
Google Calendar bookings@technomed.com.au), usage emails to distributors, kit/loan
logistics, leave, TOIL and timesheets. Emails are sent through Resend. The voice booking
feature calls the Anthropic API.

Read PORTAL_FIXES.md in the repo root. Work through the tasks in the order listed,
one task per session/commit. Skip any task marked ON HOLD (currently Tasks 22 and 23). For each task:
1. First explore the codebase and tell me which files/modules are involved and what is
   causing the issue. Do not change anything until you have shown me the cause.
2. Propose the fix in a few bullet points, then implement it.
3. Add or update automated tests where the codebase has a test setup.
4. Run the app/tests and show me the acceptance criteria passing.
5. Commit with a message starting "fix(portal): Task N - ...".

Rules:
- Never put patient names or other patient details in logs, test fixtures, commit
  messages or error messages. Use fake data in tests.
- Never send real emails to distributors while testing. Use a test recipient or a
  dry-run/preview mode.
- Never change Google Calendar events outside a test calendar while testing.
- Keep secrets in environment variables; never commit keys.
- If something in a task is ambiguous, ask me before building it.

Start with Task 1.
```

---

## Progress (updated 1 Nov 2026, evening)

Live:
- Tasks 1–7: done. Task 7's offline queue built (booking edits only). Brent: no further
  work on Calvary signal — not a portal problem.
- Task 9: Signus (any hospital) and KT Medical (RHH only) notices, shown before sending.
  Contacts and rules in Admin → Notices. Device Technologies on no rule (they asked not
  to get booking notices).
- Task 12: Brainlab AIRO/CURVE/Other + Attendance required / No F2F; No F2F button in Edit
  booking; Calvary Loan added beside RHH Loan.
- Task 13: lodged leave emails Erin only, with an Approve link (and push).
- Task 14: Toni (Mon/Wed/Thu 5.5, 16.5h) and Erin (24h, flexible) apply in hours; Xero gets
  explicit hours per pay period and nothing is sent if Xero already has overlapping leave.
  Tested against a fake Xero only — check the first real approval in Xero.
- Task 15: TOIL in hours for everyone, leave shown on timesheets, ledger and opening
  balances in Admin → TOIL.
- Task 16: search on the Cases page. Task 17/19 were already done.
- Task 18 (part): Aimee's guides and surgeon preferences of 28 Oct installed.
- Surnames read whole from every source.

Waiting on Brent: Task 10 go-ahead (planned rep — see chat), Task 11 after 10 (6pm daily),
Task 18 in-portal editing approach, Task 8 loan-kit rules (contacts are in Admin → Notices).
On hold: 21, 22, 23.

## PRIORITY 1 — Broken now

### Task 1 — Email sending (usage emails and leave emails)

```
Task 1: Fix outgoing email.

Problem (from screenshots):
- Usage emails to distributors fail with Resend 403: "The technomed.com.au domain is not
  verified ... Ben Cassidy <ben@technomed.com.au> is not on a domain verified in Resend".
- Leave approval emails fail with Resend 403 "You can only send testing emails to your own
  email address", and the app falls back to sending as noreply@resend.dev.
- Toni: distributors must be able to reply directly to a usage email, so a "noreply"
  sender is not acceptable.
- Brenton: confirm where usage emails are actually sent from (personal inboxes or the
  system), and make sure there is a record of every one sent.

Before starting: check that technomed.com.au shows "Verified" in Resend (DNS records were
added on 1 Nov 2026; sending region is Tokyo, ap-northeast-1). If it is not verified yet,
stop and tell me.

Required behaviour:
1. Find every place the app sends email. List them for me.
2. Usage emails: send From "<Staff name> via TechnoMed <usage@technomed.com.au>" (or the
   staff member's own technomed.com.au address if the verified domain allows it) with
   Reply-To set to the staff member who sent the usage, and CC or BCC a shared mailbox
   (ask me which: bookings@ or usage@) so we keep a record.
3. All other system emails (leave, notifications): From
   "TechnoMed Portal <portal@technomed.com.au>", Reply-To the relevant person.
4. Remove any fallback to noreply@resend.dev. If sending fails, show a clear
   message to the user ("Email not sent - please contact Brenton") and log the error
   (without patient details). Never show the raw Resend JSON to staff.
5. Keep a sent-email log table: timestamp, type, sender user, recipient(s), booking id,
   status, Resend message id. Add a simple admin view of it.
6. EMAIL_FROM and related settings live in environment variables; document them in README.

Acceptance criteria:
- A test usage email to my address arrives showing the staff member's name, and replying
  goes to that staff member.
- Approving a leave request sends the approval email without errors.
- The sent-email log shows both.
```

### Task 2 — Voice booking ("Say the booking") error handling

```
Task 2: Make the voice booking feature fail gracefully.

Problem: Ben got a raw API error in the New booking screen: 400 invalid_request_error
"Your credit balance is too low to access the Anthropic API". (Billing is fixed: a card is on
file with auto-reload. This task is about handling failures properly.)

Required behaviour:
1. Wrap the Anthropic API call so any error shows a friendly message: "Voice booking is
   unavailable right now - please fill in the form below." The manual form stays usable.
2. Never show raw API JSON or request IDs to staff. Log them server-side.
3. On billing/auth errors (400 credit balance, 401, 403) send one alert email per day to
   brenton@technomed.com.au saying the voice feature is down and why.
4. Confirm the API key is only used server-side, never shipped to the browser.
5. Check which model the feature uses and that max tokens/timeouts are sensible; add a
   timeout of ~20s with the same friendly fallback.

Acceptance criteria:
- With an invalid key in a test environment, staff see the friendly message and can still
  add the booking manually; Brenton gets the alert email once.
```

### Task 3 — Projects page JSON error

```
Task 3: Fix "Unterminated string in JSON at position 6964 (line 138 column 50)" on
Team > Projects (meeting notes and shared worklist).

Required behaviour:
1. Find where Projects data is stored and parsed. Find out why the stored JSON is invalid
   (likely a note containing a quote, newline or special character written by string
   concatenation instead of JSON.stringify, or a truncated save).
2. Fix the write path so data is always serialised safely.
3. Repair the existing stored record without losing the meeting notes. Back it up first.
4. Make the page resilient: if one item fails to parse, show the rest and flag the broken
   item, rather than failing the whole page.

Acceptance criteria:
- The Projects page loads with all existing notes.
- A test note containing quotes, apostrophes, line breaks and emoji saves and reloads.
```

### Task 4 — Multi-word surnames and the Edit booking screen

```
Task 4: Fix bookings with multi-word patient surnames, plus related Edit booking glitches.

Problems (from screenshot of Edit booking):
- A patient surname with particles (e.g. "Van Der Berg" style) displays as only the first
  word in the list/day view, while the calendar shows it correctly. Edit mode shows the
  full name but staff could not save an edit.
- The event title had a different spelling from the surname field, so title and fields
  had drifted apart.
- The Kit field showed one system ("CYLOX (Loan)") but the hint underneath said
  'System and supply, as written: "Diplomat (Consignment)"' - stale data from another
  booking.
- The banner "Somebody changed this booking in Google while you had it open" appeared,
  possibly a false positive caused by the portal's own write.
- The form said "Moving this booking to <date>" even though the date had not changed.

Required behaviour:
1. Stop deriving the surname by splitting the event title on spaces. Store structured
   fields (surname, surgeon, procedure, kit, supply, hospital, entered by, planned rep)
   in the Google Calendar event's extendedProperties (private) and/or a structured
   description block, and treat those as the source of truth. Build the title from the
   fields, never the other way round.
2. For existing events without structured fields, parse the title using the known lists
   of systems and surgeons as delimiters, so everything before the system name is the
   surname (handles "van", "de", "von", "O'", hyphens, multiple words).
3. Fix the stale "as written" hint so it always reflects the booking being edited.
4. Fix the conflict check so the portal's own saves do not trigger "Somebody changed this
   booking"; compare etag/updated time against the version loaded, and refresh it after
   each save.
5. Only show "Moving this booking to..." when the date actually changes.
6. Make sure saving an edit works for these bookings.

Acceptance criteria:
- A test booking with a three-word surname displays the full surname in every view and
  can be edited and saved.
- Editing a booking without changing the date shows no "Moving" message and no conflict
  banner.
```

### Task 5 — Moved bookings not moving in the calendar

```
Task 5: When a booking's date (or hospital/list) is changed in the portal, the Google
Calendar event must move.

Problem (Brenton): the portal did not recognise that a booking that moved needed to move
places in the calendar.

Required behaviour:
1. Find the update path. On date change, update the event start/end (or all-day date) in
   Google Calendar; do not create a duplicate or leave the old one.
2. If the booking moves between calendars or hospitals, handle that too.
3. Show the user a confirmation of the new date after the calendar update succeeds, and a
   clear error if it fails.
4. Trigger the change notifications from Task 8/9 when a booking moves.

Acceptance criteria:
- Moving a test booking from one day to another moves the single calendar event; no
  duplicates remain.
```

### Task 6 — "Entered by" attribution

```
Task 6: Fix "Entered by Brent" appearing on bookings that other staff entered.

Problem (Toni): bookings added via the portal or the email check show "Entered by Brent"
even when someone else entered them with their own login.

Required behaviour:
1. Record the logged-in user who creates or confirms a booking, including bookings created
   from the email check (e.g. "Entered by Toni (from email)").
2. Record amendments as "amended by <user>" with the date, keeping the original creator.
3. Never fall back to a hard-coded name or the service account owner.

Acceptance criteria:
- A test booking created by a non-Brenton test user shows that user as "Entered by".
```

### Task 7 — Portal not loading with poor signal (Calvary corridor/theatre 6)

```
Task 7: Make the portal usable on weak or no connection.

Required behaviour:
1. Measure the initial load (bundle size, number of requests) and reduce it where easy.
2. Make the portal an installable PWA with a service worker that caches the app shell and
   the most recently synced bookings/cases, so it opens offline in read-only mode with a
   clear "Offline - showing data from <time>" banner.
3. Queue simple actions made offline (e.g. marking attendance, usage drafts) and send them
   when the connection returns, showing their pending status. Do not queue anything that
   would email a distributor without the user confirming once online.
4. Add a retry with a friendly message instead of a blank screen on slow loads.

Acceptance criteria:
- With the network throttled to "Slow 3G" and then offline in dev tools, the portal opens
  and shows the day's cases.
```

---

## PRIORITY 1B — Bookings doc built automatically from the portal (ON HOLD)

> **ON HOLD — do not start Task 22 or Task 23.** Brenton has deferred the bookings doc automation (1 Nov 2026). Skip straight from Task 7 to Task 8. Only start these tasks if Brenton explicitly asks.

Context: the spine bookings doc (Dropbox: TECHNOMED/Admin/Bookings/Spine_Booking_Doc_Reconciliation_9.xlsx) is the record used for usage reconciliation, commissions and invoicing. The portal already holds every booking in structured form (it writes Surgeon, Patient, Date, Hospital, Procedure, Kit/supply, Entered by and List into each calendar event), but the Dropbox file is updated by hand and falls behind. On 31 Oct 2026 the doc had 8 November cases while the calendar had 22, including all three ALIFs.

The workbook has a **Bookings** sheet plus many other sheets (Month Input, Commissions Owing, Device, Device Outstanding, Signus, Signus Outstanding, E4, E4 Outstanding, KT Medical Implants, KT DTBV-CBM, Orthotech, Globus-Nuvasive, NewClip, Owing Engine) that use formulas and hand-entered reconciliation data. On the Bookings sheet, the first columns describe the case (Date, Patient, Procedure Description, System, Loan/consignment, Hospital, Surgeon, Funding). The columns after that are filled in by hand for reconciliation (ALL PO's Accounted For, Signus PO, RHH Signus proforma sent, recs sent to supply, implant resupply, comms invoiced in month, Device PO, and so on for each distributor).

### Task 22 — Phase 1: write portal bookings into the existing doc automatically

```
Task 22: Keep the spine bookings doc in Dropbox in sync with the portal, in its
existing format, automatically.

Read first:
- Download a COPY of Spine_Booking_Doc_Reconciliation_9.xlsx from Dropbox
  (TECHNOMED/Admin/Bookings) into a scratch folder. Never test against the live file.
- Show me: the exact column headers and order on the Bookings sheet, how dates are
  stored (text vs real dates, d/m/yy), how rows are sorted, any formatting/colour
  conventions, and which other sheets reference the Bookings sheet (formulas, named
  ranges, lookups). Do not change anything until I've confirmed.

Required behaviour:
1. Stable booking ID. Every portal booking gets a permanent ID (if it doesn't already
   have one), stored in the calendar event's extendedProperties and in a new column
   on the Bookings sheet (put it at the far right or in a hidden column, so existing
   column positions and formulas don't move). Backfill IDs for existing rows by
   matching date + surname + surgeon; list any rows you can't match for me to review.
2. Portal-owned columns only. The portal writes ONLY the case-description columns
   (Date, Patient, Procedure Description, System, Loan/consignment, Hospital, Surgeon,
   Funding if we hold it) plus the booking ID. It must never overwrite the
   reconciliation columns, the formatting of other cells, or any other sheet.
3. Triggers. On booking create, edit, reschedule and cancel:
   - create: insert a new row in date order;
   - edit/reschedule: update that row in place (found by booking ID), moving it if the
     date changes;
   - cancel: do not delete the row. Mark it cancelled (e.g. prefix the procedure with
     "CANCELLED - " and apply the existing strike-through/grey style the team uses),
     so reconciliation history is kept.
   Changes made directly in Google Calendar by the portal's calendar sync should
   flow through the same path.
4. Writing safely to an .xlsx in Dropbox:
   - Use the Dropbox API to download, modify with a library that preserves formulas,
     styles and other sheets (e.g. openpyxl with keep_vba where relevant, or exceljs),
     and upload with mode "update" using the file's current rev, so we never overwrite
     a newer version someone else saved.
   - If the rev has changed (someone saved in Excel), re-download and re-apply.
   - If the file is locked or the upload fails, queue the change and retry
     (exponential backoff), and show an amber "Bookings doc not updated yet" notice in
     the portal admin area until it succeeds.
   - Keep the last 30 versions recoverable (Dropbox version history is enough; log
     each write: timestamp, booking ID, action, Dropbox rev).
   - Debounce: batch changes made within 30 seconds into one write.
5. Field mapping. Show me a mapping table from portal fields to doc columns before
   building. Formats must match what the team uses today (e.g. hospital "Calvary"/"RHH",
   surgeon short names like "Thani", "Gupta", "JPW", system names as written in the doc,
   supply as "Consignment", "Loan", "TM Loan", "Distributor Loan").
6. Reconciliation check. Add an admin page: "Bookings doc vs portal" that lists cases
   in the portal missing from the doc, rows in the doc with no portal booking, and
   field mismatches, with a one-click "write portal values to doc" per row.
7. Privacy. Patient surnames are already in this file, so keep doing that for now, but
   never write patient first names, DOB, MRN or other identifiers, and never put
   patient details in logs or error messages.

Acceptance criteria:
- On a COPY of the workbook: creating, editing, rescheduling and cancelling test
  bookings updates the right rows within a minute; all other sheets' formulas still
  calculate the same totals as before (show me Commissions Owing / Owing Engine totals
  before and after).
- Opening the file in Excel shows no repair warnings and formatting is intact.
- Concurrent edit test: if the file is changed in Dropbox between download and upload,
  the portal detects it and re-applies rather than overwriting.
- Only after I approve the test results: point it at the live file.
```

### Task 23 — Phase 2: the portal becomes the source of truth for reconciliation

```
Task 23: Move the reconciliation columns into the portal and generate the bookings
doc as a report. (Plan first; build only after I approve the plan.)

Goal: the portal holds everything currently typed into the bookings doc, so the doc
(and month-end invoicing, commission checks and the cash tracker) are generated from
one source.

Required behaviour:
1. From the Bookings sheet's manual columns, propose portal fields per booking:
   usage sent (date, by whom), PO number(s) per distributor, proforma/quote sent,
   recs sent to supply, implant resupply status, commission invoiced (month, invoice
   number), funding type, attendance type (incl. Brainlab No F2F), planned rep and
   actual rep. Show me the list and how each maps to the existing columns.
2. Import the existing values from the workbook into those fields (by booking ID),
   with a report of anything that didn't import cleanly.
3. Staff update these fields in the portal (case page + a bulk month-end view), not in
   Excel.
4. Generate outputs automatically on every change:
   - a live Google Sheet in the same layout as the current Bookings sheet (read-only
     for staff), and
   - an .xlsx copy saved to Dropbox nightly, in the same folder, with the same sheets.
   The per-distributor sheets and Owing Engine are rebuilt as calculated reports.
5. Month-end: a "commissions to invoice" screen per distributor for the month,
   generating Xero import CSVs (same format as the Brainlab and DePuy CSVs we've used),
   and marking those bookings as invoiced once approved.
6. Expose the same data to the cash tracker as a read-only feed (ties in with Task 21).

Rules: plan and show me the data model and migration first; keep the current Excel
workflow working until the new one is approved; never lose existing reconciliation
data.
```

---

## PRIORITY 2 — Notifications and workflow

### Task 8 — Notify loan-kit suppliers and neurophysiology on booking changes

```
Task 8: When a booking is added, changed, moved or cancelled, notify the other parties
involved.

Problem (Toni): if a booking includes a loan set or neurophysiology, those parties must be
told about changes. Changing the booking in the portal is not enough.

Required behaviour:
1. Add a contacts/settings table for notification recipients: loan-kit suppliers by
   distributor, the neurophysiology provider, etc. Seed it with these confirmed contacts
   (editable in settings; never hard-code them):
   - Neurophysiology (Neurophys): to info@neurophys.com.au, cc territorymgrs@neurophys.com.au
   - Signus: to jhanson@signus.com.au, cc apolites@signus.com.au
   - KT Medical (Firebird, Lonestar, Reform, connectors): to kt@ktmedical.com.au,
     cc ben@ktmedical.com.au
   - KT allograft usage (DTBV / CBM / DBM): to allograft@ktmedical.com.au,
     cc dtbvutilization@vifm.org (spelled with a z; confirmed from VIFM's own replies)
   Other loan-kit suppliers (Device Technologies, E4, Globus): ask Brenton before
   adding them. Do not guess addresses.
2. On create/change/move/cancel of a booking that has a loan kit (supply = Distributor
   Loan / TM Loan / RHH Loan as relevant) or neurophysiology booked, show the user a
   preview: "These people will be notified: ..." with the email text, and send on confirm.
3. Email content: date, hospital, surgeon, procedure, kit/system, what changed (old ->
   new). Minimise patient details: surname only if the recipient needs it to identify the
   case; never full name, DOB or MRN.
4. Log each notification in the sent-email log (Task 1).

Acceptance criteria:
- Moving a test booking with a distributor loan kit shows the preview and sends one email
  to the test recipient with the old and new dates.
```

### Task 9 — Automatic booking notices to Signus and KT Medical (RHH)

```
Task 9: Automate the booking notices Toni currently sends manually.

Requirement (Toni): Signus bookings, and KT Medical bookings at RHH, must be emailed to
Signus and KT when added to the calendar. Reschedules and cancellations must be sent too.

Required behaviour:
1. Make this rule-based in settings: distributor + optional hospital filter + recipients +
   events to notify on (new, changed, moved, cancelled). Seed two rules: Signus (all
   hospitals) and KT Medical (RHH only). Both rules use the same Signus and KT
   Medical contacts seeded in Task 8 (from the contacts table, never hard-coded).
2. Use the same preview/confirm and logging approach as Task 8. Option to set a rule to
   "send automatically without preview" once trusted.
3. Include a reference so repeat notices about the same booking thread together.

Acceptance criteria:
- Creating a test Signus booking triggers the notice to the test recipient; cancelling it
  triggers a cancellation notice.
```

### Task 10 — Planned rep vs actual rep on each case

```
Task 10: Add "Planned rep attendance" alongside the existing "Actual rep attendance" on
every booking.

Requirement (Toni): staff allocation to cases is currently done in WhatsApp. Each case
should show who is allocated (planned) and who actually attended (actual).

Required behaviour:
1. Add a planned rep field (one or more staff) to bookings, editable by team leaders.
2. Show planned rep on the day/week views and calendar event.
3. Allow a staff member to see "My cases" filtered by planned rep.
4. Keep actual rep as it is; default actual = planned when attendance is confirmed.

Acceptance criteria:
- A team leader can allocate two staff to a test case; each sees it under "My cases".
```

### Task 11 — "Usage not sent" alert

```
Task 11: Alert when a usage has not been sent by the end of the case day.

Requirement (Mat): once a team member is allocated to a case and has not sent the usage
by end of day, notify them.

Required behaviour (depends on Task 10):
1. At a configurable time (default 6:00 pm Hobart time) on the case day, find cases with a
   planned/actual rep where no usage email has been logged and the case is not marked
   "no usage" / "not required" / cancelled.
2. Send the rep a reminder (email, and push if the portal supports it). If still unsent by
   9:00 am next day, also notify the spine team leader of the week.
3. Let the rep mark "No usage for this case" to clear it.

Acceptance criteria:
- A test case with a planned rep and no usage triggers one reminder at the set time.
```

### Task 12 — Brainlab as a system, with attendance prompt

```
Task 12: Add BRAINLAB to the systems list in New/Edit booking.

Requirement (Toni): adding a non-face-to-face Brainlab booking from an email was
difficult. When Brainlab is chosen, prompt "Attendance required" or "No F2F required".

Required behaviour:
1. Add Brainlab with sub-options: AIRO, CURVE (and "Other").
2. Required choice: "Attendance required" / "No F2F required". Store it as a field and
   show it in the title (e.g. "BRAINLAB (No F2F)").
3. "No F2F required" cases are excluded from attendance counts and from the monthly
   Brainlab clinical support invoice export; attended AIRO and CURVE cases are included
   (billing rule: AIRO $300, CURVE $250 ex GST per attendance).

Acceptance criteria:
- A test Brainlab No F2F booking can be added in under 30 seconds and does not appear in
  the invoice export; an attended AIRO case does.
```

### Task 13 — Notify the approver when leave is lodged

```
Task 13: Email (and push if available) the approver when a leave request is lodged.

Requirement (Erin): she only finds out about leave requests when staff email her.

Required behaviour:
1. On submission, notify the approver(s) (configurable; default Erin) with name, dates,
   hours, leave type and a link to approve.
2. Notify the staff member when approved/declined (this is the email that failed in
   Task 1 - confirm it now works).

Acceptance criteria:
- Lodging a test leave request sends the approver an email with a working approve link.
```

---

## PRIORITY 3 — Leave, TOIL and timesheets

### Task 14 — Part-time staff leave in hours

```
Task 14: Leave requests must work for part-time staff.

Problem (Toni, raised twice): leave assumes a five-day full-time week.

Required behaviour:
1. Add a work pattern per staff member: contracted hours per day for each weekday
   (e.g. Mon 7.6, Tue 0, Wed 7.6 ...).
2. Leave requests are calculated and stored in hours: when a date range is chosen,
   pre-fill total hours from the work pattern (skipping non-working days and public
   holidays), and allow the user to adjust for part days.
3. Show balances and requests in hours (with days as a secondary display).
4. Existing requests: convert to hours using each person's pattern; flag any that can't be
   converted cleanly for manual review.
5. Xero sync is the key part. Xero AU payroll has no per-day work pattern: if the portal
   sends a date range, Xero spreads the weekly ordinary hours evenly over Mon-Fri (Toni:
   16.5 / 5 = 3.3 hours a day, including her days off). So the portal must calculate the
   hours itself from the work pattern and send them to Xero explicitly, split by Xero pay
   period (leave periods / number of units per pay period), never leaving Xero to work
   them out. First show me how the portal currently creates leave in Xero.
6. No duplicates. Before creating a Xero leave request, check for an existing one for
   that employee overlapping those dates (e.g. lodged directly in Xero). If one is found,
   do not create another; show the user the existing one. On 27 Oct 2026 the portal
   created a SICK request for Toni on top of her own three single-day Xero requests, and
   it was paid twice in the draft pay run.
7. Seed Toni Hoppitt's work pattern: Mon 5.5, Tue 0, Wed 5.5, Thu 5.5, Fri 0
   (16.5 hrs/week). Other staff: ask Brenton.

Acceptance criteria:
- A part-time test user (3 days/week) requesting Monday to Friday leave is charged only
  for their 3 working days' hours.
- In a Xero test/demo organisation (never the live one), a Toni-style request for
  Tue 27 Oct to Mon 2 Nov creates one request with 11 hours in the fortnight ending
  1 Nov and 5.5 hours in the fortnight ending 15 Nov.
- Lodging the same dates twice does not create a second request.
```

### Task 15 — TOIL in hours, synced with timesheets

```
Task 15: TOIL must support part days and stay in sync with timesheets and leave.

Requirement (Brenton): staff need to apply for TOIL in hours, not just days, and TOIL
applications must sync with the timesheet and leave applications both ways.

Required behaviour:
1. TOIL balance per staff member in hours: accrues from timesheet hours worked over their
   contracted pattern (where the timesheet marks it as TOIL rather than paid overtime),
   and reduces when TOIL leave is approved.
2. TOIL leave requests in hours (part days allowed), using the Task 14 logic.
3. Approved TOIL leave appears on the timesheet for those days automatically; editing the
   timesheet updates the TOIL balance.
4. A balance history (ledger) per staff member, so balances can be checked against Xero.
5. Allow an opening balance per person (e.g. from Xero) with a note.

Acceptance criteria:
- A test user who works 2 extra hours (marked TOIL) sees +2.0h; a 3.5h TOIL request
  approved reduces the balance by 3.5h and shows on the timesheet.
```

---

## PRIORITY 4 — Usability

### Task 16 — Search cases and tasks

```
Task 16: Add a search to find cases and tasks.

Required behaviour:
1. A search box (top bar) matching patient surname, surgeon, system/kit, hospital,
   procedure and task text, across past and future dates.
2. Results grouped (Cases / Tasks), newest first, with date and tap-to-open.
3. Respect access permissions; don't expose results to users who can't see them.

Acceptance criteria:
- Searching a surgeon's name returns their cases across months.
```

### Task 17 — "Today" button

```
Task 17: Add a "Today" button to the day/week/list views that jumps back to the current
day/week after scrolling. Keep it visible on mobile.
```

### Task 18 — Edit preference cards in real time

```
Task 18: Allow surgeon preference cards to be edited in the portal and update for everyone
straight away.

Required behaviour:
1. Edit button on each preference card (permissions: team leaders and above).
2. Save with a change history (who, when, what changed) and the ability to restore a
   previous version.
3. Other users see the updated card without a manual refresh (or on next open).
```

### Task 19 — Display name change

```
Task 19: Change the display name "Matthew" to "Mat" for Mat Usher everywhere it appears
(profile, calendar titles, emails). If names are hard-coded anywhere, move them to the
user profile so staff can choose their display name.
```

---

## PRIORITY 5 — Data

### Task 20 — Historical usage files (ALL SURGEON USAGE folder)

Context: the Dropbox "ALL SURGEON USAGE" folder is 14.6 GB, with 14,433 files in 3,845 folders since November 2021. The plan is to stop redacting files in place, and instead lock the originals away and build a lean index.

```
Task 20: Build a usage index instead of redacting files.

Required behaviour:
1. A one-off script that walks a COPY or read-only mount of the ALL SURGEON USAGE folder
   and extracts only: date, hospital, surgeon, distributor, system, implant item codes,
   lot/serial numbers, quantity, and the source file path. No patient names, DOB or MRN.
2. Write the results to a database table / CSV for the portal ("usage index"), with a
   confidence flag and a list of files that couldn't be parsed for manual review.
3. Run it on 50 sample files first and show me the results before running on everything.
4. New usages created through the portal write straight to this index going forward.

Do not modify, move or delete any original files.
```

### Task 21 — Bookings data export for the tracker and invoicing

```
Task 21: Make the bookings data available outside the portal.

Required behaviour:
1. A nightly export (CSV and JSON) of bookings for the past 13 months and next 3 months:
   date, hospital, surgeon, system/kit, supply type, distributor, planned rep, actual rep,
   attendance type (incl. Brainlab No F2F), status (booked/cancelled/done), usage sent
   (yes/no). Patient surname excluded by default.
2. Save it to a Dropbox folder (or expose a read-only, authenticated endpoint - ask me
   which).
3. Use it to generate month-end invoice drafts (Brainlab clinical support first) as Xero
   import CSVs.
```

---

## Possible future task — file the sent usage sheet into its Dropbox case folder (PLAN ONLY)

> **Not started. Do not build.** Written down on 1 Nov 2026 so the reasoning is
> not lost. Only start if Brenton asks for it.

**Why this is smaller than it sounds.** Most of it already happens. On every
usage save, `api/usage/agent.js` already writes two files into the case folder
`/ALL SURGEON USAGE/SPINE/{SURGEON}/{MONTH YEAR}/{Surname_DDMMYYYY_...}/`:

- `{folder}_Usage_Scan.pdf` — the scanned signed form
- `{folder}_Usage_Sheet.xlsx` — an **internal** workbook with every
  distributor's items together, including rows that never left the building

**The actual gap.** What is *not* filed is the per-distributor workbook that was
genuinely attached to the email — the document the distributor received. Today
the only copy of that exact file is in the distributor's inbox. So "what did we
send Signus for this case?" is answerable by inference from the internal sheet,
but not by producing the artefact.

**The shape of the work, if it is ever wanted.**

1. `buildUsageWorkbook(caseRecord, included, { internal: false })` is already
   called per distributor to make the attachment. Keep that same buffer rather
   than rebuilding it, and write it alongside the others as
   `{folder}_Usage_{Distributor}_Sent.xlsx`.
2. Write it **after** the email is accepted, not before, so a file named
   "Sent" is never in the folder for an email that failed. The current order
   (Dropbox first, then email) is deliberate for the other two files and should
   stay as it is — this one is the exception and needs the opposite order.
3. On a resend, do not overwrite: add `_2`, `_3`. A resend is a separate fact
   and the first attempt is part of the history.
4. Record the filed path on the existing email-log entry, so Admin → Email can
   link straight to the document rather than only asserting it was sent.
5. Nothing new is stored in the app. No attachment bytes in Redis, no second
   mailbox — the whole point of the task is that Dropbox holds the document and
   the log holds the fact.

**Open question for Brenton before any of this is built:** is the per-distributor
sheet worth a third file in every case folder, or is the internal workbook plus
the email log already enough to answer every question anybody actually asks? If
it is the latter, this task should be closed rather than built.

## Not code — follow up with the team

- Toni: confirm the full list of parties to notify per distributor (feeds Tasks 8 and 9).
- Erin: confirm the leave approvers and whether anyone else needs leave notifications.
- Mat and Ben: confirm the end-of-day time for the "usage not sent" reminder (Task 11).
- Team: once Task 10 ships, stop allocating cases in WhatsApp and use planned rep instead.
