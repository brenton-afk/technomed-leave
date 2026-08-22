import React from 'react'

// ─── Icon set ─────────────────────────────────────────────────────────────────
// Drawn on a 24 grid, stroke-only, 1.7 stroke, round caps and joins. Every icon
// shares those constants, which is what makes them read as one family — the
// emoji they replace never could, because each came from a different type
// designer.
//
// Stroke rather than fill: at 24px a filled glyph turns into a blob, and stroke
// weight is what carries the "sleek" feel at small sizes.

function Svg({ size = 24, colour = 'currentColor', strokeWidth = 1.7, children, ...rest }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={colour} strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

// ── Primary navigation ──

// Today is a feed, so the icon is a feed: a leading marker and stacked lines of
// decreasing width, which reads as "the day, listed".
export const IconToday = p => (
  <Svg {...p}>
    <circle cx="4.5" cy="6.5" r="1.6" />
    <path d="M9.5 6.5h10" />
    <circle cx="4.5" cy="12" r="1.6" />
    <path d="M9.5 12h7.5" />
    <circle cx="4.5" cy="17.5" r="1.6" />
    <path d="M9.5 17.5h5" />
  </Svg>
)

// A viewfinder: four corner brackets. Unmistakable, and it echoes the frame the
// camera now draws on the page.
export const IconScan = p => (
  <Svg {...p}>
    <path d="M4 9V6.5A2.5 2.5 0 0 1 6.5 4H9" />
    <path d="M15 4h2.5A2.5 2.5 0 0 1 20 6.5V9" />
    <path d="M20 15v2.5A2.5 2.5 0 0 1 17.5 20H15" />
    <path d="M9 20H6.5A2.5 2.5 0 0 1 4 17.5V15" />
    <path d="M7.5 12h9" />
  </Svg>
)

// Cases: a clipboard, the object the plan physically arrives on.
export const IconCases = p => (
  <Svg {...p}>
    <path d="M9 4.5h6v2a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-2Z" />
    <path d="M9 5.5H7.5A1.5 1.5 0 0 0 6 7v11.5A1.5 1.5 0 0 0 7.5 20h9a1.5 1.5 0 0 0 1.5-1.5V7a1.5 1.5 0 0 0-1.5-1.5H15" />
    <path d="M9 12h6" />
    <path d="M9 15.5h4" />
  </Svg>
)

export const IconMe = p => (
  <Svg {...p}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" />
  </Svg>
)

// Sliders rather than a gear: a gear's teeth turn to mush at 24px.
export const IconAdmin = p => (
  <Svg {...p}>
    <path d="M4 8h10" /><circle cx="17" cy="8" r="2.4" />
    <path d="M20 16H10" /><circle cx="7" cy="16" r="2.4" />
  </Svg>
)

// ── Section and card icons ──

export const IconClock = p => (
  <Svg {...p}><circle cx="12" cy="12" r="8" /><path d="M12 7.5V12l3 2" /></Svg>
)

export const IconLeave = p => (
  <Svg {...p}>
    <rect x="4" y="6" width="16" height="14" rx="2.5" />
    <path d="M4 10.5h16M8.5 4v3.5M15.5 4v3.5" />
    <path d="M9.5 15.5h5" />
  </Svg>
)

export const IconPayslip = p => (
  <Svg {...p}>
    <path d="M6 4.5h8.5L19 9v10.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1Z" />
    <path d="M14 4.5V9h5" />
    <path d="M9 13h6M9 16.5h4" />
  </Svg>
)

export const IconCalendar = p => (
  <Svg {...p}>
    <rect x="4" y="6" width="16" height="14" rx="2.5" />
    <path d="M4 10.5h16M8.5 4v3.5M15.5 4v3.5" />
    <path d="M8 14h2.5M13.5 14H16M8 17.5h2.5M13.5 17.5H16" />
  </Svg>
)

export const IconKit = p => (
  <Svg {...p}>
    <path d="M12 3.5 20 8v8l-8 4.5L4 16V8l8-4.5Z" />
    <path d="M4 8l8 4.5L20 8M12 12.5v8" />
  </Svg>
)

export const IconStock = p => (
  <Svg {...p}>
    <path d="M5 7.5h14v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-12Z" />
    <path d="M3.5 4.5h17v3h-17z" />
    <path d="M9.5 13.5l2 2 3.5-3.5" />
  </Svg>
)

export const IconFolder = p => (
  <Svg {...p}>
    <path d="M4 7.5a1.5 1.5 0 0 1 1.5-1.5h3.2a1.5 1.5 0 0 1 1.2.6l1 1.4h7.6A1.5 1.5 0 0 1 20 9.5v8A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-10Z" />
  </Svg>
)

export const IconFile = p => (
  <Svg {...p}>
    <path d="M6.5 4.5h7L18 9v10.5a1 1 0 0 1-1 1H7.5a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1Z" />
    <path d="M13 4.5V9h5" />
  </Svg>
)

export const IconTasks = p => (
  <Svg {...p}>
    <path d="M4.5 7l1.8 1.8L9.5 5.5" />
    <path d="M13 7.5h7" />
    <path d="M4.5 15l1.8 1.8 3.2-3.3" />
    <path d="M13 15.5h7" />
  </Svg>
)

export const IconChevron = p => (
  <Svg {...p}><path d="M9.5 6l6 6-6 6" /></Svg>
)

export const IconBack = p => (
  <Svg {...p}><path d="M14.5 6l-6 6 6 6" /></Svg>
)

export const IconAlert = p => (
  <Svg {...p}>
    <path d="M12 4.5 20.5 19.5H3.5L12 4.5Z" />
    <path d="M12 10v4" /><circle cx="12" cy="17" r=".8" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconCheck = p => (
  <Svg {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>
)

export const IconLock = p => (
  <Svg {...p}>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2.2" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </Svg>
)

export const IconLogout = p => (
  <Svg {...p}>
    <path d="M14.5 5.5H8A2 2 0 0 0 6 7.5v9a2 2 0 0 0 2 2h6.5" />
    <path d="M13 12h7M17 8.5l3 3.5-3 3.5" />
  </Svg>
)

export const IconPlan = p => (
  <Svg {...p}>
    <rect x="4" y="5" width="16" height="15" rx="2.5" />
    <path d="M4 9.5h16" />
    <path d="M7.5 13h4M7.5 16.5h7" />
    <circle cx="15.5" cy="13" r="1.2" fill="currentColor" stroke="none" />
  </Svg>
)
