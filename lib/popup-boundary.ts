"use client"

import * as React from "react"

/**
 * The document body, for use as a popup collision boundary.
 *
 * Base UI confines a popup to its anchor's *clipping ancestors* by default.
 * The popup renders in a portal, but that boundary is still computed from the
 * trigger — so a trigger inside any `overflow-hidden` container gets its popup
 * clipped, typically in half. Every `Card` in this design system sets
 * `overflow-hidden` (it clips images to the rounded corners), and filter chips,
 * selects and buttons all live inside cards, so the default is wrong here far
 * more often than it is right.
 *
 * The body is the boundary that actually means something for a floating layer.
 *
 * Resolved lazily rather than in an effect: a popup only mounts on interaction,
 * long after hydration, so the body is already there. Waiting for an effect
 * would position the first frame against the wrong boundary and visibly jump.
 */
export function useBodyBoundary(): Element | undefined {
  const [boundary] = React.useState<Element | undefined>(() =>
    typeof document === "undefined" ? undefined : document.body,
  )
  return boundary
}
