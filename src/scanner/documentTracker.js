// ─── Holding the frame still ──────────────────────────────────────────────────
// Detection is per-frame and independent, so its answer moves a little every
// time even when nothing in front of the camera has. Drawn straight to the
// screen that reads as the frame dancing, which is most of what made the old
// scanner feel broken — it was never mainly an accuracy problem.
//
// This is the second attempt. The first averaged the last eight detections with
// linear weights, froze the drawn outline below a 3% threshold, and faded on a
// dropped frame. Reported back as "still a bit sluggish and sloppy, deviates all
// over the place", which is fair, and the three faults were separate:
//
//   1. SLUGGISH. In an eight-frame weighted mean the newest detection carries
//      8/36 of the answer, so about four fifths of the outline is where the page
//      *was*. At ten detections a second that is half a second of lag, plainly
//      visible while lining the phone up.
//
//   2. DEVIATES. A single wrong detection — a form's header rule, a bench edge —
//      was blended in at that same 8/36, so one bad frame in ten dragged the
//      outline a long way off and eight more were needed to recover. The mean has
//      no notion of an answer being wrong, only of it being recent.
//
//   3. STICKY, THEN JUMPY. Freezing the outline until the mean had moved 3% and
//      then moving it all at once is a worse artefact than the jitter it was
//      hiding: it turns smooth drift into a series of visible steps.
//
// So: exponential smoothing whose gain depends on whether the movement is going
// anywhere, a jump gate that makes a distant detection prove itself before it is
// believed, and no freeze at all. One window cannot be both steady on a still
// page and quick on a moving one; a gain that varies can be.
//
// The gain keys off *direction*, not distance, and that distinction is the whole
// design — see trackDrift. Keying it off distance was the obvious thing and it is
// wrong: the detector's noise moves its answer a long way every frame, so noise
// scored as movement and was followed at the fast gain.
//
// Nothing here needs a camera or a canvas, so all of it is testable directly, and
// `documentTracker.test.js` measures the two things being complained about —
// wobble on a still page, and lag behind a moving one — as numbers.

/** The furthest any one corner has moved, in frame widths. */
export function maxCornerShift(a, b) {
  if (!a || !b) return Infinity
  let worst = 0
  for (let i = 0; i < 4; i++) {
    worst = Math.max(worst, Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y))
  }
  return worst
}

function lerpCorners(from, to, alpha) {
  return from.map((c, i) => ({
    x: c.x + (to[i].x - c.x) * alpha,
    y: c.y + (to[i].y - c.y) * alpha
  }))
}

/**
 * Why the scanner is not about to capture, in the words the overlay uses.
 * Ordered by what the person should do about it first.
 */
export const HOLD_REASONS = {
  searching: 'Point at the form',
  small: 'Move closer',
  dark: 'More light needed',
  moving: 'Hold still',
  ready: 'Hold still'
}

export class DocumentTracker {
  constructor(options = {}) {
    const {
      // How much of a new detection is taken when the page has barely moved.
      // Low, because at this end the movement being tracked is mostly the
      // detector's own noise: a page held still should look nailed down.
      calmGain = 0.12,
      // And when it has plainly moved. High, because at this end the movement is
      // real and the only thing that matters is not trailing behind it.
      quickGain = 0.65,
      // The shift at which the gain reaches quickGain, given movement that is
      // going somewhere. A phone being aimed moves several percent of frame width
      // between frames. This and `driftMemory` are the two numbers to turn if the
      // outline feels either slow or twitchy.
      responsiveShift = 0.045,
      // How quickly the sense of "which way is this going" updates. About three
      // frames, so a genuine movement is recognised as one almost at once while
      // still being long enough for cancelling noise to cancel.
      driftMemory = 0.35,
      // Past this, a detection is not smoothed towards at all — it is treated as
      // a claim that the page is somewhere else entirely, and has to be repeated
      // before it is believed. This is what stops a wrong quad from dragging the
      // outline, and it is most of the fix for "deviates all over the place".
      //
      // 7% of frame width, and the value was measured rather than chosen: the
      // detector's occasional wrong answers on the bench land 8-10% out, so a 12%
      // gate let every one of them through to be smoothed towards.
      jumpTolerance = 0.07,
      // How many consecutive agreeing detections that claim needs.
      //
      // Three, and two is genuinely not enough — this was measured as well. A
      // detector's wrong answer on a given scene is usually the *same* wrong
      // answer each time, so with two confirmations it only has to come up twice
      // in a row to be believed, and then the outline snaps a full 8% onto it.
      // Going to three took the worst jump on the bench from 8.34% to 0.10%.
      //
      // The cost is that genuinely re-aiming at a different page takes three
      // detections to lock, about a fifth of a second. That is not perceptible;
      // the outline snapping onto a bench edge is.
      jumpConfirmations = 3,
      // A dropped frame is normal; a page that has left the picture is not. Long
      // enough to ride out the former, short enough that the latter does not
      // leave a stale outline sitting on screen.
      holdMs = 500,
      // How still counts as still, and for how long. A hand holding a phone is
      // never actually still, and at 1.5% of frame width it never qualified.
      stillTolerance = 0.022,
      stillForMs = 800,
      // How much smoothing has to have happened before the outline is trusted
      // enough to fire the shutter. Replaces "the history buffer is full", which
      // is not a thing any more.
      settleFrames = 5,
      // How much of the frame the page has to cover before the shutter will fire
      // on its own, as a fraction of the *most* it could ever cover — see
      // fillFraction, and note a portrait page in a landscape frame cannot exceed
      // about 40% of it, so a threshold against the raw frame area is unreachable.
      //
      // This has now been wrong in both directions. At 0.6 auto-capture stopped
      // working the moment the detector was fixed to prefer the page over the
      // table it was lying on: the table had been filling the frame, and a page
      // does not. Held at a normal working distance in a portrait frame a page
      // covers about 28% — and there `most` is near 1.0, so fill is roughly the
      // raw area — which sat permanently under the old threshold and left the
      // scanner advising "Move closer" for ever.
      //
      // 0.25 is just under that, and the detector will not report a page below 20%
      // of the frame at all, so the two are consistent: nearly anything detected
      // and held still is worth capturing. A page half the width of the frame
      // still lands about a thousand pixels across on a 1920-wide capture, which
      // is enough to read a lot number from.
      minFill = 0.25,
      minContrast = 0.22
    } = options

    this.calmGain = calmGain
    this.quickGain = quickGain
    this.responsiveShift = responsiveShift
    this.driftMemory = driftMemory
    this.jumpTolerance = jumpTolerance
    this.jumpConfirmations = jumpConfirmations
    this.holdMs = holdMs
    this.stillTolerance = stillTolerance
    this.stillForMs = stillForMs
    this.settleFrames = settleFrames
    this.minFill = minFill
    this.minContrast = minContrast
    this.reset()
  }

