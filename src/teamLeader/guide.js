// ─── The Clinical Team Leader field guide ────────────────────────────────────
// The duty leader's playbook, as content rather than markup.
//
// Ported from the "TM Team Leader" artifact, which is shared with the
// organisation and co-written — so this was extracted mechanically from that
// page and checked word for word against it, rather than retyped. A
// transcription slip in an operating procedure is not a cosmetic bug.
//
// Inline emphasis is carried as `runs` — [{ t, b }] — and never as an HTML
// string. The source is co-written by people other than whoever deploys this,
// and passing its markup through `dangerouslySetInnerHTML` would turn an edit to
// a shared document into script running inside the staff portal. Structured runs
// cannot carry markup at all, so the question does not arise.
//
// To re-sync after the artifact changes: re-run the extractor, diff this file,
// and read the diff. Nothing here should be edited by hand — the artifact is the
// source of truth, and a hand-edit here would be silently lost on the next sync.
//
// Block types, all rendered by src/pages/TeamLeader.jsx:
//   pill heading subheading lead para note hint divider
//   group check step tile callout group-row table list

/** The sixteen run-sheet items live in the "today" tab and are shared per day. */
export const RUNSHEET_TAB = 'today'

export const GUIDE = [
  {
    "id": "today",
    "label": "✓ Today",
    "blocks": [
      {
        "type": "pill",
        "text": "Your daily run-sheet"
      },
      {
        "type": "heading",
        "text": "Today"
      },
      {
        "type": "lead",
        "runs": [
          {
            "t": "Work down this list through the day. It's the whole role in action — if these are ticked, the system is running. Tap each item to check it off."
          }
        ]
      },
      {
        "type": "group",
        "icon": "☀",
        "title": "Morning sweep",
        "note": "6:30am"
      },
      {
        "type": "check",
        "id": "sweep-all-case-inflow-groups-bookings-email",
        "title": "Sweep all case-inflow groups + bookings email",
        "detail": "Catch anything that came in overnight."
      },
      {
        "type": "check",
        "id": "update-the-team-on-anything-they-ve-missed",
        "title": "Update the team on anything they've missed",
        "detail": ""
      },
      {
        "type": "check",
        "id": "confirm-today-s-cases-each-have-a-locked-coverag",
        "title": "Confirm today's cases each have a locked coverage plan",
        "detail": ""
      },
      {
        "type": "check",
        "id": "reconcile-everything-against-the-calendar",
        "title": "Reconcile everything against the calendar",
        "detail": ""
      },
      {
        "type": "check",
        "id": "check-restock-status-with-both-loans-teams",
        "title": "Check restock status with both loans teams",
        "detail": ""
      },
      {
        "type": "group",
        "icon": "↻",
        "title": "Through the day",
        "note": ""
      },
      {
        "type": "check",
        "id": "keep-whatsapp-replies-prompt",
        "title": "Keep WhatsApp replies prompt",
        "detail": "30-minute rule — if it's idle 30 min, step in."
      },
      {
        "type": "check",
        "id": "log-any-new-booking-calendar-run-the-booking-che",
        "title": "Log any new booking → calendar + run the booking checklist",
        "detail": ""
      },
      {
        "type": "check",
        "id": "delegate-restock-dispatch-to-the-team",
        "title": "Delegate restock dispatch to the team",
        "detail": ""
      },
      {
        "type": "check",
        "id": "stay-free-to-float",
        "title": "Stay free to float",
        "detail": "Relieve, resupply, move trays, answer queries."
      },
      {
        "type": "group",
        "icon": "📋",
        "title": "List orders",
        "note": "by 5:00pm"
      },
      {
        "type": "check",
        "id": "obtain-tomorrow-s-theatre-list-orders",
        "title": "Obtain tomorrow's theatre list orders",
        "detail": ""
      },
      {
        "type": "check",
        "id": "allocate-staff-to-each-list",
        "title": "Allocate staff to each list",
        "detail": "Skill mix, case timings, staff preferences."
      },
      {
        "type": "check",
        "id": "leave-room-for-brent-s-key-surgeon-attendance",
        "title": "Leave room for Brent's key-surgeon attendance",
        "detail": ""
      },
      {
        "type": "check",
        "id": "publish-list-orders-allocations-on-technomed-mai",
        "title": "Publish list orders + allocations on Technomed Main",
        "detail": ""
      },
      {
        "type": "group",
        "icon": "🌙",
        "title": "Evening sweep",
        "note": "7:00pm"
      },
      {
        "type": "check",
        "id": "final-scan-of-the-groups-email",
        "title": "Final scan of the groups + email",
        "detail": ""
      },
      {
        "type": "check",
        "id": "confirm-who-s-in-tomorrow",
        "title": "Confirm who's in tomorrow",
        "detail": "Chase anyone whose availability is unclear."
      },
      {
        "type": "check",
        "id": "confirm-every-case-tomorrow-is-covered",
        "title": "Confirm every case tomorrow is covered",
        "detail": ""
      },
      {
        "type": "callout",
        "tone": "default",
        "runs": [
          {
            "t": "Fresh each day:",
            "b": true
          },
          {
            "t": " keep this open through the day — the ticks reset next time you open it, ready for a new day. Overnight isn't expected; on-call just acknowledges anything urgent."
          }
        ]
      }
    ]
  },
  {
    "id": "purpose",
    "label": "The Role",
    "blocks": [
      {
        "type": "pill",
        "text": "The role in a nutshell"
      },
      {
        "type": "heading",
        "text": "You are the keeper of the system"
      },
      {
        "type": "lead",
        "runs": [
          {
            "t": "The team makes the clinical calls. Your job is to keep everything running smoothly around them — consistently, every day."
          }
        ]
      },
      {
        "type": "tile",
        "icon": "🎯",
        "title": "It's about upkeep, not decisions",
        "detail": "The team handles ~95% on its own. You keep the background tight so nothing slips."
      },
      {
        "type": "tile",
        "icon": "🔁",
        "title": "Stay on top of the trickle",
        "detail": "Bookings, WhatsApp and list orders flow in constantly. Kept current daily it's easy — let it drift and it's very hard to recover."
      },
      {
        "type": "tile",
        "icon": "🧭",
        "title": "Be the one with the full picture",
        "detail": "A calm coordinator who keeps the whole team pointed the right way."
      },
      {
        "type": "tile",
        "icon": "⚖️",
        "title": "Consistency beats instinct",
        "detail": "You don't need Brent's gut feel — just run the routines every day. That's a system, not a personality trait."
      },
      {
        "type": "pill",
        "text": "How you work"
      },
      {
        "type": "heading",
        "text": "Stay free — you're the floating resource"
      },
      {
        "type": "lead",
        "runs": [
          {
            "t": "A coordination hub, not another pair of case hands. Where possible, "
          },
          {
            "t": "you don't attend cases yourself",
            "b": true
          },
          {
            "t": " — so you're free to:"
          }
        ]
      },
      {
        "type": "tile",
        "icon": "🚑",
        "title": "Tag in",
        "detail": "Relieve staff during long cases."
      },
      {
        "type": "tile",
        "icon": "🔄",
        "title": "Run resupply",
        "detail": "Move stock and trays between hospitals."
      },
      {
        "type": "tile",
        "icon": "💬",
        "title": "Field the messages",
        "detail": "Answer queries and keep WhatsApp moving."
      },
      {
        "type": "tile",
        "icon": "📦",
        "title": "Sort the logistics",
        "detail": "Keep things flowing quietly in the background."
      },
      {
        "type": "callout",
        "tone": "blue",
        "runs": [
          {
            "t": "Don't get lumbered:",
            "b": true
          },
          {
            "t": " if you end up covering a case, hand your team-leader duties to someone else for that time. The role must never collapse back onto one person."
          }
        ]
      },
      {
        "type": "pill",
        "text": "What \"good\" looks like"
      },
      {
        "type": "heading",
        "text": "A tidy day, every day"
      },
      {
        "type": "tile",
        "icon": "✅",
        "title": "Every booking in the calendar",
        "detail": "Standard format, entered straight away."
      },
      {
        "type": "tile",
        "icon": "✅",
        "title": "Every message answered",
        "detail": "Hospitals always know we've got it."
      },
      {
        "type": "tile",
        "icon": "✅",
        "title": "Every case covered ahead of the day",
        "detail": "No surprises on the morning of surgery."
      },
      {
        "type": "tile",
        "icon": "✅",
        "title": "Lists out to the team each evening",
        "detail": "Everyone knows where they're going tomorrow."
      },
      {
        "type": "tile",
        "icon": "✅",
        "title": "Nothing living only in someone's head",
        "detail": "It's in the calendar and the logistics group."
      }
    ]
  },
  {
    "id": "booking",
    "label": "New Booking",
    "blocks": [
      {
        "type": "pill",
        "text": "Definition of done"
      },
      {
        "type": "heading",
        "text": "New booking checklist"
      },
      {
        "type": "lead",
        "runs": [
          {
            "t": "A booking is "
          },
          {
            "t": "not finished when it's in the calendar",
            "b": true
          },
          {
            "t": ". It's finished when every step below is done."
          }
        ]
      },
      {
        "type": "hint",
        "text": "Tap a row to mark it complete."
      },
      {
        "type": "check",
        "id": "1-calendar-entry-first-always",
        "title": "1 · Calendar entry — first, always",
        "detail": "Calendar is king. Enter in the standard format the moment the booking is known."
      },
      {
        "type": "check",
        "id": "2-acknowledge-on-whatsapp",
        "title": "2 · Acknowledge on WhatsApp",
        "detail": "Reply on the WhatsApp group so the nursing/hospital team knows we've got it. (Bookings emails from Sharon & CNS don't need a reply.)"
      },
      {
        "type": "check",
        "id": "3-case-specifics-what-does-it-need",
        "title": "3 · Case specifics — what does it need?",
        "detail": "Is it an extension of an existing construct? A standard consignment kit, or are there special instrument/implant requests?"
      },
      {
        "type": "check",
        "id": "4-implant-sufficiency",
        "title": "4 · Implant sufficiency",
        "detail": "Confirm we have sufficient implants/stock for the case."
      },
      {
        "type": "check",
        "id": "5-kit-loan-set-logistics",
        "title": "5 · Kit & loan set logistics",
        "detail": "Book loan sets and confirm timing. Arrange any kit transfer from another hospital, and sort the comms/turnaround to get kits restocked and ready in time."
      },
      {
        "type": "check",
        "id": "6-delegate-case-attendance",
        "title": "6 · Delegate case attendance",
        "detail": "Pivot to the Clinical Logistics group and agree who covers the case (see Lists & Staff tab)."
      },
      {
        "type": "check",
        "id": "7-coverage-confirmed-locked",
        "title": "7 · Coverage confirmed & locked",
        "detail": "The assigned rep has acknowledged. The plan is in the calendar. Done."
      },
      {
        "type": "callout",
        "tone": "amber",
        "runs": [
          {
            "t": "When Toni's not in the office:",
            "b": true
          },
          {
            "t": " steps 3–5 are the ones most often missed. Do not skip them — this checklist is what replaces Toni's attentive eye on a day she's not there."
          }
        ]
      },
      {
        "type": "callout",
        "tone": "default",
        "runs": [
          {
            "t": "Working with Toni:",
            "b": true
          },
          {
            "t": " on Toni's booking days she liaises with the team leader on each case, so that everything is available and ready — with the team leader providing the "
          },
          {
            "t": "clinical-knowledge support",
            "b": true
          },
          {
            "t": " (right implants, sets and case specifics). Bookings admin + clinical judgement, working as a pair."
          }
        ]
      },
      {
        "type": "callout",
        "tone": "blue",
        "runs": [
          {
            "t": "Direct bookings by the team:",
            "b": true
          },
          {
            "t": " if a clinical team member takes a booking straight from a surgeon, nurse or registrar, they "
          },
          {
            "t": "book it in the calendar themselves",
            "b": true
          },
          {
            "t": " and report it to the team leader — the first port of call for follow-up on set movements, implant requirements, etc. If the team leader is swamped, the team member carries out the follow-up themselves and updates the relevant WhatsApp group."
          }
        ]
      }
    ]
  },
  {
    "id": "lists",
    "label": "Lists & Staff",
    "blocks": [
      {
        "type": "pill",
        "text": "Every evening · by 5pm"
      },
      {
        "type": "heading",
        "text": "List orders & theatre allocations"
      },
      {
        "type": "lead",
        "runs": [
          {
            "t": "A core daily duty. Get the next day's lists sorted and published so everyone walks in knowing exactly where they're going."
          }
        ]
      },
      {
        "type": "step",
        "num": "1",
        "title": "Obtain the list orders",
        "detail": "Collect the theatre list orders for the next day from each hospital, no later than 5pm."
      },
      {
        "type": "step",
        "num": "2",
        "title": "Allocate staff to each list",
        "detail": "Assign a rep to each theatre/list based on skill mix, case timings & list order, and staff preferences."
      },
      {
        "type": "step",
        "num": "3",
        "title": "Publish on Technomed Main",
        "detail": "Post the list orders together with the staff allocation for each list, so the whole team has the plan for tomorrow."
      },
      {
        "type": "callout",
        "tone": "blue",
        "runs": [
          {
            "t": "Key-surgeon attendance (Brent):",
            "b": true
          },
          {
            "t": " when building the lists, leave room for "
          },
          {
            "t": "Brent to personally attend our key surgeon customers at regular intervals",
            "b": true
          },
          {
            "t": ". Maintaining these top relationships matters to the MD, so factor his attendance in when allocating these surgeons' cases. ThaniIbbettGupta"
          }
        ]
      },
      {
        "type": "subheading",
        "text": "Allocating cases & resolving clashes"
      },
      {
        "type": "lead",
        "runs": [
          {
            "t": "Run these factors in order. The call is a judgement, but the sequence stops anything being overlooked."
          }
        ]
      },
      {
        "type": "step",
        "num": "1",
        "title": "Competency (hard filter)",
        "detail": "Who is actually trained to cover this case type? Rules people out first. (Mat — no ortho. Brent — no ortho nailing. Aimee — learning spine. April — ortho, casual.)"
      },
      {
        "type": "step",
        "num": "2",
        "title": "Availability",
        "detail": "Who is genuinely free — including personal commitments and rostered patterns."
      },
      {
        "type": "step",
        "num": "3",
        "title": "Timing, list order & location",
        "detail": "Line up start times, list order and hospitals so overlapping cases don't clash."
      },
      {
        "type": "step",
        "num": "4",
        "title": "Confirm commitments & availability — the step that saves you",
        "detail": "Before locking: does anyone already have something on that day? Is the ortho director in or out? Ask explicitly — don't assume."
      },
      {
        "type": "step",
        "num": "5",
        "title": "Tiebreakers",
        "detail": "Brent's key-surgeon attendance, travel/geography, load balancing, and development opportunities (putting a learner in when it's safe)."
      },
      {
        "type": "callout",
        "tone": "amber",
        "runs": [
          {
            "t": "Why step 4 matters:",
            "b": true
          },
          {
            "t": " the classic near-miss is committing a rep to a case, then discovering a director had an undisclosed case or was returning from leave unannounced. The clash is almost always an "
          },
          {
            "t": "information gap, not a bad decision",
            "b": true
          },
          {
            "t": ". Confirm before you lock."
          }
        ]
      },
      {
        "type": "subheading",
        "text": "Ortho vs spine authority"
      },
      {
        "type": "callout",
        "tone": "default",
        "runs": [
          {
            "t": "Spine:",
            "b": true
          },
          {
            "t": " the team leader owns all spine allocations outright. "
          },
          {
            "t": "Ortho:",
            "b": true
          },
          {
            "t": " Jez normally runs ortho coverage himself. "
          },
          {
            "t": "When Jez is away",
            "b": true
          },
          {
            "t": ", the team leader allocates ortho too — and checks the plan in with Jez or Brent. Remember: you can "
          },
          {
            "t": "coordinate",
            "b": true
          },
          {
            "t": " ortho, but a spine rep can't physically "
          },
          {
            "t": "cover",
            "b": true
          },
          {
            "t": " it — separate the two."
          }
        ]
      }
    ]
  },
  {
    "id": "restock",
    "label": "Restock",
    "blocks": [
      {
        "type": "pill",
        "text": "Logistics"
      },
      {
        "type": "heading",
        "text": "Restock & inter-hospital logistics"
      },
      {
        "type": "lead",
        "runs": [
          {
            "t": "Keeping trays and stock flowing is a background job the team leader owns — but delegates the legwork."
          }
        ]
      },
      {
        "type": "step",
        "num": "1",
        "title": "Liaise with both loans teams",
        "detail": "Stay in regular contact with the two loans teams regarding restock needs and tray movements."
      },
      {
        "type": "step",
        "num": "2",
        "title": "Delegate distribution & dispatch",
        "detail": "Systematically hand out the distribution and dispatch of restock to the clinical team — assign it, don't absorb it all yourself."
      },
      {
        "type": "step",
        "num": "3",
        "title": "Run the background logistics",
        "detail": "As the floating resource, move trays and run resupply between hospitals so nothing stalls a case."
      },
      {
        "type": "step",
        "num": "4",
        "title": "Keep restock status visible",
        "detail": "Keep the loans and TM Usage Case Records groups current, so tray readiness is always known at a glance."
      },
      {
        "type": "callout",
        "tone": "blue",
        "runs": [
          {
            "t": "Delegate, don't martyr:",
            "b": true
          },
          {
            "t": " restock is a team activity you coordinate, not a solo chore. Spreading it keeps you free to float — and stops the role becoming a bottleneck."
          }
        ]
      }
    ]
  },
  {
    "id": "groups",
    "label": "WhatsApp",
    "blocks": [
      {
        "type": "pill",
        "text": "Visibility"
      },
      {
        "type": "heading",
        "text": "WhatsApp groups map"
      },
      {
        "type": "lead",
        "runs": [
          {
            "t": "The duty team leader must have eyes on every group where bookings arrive, plus Technomed Main where the lists are published. These are non-negotiable while you hold the role."
          }
        ]
      },
      {
        "type": "group-row",
        "name": "Clinical Logistics",
        "tag": "Internal hub",
        "tagKind": "in",
        "key": true,
        "runs": [
          {
            "t": "Where coverage plans are agreed. Mat, Ben, Brent, Jez, Aimee."
          }
        ]
      },
      {
        "type": "group-row",
        "name": "Synthes Ortho Trauma (RHH)",
        "tag": "Case inflow",
        "tagKind": "ext",
        "key": true,
        "runs": [
          {
            "t": "RHH ortho trauma bookings from hospital staff. ANUMs + senior nursing, Jez, Brent, Ben. "
          },
          {
            "t": "The duty leader must be added here.",
            "b": true
          }
        ]
      },
      {
        "type": "group-row",
        "name": "Technomed Neuro",
        "tag": "Case inflow",
        "tagKind": "ext",
        "key": true,
        "runs": [
          {
            "t": "RHH Neurosurg registrars + senior nursing, Aimee, Brent, Ben, Mat."
          }
        ]
      },
      {
        "type": "group-row",
        "name": "Max Fax AIRO Case Bookings",
        "tag": "Case inflow",
        "tagKind": "ext",
        "key": true,
        "runs": [
          {
            "t": "Max-fax team books AIRO scanner cases."
          }
        ]
      },
      {
        "type": "group-row",
        "name": "Technomed Main",
        "tag": "Internal hub",
        "tagKind": "in",
        "key": true,
        "runs": [
          {
            "t": "Where the evening list orders & staff allocations are published for the whole team."
          }
        ]
      },
      {
        "type": "divider",
        "text": "Other groups (context, not primary inflow)"
      },
      {
        "type": "group-row",
        "name": "Tasmanian Stryker",
        "tag": "Supplier",
        "tagKind": "ext",
        "key": false,
        "runs": [
          {
            "t": "Stryker CMF & Neuro business. Rob Gourlay, Mat, Brent."
          }
        ]
      },
      {
        "type": "group-row",
        "name": "RHH Loans Coordinator",
        "tag": "Logistics",
        "tagKind": "ext",
        "key": false,
        "runs": [
          {
            "t": "Tray movements/needs at RHH. 2 loans techs, Neuro ANUM, Brent, Aimee, Ben, Mat."
          }
        ]
      },
      {
        "type": "group-row",
        "name": "TM Usage Case Records",
        "tag": "Logistics",
        "tagKind": "in",
        "key": false,
        "runs": [
          {
            "t": "Spine tray-usage photos & restock tracking. Ben, Brent, Mat, Aimee."
          }
        ]
      },
      {
        "type": "group-row",
        "name": "Hobart Brainlab",
        "tag": "Vendor support",
        "tagKind": "ext",
        "key": false,
        "runs": [
          {
            "t": "Direct line to Brainlab tech support (Melbourne)."
          }
        ]
      },
      {
        "type": "callout",
        "tone": "default",
        "runs": [
          {
            "t": "Set-up note:",
            "b": true
          },
          {
            "t": " because the Synthes Ortho Trauma and Technomed Neuro groups contain hospital staff, it's cleaner to make anyone who can hold this role a "
          },
          {
            "t": "permanent member",
            "b": true
          },
          {
            "t": " of the inflow groups rather than adding/removing each week."
          }
        ]
      }
    ]
  },
  {
    "id": "cover",
    "label": "Coverage",
    "blocks": [
      {
        "type": "pill",
        "text": "Coverage matrix"
      },
      {
        "type": "heading",
        "text": "Who covers what"
      },
      {
        "type": "table",
        "head": [
          "Rep",
          "Spine",
          "Ortho",
          "CMF",
          "AIRO / Nav"
        ],
        "rows": [
          [
            {
              "text": "Brent",
              "kind": ""
            },
            {
              "text": "Yes",
              "kind": "yes"
            },
            {
              "text": "Yes*",
              "kind": "part"
            },
            {
              "text": "No",
              "kind": "no"
            },
            {
              "text": "Yes",
              "kind": "yes"
            }
          ],
          [
            {
              "text": "Mat",
              "kind": ""
            },
            {
              "text": "Yes",
              "kind": "yes"
            },
            {
              "text": "No",
              "kind": "no"
            },
            {
              "text": "Yes",
              "kind": "yes"
            },
            {
              "text": "Yes",
              "kind": "yes"
            }
          ],
          [
            {
              "text": "Jez",
              "kind": ""
            },
            {
              "text": "No",
              "kind": "no"
            },
            {
              "text": "Yes",
              "kind": "yes"
            },
            {
              "text": "—",
              "kind": ""
            },
            {
              "text": "No",
              "kind": "no"
            }
          ],
          [
            {
              "text": "Ben",
              "kind": ""
            },
            {
              "text": "Yes",
              "kind": "yes"
            },
            {
              "text": "Dev.",
              "kind": "part"
            },
            {
              "text": "—",
              "kind": ""
            },
            {
              "text": "Yes",
              "kind": "yes"
            }
          ],
          [
            {
              "text": "Aimee",
              "kind": ""
            },
            {
              "text": "Learning",
              "kind": "part"
            },
            {
              "text": "No",
              "kind": "no"
            },
            {
              "text": "—",
              "kind": ""
            },
            {
              "text": "Yes",
              "kind": "yes"
            }
          ],
          [
            {
              "text": "April",
              "kind": ""
            },
            {
              "text": "No",
              "kind": "no"
            },
            {
              "text": "Casual",
              "kind": "part"
            },
            {
              "text": "—",
              "kind": ""
            },
            {
              "text": "No",
              "kind": "no"
            }
          ]
        ]
      },
      {
        "type": "note",
        "runs": [
          {
            "t": "*Brent covers ortho except nailing cases. Toni (bookings/logistics), Emma (brand), Erin (GM) are non-clinical for case cover."
          }
        ]
      },
      {
        "type": "callout",
        "tone": "default",
        "runs": [
          {
            "t": "CMF:",
            "b": true
          },
          {
            "t": " Mat is the only rep who can cover true CMF cases — but these are extremely low volume at present. "
          },
          {
            "t": "AIRO / Navigation:",
            "b": true
          },
          {
            "t": " navigation cases where a speciality uses us for navigation but not implants (e.g. max fax for post-op spines). Covered by Aimee, Ben, Brent and Mat."
          }
        ]
      },
      {
        "type": "callout",
        "tone": "amber",
        "runs": [
          {
            "t": "Watch the ortho gap:",
            "b": true
          },
          {
            "t": " spine is deep (Brent, Mat, Ben). Ortho depends heavily on Jez, with Brent (no nailing), a developing Ben, and April (casual, limited availability) as backup. When Jez is out, treat ortho coverage as a specific contingency — it has the least depth."
          }
        ]
      }
    ]
  },
  {
    "id": "rules",
    "label": "Standards",
    "blocks": [
      {
        "type": "pill",
        "text": "Standards"
      },
      {
        "type": "heading",
        "text": "Response, availability & teamwork standards"
      },
      {
        "type": "subheading",
        "text": "Prompt response — the 30-minute rule"
      },
      {
        "type": "list",
        "items": [
          [
            {
              "t": "WhatsApp messages are "
            },
            {
              "t": "replied to promptly throughout the day",
              "b": true
            },
            {
              "t": " — a hospital should never wonder if we saw it."
            }
          ],
          [
            {
              "t": "This applies to "
            },
            {
              "t": "WhatsApp groups that include nursing and hospital teams",
              "b": true
            },
            {
              "t": ". Internal bookings emails (e.g. from Sharon & CNS) don't need a reply."
            }
          ],
          [
            {
              "t": "It doesn't always have to be the team leader — "
            },
            {
              "t": "anyone",
              "b": true
            },
            {
              "t": " can pick it up."
            }
          ],
          [
            {
              "t": "But if a message "
            },
            {
              "t": "sits idle for 30 minutes",
              "b": true
            },
            {
              "t": " with no response, the "
            },
            {
              "t": "team leader steps in",
              "b": true
            },
            {
              "t": ": respond, make a plan, and execute the action if one is needed."
            }
          ],
          [
            {
              "t": "Keep an eye on the groups from the "
            },
            {
              "t": "6:30am",
              "b": true
            },
            {
              "t": " sweep to the "
            },
            {
              "t": "7pm",
              "b": true
            },
            {
              "t": " sweep on weeknights. Overnight is not expected; on-call acknowledges anything urgent."
            }
          ]
        ]
      },
      {
        "type": "subheading",
        "text": "Roster & weekend handover"
      },
      {
        "type": "list",
        "items": [
          [
            {
              "t": "The team leader role runs on a "
            },
            {
              "t": "weekly duty rotation",
              "b": true
            },
            {
              "t": "."
            }
          ],
          [
            {
              "t": "If the allocated team leader is "
            },
            {
              "t": "not",
              "b": true
            },
            {
              "t": " the person on the weekend on-call shift, the "
            },
            {
              "t": "weekend on-call person assumes team leader responsibilities from Friday 5pm until Monday 7am",
              "b": true
            },
            {
              "t": "."
            }
          ],
          [
            {
              "t": "Team leader duties then hand back to the allocated leader on Monday morning."
            }
          ]
        ]
      },
      {
        "type": "subheading",
        "text": "Availability & leave"
      },
      {
        "type": "list",
        "items": [
          [
            {
              "t": "Senior staff "
            },
            {
              "t": "keep the team informed of their movements.",
              "b": true
            }
          ],
          [
            {
              "t": "If a return-to-work date is unclear (e.g. back from illness leave), give a "
            },
            {
              "t": "heads-up the evening before",
              "b": true
            },
            {
              "t": " about whether you're in the next day."
            }
          ],
          [
            {
              "t": "This is what makes the evening \"who's in tomorrow?\" check reliable — no assuming."
            }
          ]
        ]
      },
      {
        "type": "subheading",
        "text": "Working with Toni (bookings days)"
      },
      {
        "type": "list",
        "items": [
          [
            {
              "t": "On Toni's work days, Toni "
            },
            {
              "t": "liaises with the team leader",
              "b": true
            },
            {
              "t": " on the day's bookings."
            }
          ],
          [
            {
              "t": "Toni handles the booking mechanics; the team leader provides the "
            },
            {
              "t": "clinical-knowledge support",
              "b": true
            },
            {
              "t": " — confirming the right implants, sets and case specifics are lined up."
            }
          ]
        ]
      },
      {
        "type": "subheading",
        "text": "Don't get lumbered — delegate"
      },
      {
        "type": "list",
        "items": [
          [
            {
              "t": "Where possible, stay "
            },
            {
              "t": "off cases",
              "b": true
            },
            {
              "t": " so you can float as the team's flexible resource."
            }
          ],
          [
            {
              "t": "If you're pulled in to cover a case, "
            },
            {
              "t": "delegate your team-leader duties",
              "b": true
            },
            {
              "t": " to someone else for that period."
            }
          ],
          [
            {
              "t": "Restock, dispatch and errands are "
            },
            {
              "t": "coordinated and shared",
              "b": true
            },
            {
              "t": ", not absorbed by one person."
            }
          ]
        ]
      },
      {
        "type": "subheading",
        "text": "When to escalate to Brent"
      },
      {
        "type": "para",
        "runs": [
          {
            "t": "Rarely — the team handles ~95%. Escalate only for genuine exceptions: a case that "
          },
          {
            "t": "cannot be covered",
            "b": true
          },
          {
            "t": " by anyone available, a clash that can't be resolved within these rules, or a clinical/relationship issue with a hospital or surgeon that needs the MD. Otherwise: handle it, log it, and mention it later."
          }
        ]
      }
    ]
  }
]

/** Every checklist id in the run-sheet, in the order they are worked. */
export const RUNSHEET_ITEMS = GUIDE
  .find(tab => tab.id === RUNSHEET_TAB)
  .blocks.filter(block => block.type === 'check')
  .map(block => block.id)
