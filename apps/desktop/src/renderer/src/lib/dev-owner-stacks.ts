import React from 'react'

/**
 * React's owner stacks, switchable at runtime.
 *
 * They answer "which JSX wrote this element" — the thing you want when a React
 * warning names a component but not the line that produced it. React implements
 * them by calling `console.createTask()` **once per element created**, and
 * capturing a stack that many times is the single most expensive thing the
 * renderer does in development: switching them off roughly halves the time this
 * app spends opening a panel, and takes a threefold run-to-run variance with it
 * (measurements in components/SubtitleList.md).
 *
 * **StrictMode is untouched.** Double rendering and the effect checks live in
 * the reconciler; owner tracking lives in the JSX runtime. Nothing here changes
 * how many times anything renders.
 */

interface Internals {
  recentlyCreatedOwnerStacks: number
}

function internals(): Internals | undefined {
  const held = (
    React as unknown as {
      __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: Internals
    }
  ).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
  // The counter is attached only by a development build of React, so its
  // presence *is* the check for one. Nothing here needs stripping for
  // production: there is simply nothing to take hold of.
  if (held === undefined || !('recentlyCreatedOwnerStacks' in held)) return undefined
  return held
}

/**
 * Turn owner stacks on or off.
 *
 * React already throttles itself — `ownerStackLimit`, 1e4 per second — by
 * counting elements and giving up once the count passes the limit. That limit
 * is a constant inlined at build time, so the counter it is compared against is
 * the only thing left to reach: read it as a value past the limit and the check
 * fails for every element; swallow writes and `resetOwnerStackLimit()` cannot
 * put it back. Both halves are needed, because the counter is incremented with
 * `++`, which reads and then writes.
 *
 * This is React's own throttle turned all the way down, not a bypass of
 * anything — but React does not intend it to be turned, hence the internals.
 * The failure mode is safe: should React rearrange this, the property is gone,
 * the toggle does nothing, and development is merely as slow as it was.
 */
export function setOwnerStacks(on: boolean): void {
  const held = internals()
  if (held === undefined) return
  Object.defineProperty(
    held,
    'recentlyCreatedOwnerStacks',
    on
      ? { value: 0, writable: true, configurable: true }
      : { get: () => Number.MAX_SAFE_INTEGER, set: () => {}, configurable: true }
  )
}

/**
 * Off by default, with one line saying so.
 *
 * Silence would be worse than the speed is worth: a stack quietly missing from
 * a warning is a long detour, while the same warning next to "owner stacks are
 * off" is a menu item away from being answered.
 */
export function initOwnerStacks(): void {
  if (internals() === undefined) return
  setOwnerStacks(false)
  console.info(
    'React owner stacks are off, which makes development roughly twice as fast. ' +
      'Turn them on from the Developer menu when a warning needs to name its source.'
  )
}
