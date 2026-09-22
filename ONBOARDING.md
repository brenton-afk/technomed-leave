# TechnoMed Staff Portal — getting started

The portal is the app at **technomed-leave.vercel.app**: the case plan, the
calendar, usage scanning, timesheets, leave, and the team leader guide. This
explains how to get it running on your machine and how to change it safely.

It assumes you have not done this before. If a step already makes sense to you,
skip it.

---

## Before anything else: three rules

These matter more than any of the technical detail below.

**1. Patient data never leaves the calendar.** The app shows patient *surnames*
and nothing else — no first names, no dates of birth, no UR numbers. If you are
writing an example, a test, or even a code comment, **invent a surname**. Do not
paste a real booking in. A surname next to a real procedure and surgeon is
identifiable health information, and this repository is readable by anyone.

**2. The Google Calendar is the source of truth.** The app reads it and must
never contradict it. If the app shows something the calendar does not say —
a case marked cancelled that isn't, a rep missing that is there — that is a bug,
and a serious one. The portal is only useful to the point that it can be trusted.

**3. Nothing is secret in this repository.** No passwords, no API keys, no
tokens. They live in Vercel's environment settings. If you ever find yourself
about to type one into a file, stop and ask.

---

## What you need installed

You need two things. Both are free.

| | What it is | Where |
|---|---|---|
| **Node.js** | Runs the app on your machine. Get the **LTS** version. | nodejs.org |
| **Claude Code** | How you will actually make changes. | claude.com/code |

You will also use **Terminal**, which is already on your Mac — press `Cmd+Space`,
type "Terminal", press Enter. It is a window where you type commands instead of
clicking. Nothing you type in it can break the live app; that takes a deliberate
extra step, covered below.

---

## One-time setup

**1. Get access to the code.** Ask Brent to add `toni-technomed` as a
collaborator. You will get an email invitation — accept it.

**2. Turn on two-factor authentication** at github.com/settings/security. You
mentioned you weren't prompted. Do it anyway: this account can change an app the
team relies on during theatre lists.

**3. Connect your machine to GitHub.** In Terminal, one line at a time:

```bash
ssh-keygen -t ed25519 -C "toni@technomed.com.au"
```

Press Enter three times to accept the defaults. Then:

```bash
cat ~/.ssh/id_ed25519.pub
```

That prints a line starting `ssh-ed25519`. Copy the whole thing, go to
**github.com/settings/ssh/new**, paste it in the big box, give it any title, and
click *Add SSH key*. It is a *public* key — safe to paste. The private half stays
on your Mac.

**4. Download the code.**

```bash
cd ~/Documents
git clone git@github.com:brenton-afk/technomed-leave.git
cd technomed-leave
npm install
```

The last one takes a couple of minutes and prints a lot. That is normal.

---

## Running it on your machine

```bash
npm run dev
```

That prints a web address like `http://localhost:5173`. Open it in your browser
and you have the portal running on your own machine. Change a file, save it, and
the browser updates on its own.

**This is a copy.** Nothing you do here touches the live app or the real
calendar. Break it freely. Press `Ctrl+C` in Terminal to stop it.

To check you haven't broken anything:

```bash
npm test
```

You want it to say all tests passed. There are over 550 of them and they are the
main thing protecting the app from a well-meant change. If a test fails, read
what it says — they are written to explain what broke and why it matters.

---

## Making a change

You will do this with Claude Code rather than by writing React by hand. In
Terminal, inside the project folder:

```bash
claude
```

Then describe what you want in plain English. Some real examples from this
project:

> The calendar view says Monday but is showing Sunday's data. It's off by one day.

> Ibbett's colour is banana but patient X is showing blue. Make the colours
> consistent regardless of how they're entered in Google Calendar.

Be specific about **what you see** and **what you expected**. A screenshot helps
enormously — you can paste one straight in. Vague requests get vague code.

Claude will change files, run the tests, and tell you what it did. Read the
summary. If something looks wrong, say so — it is much cheaper to fix before it
ships.

---

## Putting a change live

Two commands, in order:

```bash
git add -A
git commit -m "A short description of what you changed"
git push
```

That is it. Pushing to GitHub makes Vercel build and deploy automatically —
usually live within about two minutes. Claude Code can do this for you if you ask.

**Before you push, ask yourself:** do the tests pass, and have you looked at the
change in your browser? Those two things catch nearly everything.

**If something goes wrong after it's live,** tell Brent straight away. Reverting
is quick and nobody minds. What causes trouble is a broken app nobody has
mentioned while a list is running.

---

## The shape of the thing

You do not need this to start, but it helps to know roughly where things live.

```
src/pages/          One file per screen — Cases, UsageScan, Timesheets…
src/clinicalPlan/   Reading Google Calendar bookings into cases
src/design/         Colours, type sizes, shared components
src/teamLeader/     The team leader field guide content
api/                The server side — calendar, email, usage, auth
```

Two files worth knowing about:

- **`CLAUDE.md`** — the architecture notes Claude Code reads automatically. It
  records *why* things are built the way they are, including a good number of
  past mistakes and what they cost. Worth skimming.
- **`src/staffConfig.js`** — the staff roster: names, emails, who is on the
  clinical team, who gets copied on usage emails.

### Two traps that have caught people before

**Dates.** Every date in this app is a Hobart date, handled by
`src/clinicalPlan/week.js`. If you write ordinary JavaScript date code it will
use the browser's timezone and be a day out for the first ten hours of every
morning — which is exactly the hours the team uses the app. Always use the
helpers.

**Vercel's function limit.** The plan allows 12 server functions and we are at
12. If you need a new server route, add it to an existing file with
`?action=something` rather than creating a new file. There are several examples.

---

## When you are stuck

Ask Claude Code — including "I don't understand what this is doing". It has the
full history of this project and explains as readily as it writes.

For anything about how the *business* should work — who gets copied, what a
booking means, whether a case is cancelled — ask Brent. That is not in the code
and should not be guessed at.

Welcome aboard.