  reset() {
    this.estimate = null
    // Per corner: which way it has lately been going, and how fast, kept apart so
    // they can be compared. See gainFor.
    this.drift = null
    this.speed = null
    this.frames = 0
    this.pending = null
    this.pendingCount = 0
    this.lastSeenAt = null
    this.stillSince = null
    this.latest = null
  }

  /**
   * Updates the sense of where each corner is heading, and returns how consistent
   * that heading is: 0 for movement that cancels itself out, 1 for movement in a
   * straight line.
   *
   * This is the part that took two goes. Scaling the gain by how *far* a detection
   * has moved is wrong, because the detector's own noise moves it a long way every
   * single frame — alternating a couple of percent either side of the truth is a
   * large shift each time, so noise was collected at the fast gain and passed
   * almost half of itself straight through to the screen. Which is the sloppiness
   * this was supposed to remove.
   *
   * What separates the two is not size but direction. Noise reverses every frame,
   * so a smoothed delta vector shrinks towards nothing while the average *length*
   * of those deltas stays high; real movement keeps pointing the same way, so the
   * two stay equal. Their ratio is that distinction, and it costs four vectors.
   *
   * Kept per corner rather than averaged over them, because the corners of a page
   * being moved closer travel in four opposing directions — an average across
   * them cancels exactly as noise does, and zooming in would have been treated as
   * something to ignore.
   */
  trackDrift(deltas) {
    if (!this.drift) {
      // One sample is perfectly consistent with itself, which is the right answer
      // here: a page that has just started moving should be followed at once, and
      // only movement that then contradicts itself should be damped.
      this.drift = deltas.map(d => ({ x: d.x, y: d.y }))
      this.speed = deltas.map(d => Math.hypot(d.x, d.y))
      return 1
    }
    const k = this.driftMemory
    let total = 0
    for (let i = 0; i < 4; i++) {
      this.drift[i] = {
        x: this.drift[i].x + (deltas[i].x - this.drift[i].x) * k,
        y: this.drift[i].y + (deltas[i].y - this.drift[i].y) * k
      }
      const magnitude = Math.hypot(deltas[i].x, deltas[i].y)
      this.speed[i] = this.speed[i] + (magnitude - this.speed[i]) * k
      const heading = Math.hypot(this.drift[i].x, this.drift[i].y)
      total += this.speed[i] > 1e-9 ? Math.min(1, heading / this.speed[i]) : 0
    }
    return total / 4
  }

  /**
   * How much of a new detection to believe.
   *
   * A fixed gain has to be chosen against a still page or against a moving one,
   * and whichever is chosen the other case is wrong. This one needs both the
   * movement to be large and to be going somewhere.
   */
  gainFor(shift, consistency) {
    // Squared, because consistency does not fall to zero for alternating noise —
    // a smoothed reversing signal keeps about a fifth of its amplitude, which was
    // enough to roughly double the wobble reaching the screen. Squaring costs
    // nothing where the movement is real, since one squared is one, and it turns
    // that fifth into a twentieth.
    const t = Math.min(1, shift / this.responsiveShift) * consistency * consistency
    return this.calmGain + (this.quickGain - this.calmGain) * t
  }

