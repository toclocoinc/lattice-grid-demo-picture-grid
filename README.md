# Picture grid

A [Lattice Grid](https://www.latticegrid.dev) demo: drop a PNG or JPG and the grid
recreates it from nothing but each cell's own background colour &mdash; one
row per image row, one column per pixel column. Decoding and downsampling
happen entirely in this tab (`createImageBitmap` + `OffscreenCanvas`);
nothing is ever uploaded.

Live: https://toclocoinc.github.io/lattice-grid-demo-picture-grid/

A second page, [`video.html`](https://toclocoinc.github.io/lattice-grid-demo-picture-grid/video.html),
does the same for a dropped MP4/WebM, sampling frames instead of decoding one image — see
[Video grid](#video-grid-videohtml) below.

## What it proves

- **A cell's colour is the grid's own `cell.style`, computed from the value.**
  Every column carries `cell: { style: (p) => ({ background: p.value, color: p.value }) }`;
  the value *is* the `#rrggbb` string, so the whole mosaic is drawn with the
  grid's ordinary per-cell styling path, not a canvas or an image tag layered
  over it.
- **The same grid instance never gets destroyed.** A re-drop, a level change
  and the recolour benchmark below all go through `grid.rows.load()` or
  `grid.rows.queue({ update })` on the one grid `app.js` creates on the first
  drop &mdash; the path the announced mp4 follow-on will reuse for real video
  frames, one `rows.queue()` per decoded frame.
- **Downsampling is area averaging, not point sampling.** `image.js` draws
  the source bitmap, letterboxed to 16:9, into an `OffscreenCanvas` of
  exactly the target grid's pixel dimensions with `imageSmoothingQuality:
  'high'`, then reads every pixel back — the browser's own resampler blends
  the source pixels a target cell covers, rather than picking one of them.
- **The measurement panel's "recolour" number** is the grid's own
  `render:done` phase timing (`phases.totalMs`), not page-side wall-clock.
  Wall-clock time to a JS event handler is at the mercy of whatever else is
  running on the machine; the grid's own account of its layout/hint/write
  phases is measured before the event is even dispatched, so it is the
  number that actually decides whether N frames a second is realistic.

## Levels, and the "no grid changes" note

Owner direction for this demo (2026-09-29): pick the largest level that
fits the grid's own documented column-width/row-height configuration,
without touching the grid itself, and say so here.

All three announced levels — **64 × 36**, **128 × 72** (default) and
**256 × 144** — render: `Column.layout.min` defaults to 40 px but is fully
configurable per column, and an explicit `rowHeight` overrides the
density-derived row height, so nothing here needed a grid change or a
workaround. `cell.style`'s inline `background` paints the full padding box
regardless of the density token's cell padding, so the padding token was
left untouched too — irrelevant to a colour-filled cell, not disabled.

At the panel width this page lays out (roughly 1000–1100 px on a normal
desktop viewport), that puts actual cell size at approximately:

| Level | Columns | Measured cell size (1400px viewport) |
|---|---|---|
| 64 × 36 | 64 | ~21 px |
| 128 × 72 (default) | 128 | ~9 px |
| 256 × 144 | 256 | ~4 px |

128 × 72 is the one landing in the ~8–10 px range the owner asked about; it
renders cleanly. 256 × 144 renders too, well below that range — every cell
is still its own correctly-coloured, individually stylable grid cell (this
was checked, not assumed: `document.querySelectorAll('#grid .lat-cell[data-col]').length`
read back exactly 36,864 = 256 × 144 in the live verification run). At
256 × 144 the fixed 620px-tall grid panel does **not** need to scroll
(144 rows × ~4px fits inside it; measured `scrollHeight === clientHeight`
on the live page) — the WO anticipated a scrollbar here; the actual
measurement says otherwise and this README reports what was measured, not
what was expected. No finding was raised for the small cell size itself:
the owner's direction was to pick the largest working level and say so, not
to card a defect, and nothing here misbehaved.

## A genuine finding, not carded: recolour cost under sandbox load

Building this on the shared development sandbox, the recolour benchmark's
**wall-clock** time per replacement was highly erratic — sometimes fine
(~100 ms), sometimes over 10 seconds for the same 128×72 grid — while two
other processes on the same box (`bench-hf.cjs`, a benchmark; `astro build`,
a site build) were independently using 100%+ CPU each. A minimal, isolated
repro (a bare grid, no image decode, 8 successive full-grid recolours)
showed the grid's own `render:done` phase timing (`phases.totalMs`) stayed
flat at ~55–65 ms across all 8 calls at 128×72, while the wall-clock time to
*receive* that event fluctuated between 90 ms and 350+ ms on the very same
run. That is sandbox scheduling contention delaying event delivery, not a
growing cost inside the grid — DOM node count and JS heap size were also
flat across iterations. This page reports `phases.totalMs`, which is the
correct and stable number for the mp4 go/no-go. No grid change is
implicated and none is requested.

### The six numbers (live page, `phases.totalMs`)

| Level | Decode→painted (wall-clock) | Recolour per replacement (`render:done` `phases.totalMs`) |
|---|---|---|
| 64 × 36 | 38.6 ms | 17.26 ms |
| 128 × 72 (default) | 261.6 ms | 64.66 ms |
| 256 × 144 | 10,172.9 ms | 261.08 ms |

The paint-time column is wall-clock (a real, one-off UX number, so it is
left as measured rather than substituted) and was captured on a busy
shared sandbox with several other release gates running concurrently —
expect it to be lower on a quiet machine; the 256×144 row in particular is
building 36,864 DOM-backed cells from scratch, which is inherently the
most expensive of the three regardless of load. The recolour column is
the one that decides the mp4 follow-on and is immune to that noise: it
stays well under 300 ms per full-grid replacement at every level checked,
including the largest.

## Video grid (`video.html`)

The same idea, driven by a video instead of a still image: drop an MP4/WebM, and every sampled
frame is downsampled the same way (`image.js`'s `downsample`, extended to take an explicit
`srcWidth`/`srcHeight` for a `<video>` element rather than duplicating the letterbox/area-average
logic) and pushed through the grid's own `rows.queue()` — the one grid instance is created once
and never recreated, exactly as `app.js` does for images.

Owner direction (2026-09-29) capped video at the two levels the picture grid's own measured
recolour cost (`render:done` `phases.totalMs`) supports a usable frame rate at: **64 × 36**
(17.3 ms/replacement measured on the picture grid &rarr; 24 fps target, capped 30) and
**128 × 72** (64.7 ms/replacement &rarr; 12 fps target). **256 × 144** (261 ms/replacement) is
disabled for video and says why on the page: at that cost a single replacement already exceeds
the 24fps/12fps frame budgets several times over, so it cannot hold a usable video frame rate —
it stays available on the picture-grid page, where a one-off measurement, not a sustained rate,
is what matters.

Frames are sampled via `requestVideoFrameCallback` (falling back to `requestAnimationFrame`
where unsupported) and are **dropped, never queued**, whenever the previous grid update hasn't
finished (`render:done` not yet fired) or the level's frame-interval hasn't elapsed — never more
than one replacement in flight. The readout reports the fps the grid actually achieves (rolling
1s), `phases.totalMs` per frame, and the dropped-frame count; if achieved fps sits more than 20%
under the level's cap for 2 continuous seconds, the readout says so explicitly (e.g. "grid at
9 fps, capped 12") instead of just showing the low number quietly.

### Sample clip

`sample.webm` (~543 KB, 10s, 640×360): a synthetic animation of six bouncing colour-gradient
blobs over a slowly hue-shifting dark background, generated for this demo by Tocloco Inc — no
external source, no personal data, owned outright. There is no `ffmpeg` on the build box, so it
was produced by drawing the animation to an HTML `<canvas>` and recording it with
`MediaRecorder`/`canvas.captureStream()` inside headless Chrome (`video/webm;codecs=vp9`,
~900 kbps) — a one-off local generation script, not shipped in this repository.

## Known limitations / findings

- The hover readout originally read `e.row.y` for the row coordinate,
  which is always `undefined`: `CellPointerEvent.row` is the grid's
  display-row wrapper, not the raw data object. Fixed to use `e.key`
  (documented as "that row's key"), which for `rowKey: 'y'` already *is*
  the y coordinate. Caught by the live verification run, not assumed.

## Sample image

`sample.jpg`: generated for this demo by Tocloco Inc — a synthetic
diagonal hue gradient with seven flat-colour discs — specifically so the
palette strip has clearly repeated, distinct colours to find. No external
source, no personal data, owned outright.

## Demo code licence

MIT — see [LICENSE](LICENSE). Covers `index.html`, `app.js`, `image.js`, `video.html` and
`video.js` in this repository; it does not relicense Lattice Grid itself, loaded from the CDN
under its own commercial demo licence.
