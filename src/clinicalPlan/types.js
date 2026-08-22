// ─── Clinical Plan types ──────────────────────────────────────────────────────
// The repo is plain JavaScript, so §7's interfaces are expressed as JSDoc
// typedefs: same contract, checkable by an editor, no TypeScript build step
// introduced into a project that does not have one.

/**
 * @typedef {'Hannan'|'Dubey'|'Thani'|'Fowler'|'Ibbett'|'JPW'|'Gupta'|'Atallah'|'Garg'} SurgeonKey
 * @typedef {'RHH'|'CALVARY LENAH VALLEY'|'OFFSITE'|string} Hospital
 * @typedef {'info'|'colourCoding'|'clinicalAlert'} CaseNoteKind
 * @typedef {{ text: string, kind: CaseNoteKind }} CaseNote
 *
 * @typedef {Object} SurgicalCase
 * @property {string} id
 * @property {string} patient              Surname only — never a full name
 * @property {SurgeonKey} surgeon
 * @property {string} procedure            The implant system, from the title
 * @property {string} [operation]         The clinical procedure, from the notes
 * @property {string} [kit]
 * @property {Hospital} hospital
 * @property {string} start                ISO instant
 * @property {string} end
 * @property {string} [calendarColorName]  Google colour name as actually set
 * @property {CaseNote[]} notes
 *
 * @typedef {'recurringStaffing'|'staffing'|'handover'|'travel'|'clinicalAlert'|'logistics'} FlagKind
 * @typedef {{ text: string, kind: FlagKind, boxed: boolean }} DayFlag
 * @typedef {{ text: string, start?: string, end?: string, allDay: boolean }} OtherItem
 *
 * @typedef {Object} DayPlan
 * @property {string} date                 YYYY-MM-DD
 * @property {string} weekday
 * @property {string} caseCountLine
 * @property {DayFlag[]} flags
 * @property {Array<{ hospital: Hospital, cases: SurgicalCase[] }>} casesByHospital
 * @property {OtherItem[]} nonSurgeonItems
 * @property {OtherItem[]} otherRollup
 * @property {Array<{id:string,text:string,reason:string}>} needsAttention  Bookings that could not be read as a case
 *
 * @typedef {{ label: string, text: string }} KeyFlag
 *
 * @typedef {Object} ColourFinding
 * @property {string} kind
 * @property {'error'|'warn'|'info'} severity
 * @property {string} eventId
 * @property {string} title
 * @property {string} date
 * @property {SurgeonKey|null} [surgeon]
 * @property {string|null} expected
 * @property {string|null} actual
 * @property {string} message
 *
 * @typedef {Object} WeekPlan
 * @property {string} weekStart             Monday, YYYY-MM-DD
 * @property {string} weekEnd              Sunday, YYYY-MM-DD
 * @property {string} title
 * @property {string} subtitle
 * @property {string} summaryLine
 * @property {SurgeonKey[]} surgeons
 * @property {string} notes
 * @property {DayPlan[]} days              Always 7 entries, Mon–Sun
 * @property {KeyFlag[]} keyFlags
 * @property {ColourFinding[]} colourCodingFindings
 * @property {string} lastGeneratedAt      ISO instant
 */

export {}
