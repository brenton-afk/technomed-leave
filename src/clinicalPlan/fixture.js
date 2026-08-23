// ─── Seed fixture: Mon 24 – Sun 30 August 2026 ────────────────────────────────
// A real generated week, reproduced verbatim from the existing plan document so
// snapshot tests are stable. Its own internal inconsistencies are preserved
// deliberately and must not be "fixed":
//
//   1. The summary line says "7 surgical cases" while the day blocks and the
//      Surgeon load flag both describe 8 (Fowler 2, Ibbett 1, JPW 2, Gupta 3).
//   2. Friday's "vendor visit begins today" vs. the Saturday start in the key
//      flags.
//   3. A List Order entry on Sunday, unusual for a weekend.
//
// August is AEST (UTC+10), so every instant below is written +10:00.

import './types.js'

const T = (day, hhmm) => `2026-08-${day}T${hhmm}:00+10:00`

/** @type {import('./types.js').WeekPlan} */
export const FIXTURE_WEEK = {
  weekStart: '2026-08-24',
  weekEnd: '2026-08-30',
  title: 'TechnoMed Clinical Plan — 24 – 30 August 2026',
  subtitle: 'Monday 24 – Friday 28 August 2026 · RHH & Calvary (Lenah Valley)',
  summaryLine: '7 surgical cases across four surgeons, plus Brent offsite at the NSA Conference (SA) '
    + 'Tue–Fri, a Spine Team Leader handover from Brent to Ben Friday 5:00pm, and Andrea Weller '
    + '(Signus) visiting from Saturday.',
  surgeons: ['Fowler', 'Ibbett', 'JPW', 'Gupta'],
  notes: 'Brent is travelling Tuesday afternoon through Friday night; factor into '
    + 'on-site coverage Wed–Fri.',

  days: [
    {
      date: '2026-08-24',
      weekday: 'Monday',
      caseCountLine: '2 cases — 2 RHH',
      flags: [
        { text: "BEN: Late start / early finish (Boy's Week)", kind: 'recurringStaffing', boxed: true }
      ],
      casesByHospital: [
        {
          hospital: 'RHH',
          cases: [
            {
              id: 'fx-jackson',
              patient: 'Jackson',
              surgeon: 'Fowler',
              system: 'MARINER',
              operation: 'C5/6 ACDF',
              hospital: 'RHH',
              start: T('24', '10:00'),
              end: T('24', '11:00'),
              calendarColorName: undefined,
              notes: []
            },
            {
              id: 'fx-gill',
              patient: 'Gill',
              surgeon: 'Fowler',
              system: 'STRYKER CCI',
              supply: 'Loan', kit: 'Stryker PSI',
              hospital: 'RHH',
              start: T('24', '11:00'),
              end: T('24', '12:00'),
              calendarColorName: 'Grape',
              colourHex: '#8e24aa',
              notes: []
            }
          ]
        }
      ],
      nonSurgeonItems: [],
      needsAttention: [],
      otherRollup: [
        { text: 'Toni – TM Office (all day)', allDay: true },
        { text: 'List Order 4:00pm–4:30pm', start: T('24', '16:00'), end: T('24', '16:30'), allDay: false }
      ]
    },

    {
      date: '2026-08-25',
      weekday: 'Tuesday',
      caseCountLine: '4 cases — 3 RHH, 1 Calvary',
      flags: [
        { text: "BEN: Late start / early finish (Boy's Week)", kind: 'recurringStaffing', boxed: true },
        { text: 'Brent departs 3:30pm — NSA Conference, South Australia (3:30pm Tue → 10:30pm Fri)', kind: 'travel', boxed: false }
      ],
      casesByHospital: [
        {
          hospital: 'RHH',
          cases: [
            {
              id: 'fx-kennedy',
              patient: 'Kennedy',
              surgeon: 'JPW',
              system: 'REFORM / ASCOT / ATHLET',
              hospital: 'RHH',
              start: T('25', '10:00'),
              end: T('25', '11:00'),
              calendarColorName: 'Flamingo',
              colourHex: '#e67c73',
              notes: []
            },
            {
              id: 'fx-streets',
              patient: 'Streets',
              surgeon: 'JPW',
              system: 'LONESTAR',
              hospital: 'RHH',
              start: T('25', '12:00'),
              end: T('25', '13:00'),
              calendarColorName: undefined,
              notes: []
            },
            {
              id: 'fx-panthi',
              patient: 'Panthi',
              surgeon: 'Gupta',
              system: 'SHORELINE (PM list)',
              hospital: 'RHH',
              start: T('25', '13:30'),
              end: T('25', '14:30'),
              calendarColorName: 'Basil',
              colourHex: '#0b8043',
              notes: []
            }
          ]
        },
        {
          hospital: 'CALVARY LENAH VALLEY',
          cases: [
            {
              id: 'fx-horne',
              patient: 'Horne',
              surgeon: 'Ibbett',
              system: 'DAKOTA',
              operation: 'L4/5 TLIF',
              supply: 'Consignment',
              hospital: 'CALVARY LENAH VALLEY',
              start: T('25', '09:00'),
              end: T('25', '10:00'),
              calendarColorName: 'Banana',
              colourHex: '#f6c026',
              notes: []
            }
          ]
        }
      ],
      nonSurgeonItems: [],
      needsAttention: [],
      otherRollup: [
        { text: 'Erin – office (all day)', allDay: true },
        { text: 'MSL team chat 6:00pm–6:30pm', start: T('25', '18:00'), end: T('25', '18:30'), allDay: false },
        { text: 'List Order 4:00pm–4:30pm', start: T('25', '16:00'), end: T('25', '16:30'), allDay: false }
      ]
    },

    {
      date: '2026-08-26',
      weekday: 'Wednesday',
      caseCountLine: 'No surgical cases',
      flags: [
        { text: 'Brent offsite — NSA Conference, SA (continuing)', kind: 'travel', boxed: false }
      ],
      casesByHospital: [],
      nonSurgeonItems: [],
      needsAttention: [],
      otherRollup: [
        { text: 'Toni – WFH (all day)', allDay: true },
        { text: 'Erin – office (all day)', allDay: true },
        { text: 'Ben – late start / early finish (continuing)', allDay: true },
        { text: 'List Order 4:00pm–4:30pm', start: T('26', '16:00'), end: T('26', '16:30'), allDay: false }
      ]
    },

    {
      date: '2026-08-27',
      weekday: 'Thursday',
      caseCountLine: 'No surgical cases — 1 internal meeting',
      flags: [
        { text: 'Brent offsite — NSA Conference, SA (continuing)', kind: 'travel', boxed: false }
      ],
      casesByHospital: [],
      nonSurgeonItems: [
        { text: 'Catch up – Erin, Brent & Toni · 10:00am–11:00am', start: T('27', '10:00'), end: T('27', '11:00'), allDay: false },
        { text: 'S2AI transfer from RHH, Pt Fox · 11:00am–11:30am (case itself 31/8 @ Calvary — outside this window)', start: T('27', '11:00'), end: T('27', '11:30'), allDay: false },
        { text: 'Spine Logistics Meeting (Erin, Brent, Toni, Ben, Mat) · 1:00pm–2:00pm', start: T('27', '13:00'), end: T('27', '14:00'), allDay: false }
      ],
      needsAttention: [],
      otherRollup: [
        { text: 'Toni – TM office (all day)', allDay: true },
        { text: 'Ben – late start / early finish, last day', allDay: true },
        { text: 'List Order 4:00pm–4:30pm', start: T('27', '16:00'), end: T('27', '16:30'), allDay: false }
      ]
    },

    {
      date: '2026-08-28',
      weekday: 'Friday',
      caseCountLine: '2 cases — 2 RHH',
      flags: [
        { text: 'BEN: Late start / regular finish', kind: 'recurringStaffing', boxed: true },
        { text: '5:00pm — Handover: Ben becomes Spine Team Leader', kind: 'handover', boxed: false },
        { text: 'Brent on call 5:00pm Fri – 7:30am Mon (resumes after conference, ends 10:30pm)', kind: 'travel', boxed: false }
      ],
      casesByHospital: [
        {
          hospital: 'RHH',
          cases: [
            {
              id: 'fx-gordan',
              patient: 'Gordan',
              surgeon: 'Gupta',
              system: 'DIPLOMAT',
              hospital: 'RHH',
              start: T('28', '09:00'),
              end: T('28', '10:00'),
              calendarColorName: 'Basil',
              colourHex: '#0b8043',
              notes: []
            },
            {
              id: 'fx-vanderheim',
              patient: 'Vanderheim',
              surgeon: 'Gupta',
              system: 'MARINER + E4 CAGES',
              hospital: 'RHH',
              start: T('28', '10:00'),
              end: T('28', '11:00'),
              calendarColorName: 'Basil',
              colourHex: '#0b8043',
              notes: []
            }
          ]
        }
      ],
      nonSurgeonItems: [],
      needsAttention: [],
      otherRollup: [
        // Verbatim: this says the visit begins today, while the key flag below
        // says Saturday. Preserved, not reconciled.
        { text: 'Andrea Weller (Signus) in Hobart — vendor visit begins today', allDay: true },
        { text: 'List Order 4:00pm–4:30pm', start: T('28', '16:00'), end: T('28', '16:30'), allDay: false }
      ]
    },

    {
      date: '2026-08-29',
      weekday: 'Saturday',
      caseCountLine: 'No surgical cases',
      flags: [
        { text: 'Brent on call (continuing)', kind: 'travel', boxed: false }
      ],
      casesByHospital: [],
      nonSurgeonItems: [],
      needsAttention: [],
      otherRollup: [
        { text: 'Andrea Weller (Signus) in Hobart (continuing)', allDay: true }
      ]
    },

    {
      date: '2026-08-30',
      weekday: 'Sunday',
      caseCountLine: 'No surgical cases',
      flags: [
        { text: 'Brent on call, through to 7:30am Monday 31 Aug (continuing)', kind: 'travel', boxed: false }
      ],
      casesByHospital: [],
      nonSurgeonItems: [],
      needsAttention: [],
      otherRollup: [
        { text: 'List Order 4:00pm–4:30pm (flagged — unusual for a Sunday, worth confirming)', start: T('30', '16:00'), end: T('30', '16:30'), allDay: false }
      ]
    }
  ],

  keyFlags: [
    { label: 'Surgeon load', text: 'Fowler (2 cases Mon, RHH), Ibbett (1 case Tue, Calvary), JPW (2 cases Tue, RHH), Gupta (3 cases: 1 Tue PM list, 2 Fri, all RHH).' },
    { label: 'Team leader handover', text: 'Brent hands Spine Team Leader duties to Ben Friday 28 Aug, 5:00pm.' },
    { label: 'Staffing', text: "Ben on late start/early finish Mon–Thu (Boy's Week), then late start/regular finish Friday." },
    { label: 'Travel', text: 'Brent at the NSA Conference in South Australia from Tue afternoon (25 Aug) through Fri night (28 Aug) — factor into on-site coverage Wed/Thu/Fri.' },
    { label: 'Logistics', text: "S2AI transfer Thu 27 Aug for Pt Fox, whose case is 31 Aug at Calvary — just after this window. Daily List Order call 4:00pm Mon–Thu, plus one showing Sunday 30 Aug — worth double-checking that's intentional." },
    { label: 'Vendor visit', text: 'Andrea Weller (Signus) in Hobart from Sat 29 Aug.' },
  ],


  lastGeneratedAt: '2026-08-21T17:30:00+10:00'
}

export default FIXTURE_WEEK