  /**
   * @param {{corners, areaFraction, contrast}|null} detection
   * @param {number} now  milliseconds, monotonic
   * @returns {{corners, opacity, locked, stillFor, countdown, readyToCapture, reason}}
   */
  update(detection, now) {
    if (!detection) {
      const since = this.lastSeenAt == null ? Infinity : now - this.lastSeenAt
      if (since > this.holdMs) {
        // Gone. Everything resets, so a page reappearing is tracked afresh
        // rather than eased across the screen from where the last one was.
        this.reset()
        return this.view(null, 0, now)
      }
      // Fading, and no longer a candidate for capture: an outline nobody can
      // currently see the edges of must not trigger a photograph.
      this.stillSince = null
      return this.view(this.estimate, 1 - since / this.holdMs, now)
    }

    this.latest = detection
    this.lastSeenAt = now
    const corners = detection.corners

    if (!this.estimate) {
      // First sight of a page: take it whole. Easing in from nowhere would draw
      // an outline that is wrong in a way the person can see.
      this.estimate = corners
      this.frames = 1
      this.stillSince = now
      return this.view(this.estimate, 1, now)
    }

    const shift = maxCornerShift(this.estimate, corners)

    if (shift > this.jumpTolerance) {
      // Too far to be the page having moved between two frames. Either the
      // detector has latched onto something else for one frame, or the phone
      // really has been pointed somewhere new — and those are told apart by
      // whether the next detection says the same thing.
      const consistent = this.pending && maxCornerShift(this.pending, corners) <= this.jumpTolerance
      this.pendingCount = consistent ? this.pendingCount + 1 : 1
      this.pending = corners

      if (this.pendingCount >= this.jumpConfirmations) {
        // Confirmed: snap rather than glide. Sliding an outline across the screen
        // to a different page looks like the scanner is confused about which one
        // it is looking at.
        this.estimate = corners
        this.frames = 1
        this.drift = null
        this.speed = null
        this.pending = null
        this.pendingCount = 0
        this.stillSince = now
      }
      // Unconfirmed, and the outline has not moved — so the stillness clock is
      // deliberately *not* restarted. Rejecting a detection as noise for the
      // purpose of drawing and then trusting it enough to make the shutter wait
      // is incoherent, and it has a cost: a camera producing an outlier more often
      // than once every `stillForMs` could never auto-capture at all, however
      // still the page was. A jump that is real gets confirmed within three
      // frames, and that path does restart the clock.
      return this.view(this.estimate, 1, now)
    }

    // A believable detection clears any half-made claim of a jump.
    this.pending = null
    this.pendingCount = 0

    const consistency = this.trackDrift(
      corners.map((c, i) => ({ x: c.x - this.estimate[i].x, y: c.y - this.estimate[i].y })))
    const moved = lerpCorners(this.estimate, corners, this.gainFor(shift, consistency))
    // Stillness is judged on the estimate's own movement, which is the thing
    // being drawn — so what the person sees settle is what arms the shutter.
    if (maxCornerShift(this.estimate, moved) > this.stillTolerance) this.stillSince = now
    this.estimate = moved
    this.frames += 1

    return this.view(this.estimate, 1, now)
  }

  view(corners, opacity, now) {
    const stillFor = this.stillSince == null ? 0 : now - this.stillSince
    // Enough frames smoothed for the outline to mean something. It is drawn from
    // the first one either way — waiting would look like a failure to detect —
    // but it is not called locked and cannot trigger a capture.
    const settled = Boolean(corners) && this.frames >= this.settleFrames
    const area = this.latest?.areaFraction ?? 0
    const contrast = this.latest?.contrast ?? 0
    // Falls back to the raw area only for callers that do not supply a fill,
    // which is tests and nothing else.
    const fill = this.latest?.fill ?? area

    let reason = 'searching'
    if (corners) {
      if (fill < this.minFill) reason = 'small'
      else if (contrast < this.minContrast) reason = 'dark'
      else reason = settled && stillFor > 0 ? 'ready' : 'moving'
    }

    const eligible = reason === 'ready' && settled && opacity === 1
    return {
      corners,
      opacity,
      locked: settled && stillFor >= this.stillForMs * 0.25,
      stillFor,
      // 0 to 1 across the wait, for the overlay to show what is about to happen.
      countdown: eligible ? Math.min(1, stillFor / this.stillForMs) : 0,
      readyToCapture: eligible && stillFor >= this.stillForMs,
      reason,
      hint: HOLD_REASONS[reason],
      areaFraction: area,
      fill,
      contrast
    }
  }
}
