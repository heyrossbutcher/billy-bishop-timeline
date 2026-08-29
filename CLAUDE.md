# Billy Bishop Timeline

Interactive 3D timeline of Billy Bishop Toronto City Airport's history (1931–2014). Events float along a horizontal/vertical spine in a Three.js scene; zooming in reveals detail cards fetched from Sanity CMS.

- **Live site:** https://billy-bishop-timeline.vercel.app/
- **GitHub:** https://github.com/heyrossbutcher/billy-bishop-timeline
- **Sanity studio:** https://billy-bishop-timeline.sanity.studio/

## Stack

- Vite (dev server + build)
- Three.js + CSS3DRenderer (r0.185)
- @sanity/client (v7) — content fetched at runtime
- Plain CSS, Inter font via Google Fonts
- Deployed on Vercel; Sanity webhook triggers auto-rebuild on content save

## File Structure

```
Timeline/
├── src/
│   ├── main.js          ← all Three.js scene logic
│   ├── style.css        ← all styles
│   ├── sanity.js        ← Sanity client + fetchEvents()
│   └── data/
│       └── events.js    ← local fallback event data (6 events)
├── public/
│   ├── favicon.svg
│   └── icons.svg
├── studio/              ← separate Sanity Studio sub-project (treat independently)
├── package.json
└── CLAUDE.md
```

## Running Locally

```bash
npm run dev      # Vite dev server
npm run build    # production build
npm run preview  # preview production build
```

Studio is a separate project — `cd studio && npm run dev` to run it locally.

## Sanity CMS

- **Project ID:** er1m8omu
- **Dataset:** production
- **Schema:** `event` type with fields: `year` (number), `title` (string), `description` (text)
- **GROQ query:** `*[_type == "event"] | order(year asc) { year, title, description }`
- **CORS:** Vercel URL is whitelisted in Sanity project settings
- **Deploy hook:** "Vercel Deploy" webhook in Sanity triggers a Vercel rebuild on publish

## Data Flow

On boot, `main.js` calls `fetchEvents()` from `sanity.js`. If Sanity returns events, they're used; otherwise the app falls back to the 6 hardcoded events in `src/data/events.js`. The fallback is for local dev without network access — production should always pull from Sanity.

## Scene Architecture (`main.js`)

Two Three.js renderers stacked on top of each other:

1. **WebGLRenderer** — draws the backbone line, dots, and glow sprites
2. **CSS3DRenderer** (on top) — draws year labels and event cards as real DOM elements via `CSS3DObject`

### Layout modes

Breakpoint: `728px`. Below that, layout switches from horizontal to vertical.

- **Horizontal** — events spaced 600 units apart along the X axis; cards alternate above/below the spine; camera pans left/right
- **Vertical** — events spaced 260 units apart along the Y axis; cards centred on the dot; camera pans up/down

`buildScene(isVertical)` tears down and rebuilds the full scene when the breakpoint is crossed.

### Zoom states

Camera Z range: 350 (close) → 1800 (far). Threshold: 1075.

- **Zoomed out** (Z ≥ 1075) — year labels visible, cards hidden
- **Zoomed in** (Z < 1075) — cards visible, year labels hidden, connector lines visible

`setZoomState()` manages opacity and pointer-events on the CSS3D elements.

### Key constants

```js
SPACING       = 600    // horizontal event gap (THREE units)
VERT_SPACING  = 260    // vertical event gap
CARD_SCALE    = 0.5    // CSS3DObject scale factor
FOV           = 50
MIN_Z         = 350    // closest zoom
MAX_Z         = 1800   // furthest zoom
INITIAL_Z     = 1500
THRESHOLD_Z   = 1075   // zoom state switch point
BREAKPOINT    = 728    // px — horizontal ↔ vertical layout switch
```

### Interaction

- **Mouse drag** — pans the timeline
- **Scroll wheel** — horizontal scroll pans, vertical scroll zooms (axes flip in vertical mode)
- **Click dot or year label** — zooms to that event (targetZ = 480)
- **Touch** — single-touch drag to pan
- **Keyboard** — arrow keys pan/zoom, Escape resets zoom

All camera movement uses `lerp(current, target, 0.09)` for smooth easing.

## Styles (`style.css`)

Dark theme, `#0a0a0a` background. All overflow hidden (full-screen canvas).

Key classes:
- `.year-label` — 38px bold white, dark bg to mask line behind it, fades on hover
- `.timeline-card` — 280px wide, dark card (#111), opacity 0 by default (shown when zoomed in)
- `.card-year`, `.card-title`, `.card-desc` — card content hierarchy
- `#title-block` — fixed top-right HUD (airport name + subtitle)
- `#hint` — fixed bottom-center, fades out after 5s

## Notes

- `counter.js` in `src/` is the Vite starter scaffold remnant — unused, can be deleted
- The `studio/` subfolder is a completely separate npm project with its own `node_modules`
- Glow texture is generated procedurally via Canvas API (no image file needed)
- Line2/LineGeometry/LineMaterial from Three.js addons are used for the backbone to support pixel-width lines (native THREE.Line ignores linewidth on most GPUs)
