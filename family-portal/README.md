# Family Calendar

A small web app for the family's phones that shows everyone's calendars in one
place: Apple/iCloud, Google, Outlook — whatever each person already uses.

Nobody changes how they add events. Each person keeps using their own calendar
app, and the portal reads from it. It is **read-only**: it never changes anyone's
calendar.

How quickly a new event appears depends on the calendar service: usually within
minutes, though Google can occasionally take longer. The portal refreshes every
five minutes while it is open, and whenever you reopen it. Pull the ↻ button to
check straight away.

## 1. Get each calendar's private link

Each calendar has a private "iCal" address. Anyone with the link can read that
calendar, so treat it like a password. Never post it anywhere.

**Apple / iCloud** (do this on an iPhone, iPad or Mac):
1. Open the **Calendar** app, then tap **Calendars** at the bottom.
2. Tap the **(i)** next to the calendar.
3. Turn on **Public Calendar**, then tap **Share Link…** and copy it.
   It starts with `webcal://`, which is fine; the portal handles it.

   ("Public" here only means "anyone with the link"; the calendar isn't listed
   anywhere.)

**Google** (on a computer, at calendar.google.com):
1. Click ⚙ **Settings**, then click the calendar's name on the left under *Settings for my calendars*.
2. Scroll to **Integrate calendar**.
3. Copy **Secret address in iCal format** (it ends in `basic.ics`).

**Outlook / Microsoft 365**: Settings → Calendar → Shared calendars → *Publish a
calendar* → choose the calendar and "Can view all details" → copy the **ICS** link.

Do this for every calendar you want on the portal. One person can have several
calendars, such as a personal one and a school one.

## 2. Put it online (Vercel, free)

This folder is a complete project on its own. It works best in **its own GitHub
repository** (e.g. `family-calendar`), kept apart from the TechnoMed portal.

1. Create a new GitHub repo and copy the contents of this folder into it.
2. In Vercel: **Add New → Project**, then import that repo. Keep the defaults (Framework: *Other*).
3. Before deploying, open **Environment Variables** and add:

| Name | Value |
|---|---|
| `FAMILY_PASSCODE` | The passcode everyone will type, e.g. a short phrase. Use 6+ characters. |
| `SESSION_SECRET` | Any long random text (30+ characters). Nobody types this. |
| `FAMILY_CALENDARS` | The list of calendars; see below. |
| `FAMILY_TIMEZONE` | *(optional)* Defaults to `Australia/Hobart`. |

`FAMILY_CALENDARS` is a list like this (paste it as one value):

```json
[
  { "person": "Brent",  "url": "https://calendar.google.com/calendar/ical/.../basic.ics" },
  { "person": "Kate",   "url": "webcal://p52-caldav.icloud.com/published/2/..." },
  { "person": "Olivia", "url": "https://calendar.google.com/calendar/ical/.../basic.ics" },
  { "person": "Brent",  "label": "Work", "url": "https://outlook.office365.com/owa/calendar/.../calendar.ics" }
]
```

- `person`: the name shown on the screen. The same name on two lines gives that
  person two calendars, shown in one colour.
- `label`: *(optional)* tells two calendars of the same person apart.
- `color`: *(optional)* such as `"#d6457a"`. Otherwise each person gets a colour automatically.

4. Click **Deploy**. Vercel gives you an address like `family-calendar.vercel.app`.
   You can attach your own domain later under Settings → Domains.

If you change the variables later, go to **Deployments → ⋯ → Redeploy** for the
change to take effect.

## 3. Put it on each phone

- **iPhone**: open the address in **Safari**, sign in, tap **Share**, then **Add to Home Screen**.
- **Android**: open it in **Chrome**, sign in, tap **⋮**, then **Add to Home screen** (or **Install app**).

You stay signed in for 90 days on each phone.

## What it does

- **Upcoming**: the next two months, day by day, with *Show further ahead* for up to a year.
- **Month**: a month grid with a coloured dot per person. Tap a day to see its events.
- Tap any event for its time, whose calendar it's on, location (opens Maps) and notes.
- Tap a name at the top to hide or show that person's events.
- If the same event is in two people's calendars (e.g. an invite), it's shown
  **once**, with both names.
- If a calendar can't be read (link changed, sharing turned off), a yellow notice
  says whose. It doesn't silently show fewer events.

## Privacy and security

- The calendar links live only in Vercel's settings, never on the phones or in the code.
- Everything sits behind the family passcode. Each wrong guess is slowed down.
- Event text from calendars is always shown as plain text.

## Checking it works (for whoever maintains it)

```bash
npm install
npm run check
```

That runs tests against sample Apple and Google calendars: repeating events with a
skipped and a moved week, all-day events, daylight saving, and duplicates.
