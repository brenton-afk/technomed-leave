// ─── Snapping, alignment and spacing for the label editor ────────────────
// Pure maths on axis-aligned boxes in label millimetres ({ left, top, width,
// height }), so it is tested without a canvas. The editor feeds it the moving
// object's bounding box and draws the guide lines it returns.

import { SAFE_MARGIN, trimOffset, trimSize } from './model.js'

/** The trim and safe-area rectangles of a label, in canvas mm. */
export function labelFrames(label) {
  const o = trimOffset(label)
  const { w: TRIM_W, h: TRIM_H } = trimSize(label)
  const trim = { left: o.x, top: o.y, width: TRIM_W, height: TRIM_H }
  const safe = { left: o.x + SAFE_MARGIN, top: o.y + SAFE_MARGIN, width: TRIM_W - 2 * SAFE_MARGIN, height: TRIM_H - 2 * SAFE_MARGIN }
  const bleed = { left: 0, top: 0, width: Number(label.w), height: Number(label.h) }
  return { trim, safe, bleed }
}

const xsOf = b => [b.left, b.left + b.width / 2, b.left + b.width]
const ysOf = b => [b.top, b.top + b.height / 2, b.top + b.height]

/**
 * Lines a moving box may snap to: the label's centre, trim and safe-area
 * edges, and every other item's edges and centres.
 */
export function snapTargets(label, others = []) {
  const { trim, safe } = labelFrames(label)
  const xs = [...xsOf(trim), safe.left, safe.left + safe.width]
  const ys = [...ysOf(trim), safe.top, safe.top + safe.height]
  for (const b of others) { xs.push(...xsOf(b)); ys.push(...ysOf(b)) }
  return { xs, ys }
}

function nearest(points, lines, threshold) {
  let best = null
  for (const p of points) {
    for (const l of lines) {
      const d = l - p
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, line: l }
    }
  }
  return best
}

/**
 * How far to move `box` so its nearest edge or centre lands on a target
 * line, per axis, if one is within `threshold` mm; and the lines to draw.
 */
export function snapBox(box, targets, threshold) {
  const x = nearest(xsOf(box), targets.xs, threshold)
  const y = nearest(ysOf(box), targets.ys, threshold)
  return { dx: x ? x.delta : 0, dy: y ? y.delta : 0, guides: { x: x ? x.line : null, y: y ? y.line : null } }
}

/**
 * Moves that line boxes up. One box lines up with `frame` (the trim); several
 * line up with each other's extent. mode: left | hcenter | right | top | vcenter | bottom.
 */
export function alignBoxes(boxes, mode, frame) {
  const ref = boxes.length > 1 ? {
    left: Math.min(...boxes.map(b => b.left)),
    top: Math.min(...boxes.map(b => b.top)),
    right: Math.max(...boxes.map(b => b.left + b.width)),
    bottom: Math.max(...boxes.map(b => b.top + b.height))
  } : { left: frame.left, top: frame.top, right: frame.left + frame.width, bottom: frame.top + frame.height }
  return boxes.map(b => {
    switch (mode) {
      case 'left': return { dx: ref.left - b.left, dy: 0 }
      case 'right': return { dx: ref.right - (b.left + b.width), dy: 0 }
      case 'hcenter': return { dx: (ref.left + ref.right) / 2 - (b.left + b.width / 2), dy: 0 }
      case 'top': return { dx: 0, dy: ref.top - b.top }
      case 'bottom': return { dx: 0, dy: ref.bottom - (b.top + b.height) }
      case 'vcenter': return { dx: 0, dy: (ref.top + ref.bottom) / 2 - (b.top + b.height / 2) }
      default: return { dx: 0, dy: 0 }
    }
  })
}

/**
 * Even gaps between three or more boxes along an axis ('x' or 'y'): the two
 * outermost stay put. Returns a move per box, in the order given.
 */
export function distributeBoxes(boxes, axis) {
  const moves = boxes.map(() => ({ dx: 0, dy: 0 }))
  if (boxes.length < 3) return moves
  const pos = b => (axis === 'x' ? b.left : b.top)
  const size = b => (axis === 'x' ? b.width : b.height)
  const order = boxes.map((b, i) => i).sort((a, b) => pos(boxes[a]) - pos(boxes[b]))
  const first = boxes[order[0]]
  const last = boxes[order[order.length - 1]]
  const span = pos(last) + size(last) - pos(first)
  const used = order.reduce((s, i) => s + size(boxes[i]), 0)
  const gap = (span - used) / (order.length - 1)
  let at = pos(first)
  for (const i of order) {
    const d = at - pos(boxes[i])
    moves[i] = axis === 'x' ? { dx: d, dy: 0 } : { dx: 0, dy: d }
    at += size(boxes[i]) + gap
  }
  return moves
}

/** Undo and redo: snapshots (strings), the newest last. */
export function createHistory(limit = 100) {
  const past = []
  const future = []
  return {
    /** Records a state; a state equal to the last is not a step. */
    push(state) {
      if (past[past.length - 1] === state) return false
      past.push(state)
      if (past.length > limit) past.shift()
      future.length = 0
      return true
    },
    undo() {
      if (past.length < 2) return null
      future.push(past.pop())
      return past[past.length - 1]
    },
    redo() {
      if (!future.length) return null
      const s = future.pop()
      past.push(s)
      return s
    },
    get canUndo() { return past.length > 1 },
    get canRedo() { return future.length > 0 },
    reset(state) { past.length = 0; future.length = 0; if (state != null) past.push(state) },
    get current() { return past[past.length - 1] }
  }
}
