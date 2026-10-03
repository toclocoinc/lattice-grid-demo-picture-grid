// Wiring only. Downsampling reuses image.js's `downsample` (extended there,
// not duplicated, to accept an explicit source size for a <video> element).
// One grid is created once and never destroyed: every sampled frame goes
// through the same `rows.queue()` path the picture grid's recolour
// benchmark used, never `createGrid` again.
import { downsample } from './image.js?v=20261003u';

const { createGrid } = LatticeGrid;
const el = (id) => document.getElementById(id);
const LEVELS = [{ cols: 64, rows: 36, cap: 24 }, { cols: 128, rows: 72, cap: 12 }];
const bg = () => getComputedStyle(document.body).backgroundColor || '#ffffff';
const video = el('src-video');

// Every sampled frame is queued straight into the grid: its change model folds updates per row key and
// paints them on the next animation frame, so a frame that lands before the previous one painted simply
// overwrites the same rows (correct for video). Waiting for `render:done` before accepting the next frame
// cost three to four screen refreshes per grid frame (15 fps against a 4 ms paint), so nothing waits now.
// frameTimes: timestamps of paints the grid reported (`render:done`), last 1s, for the rolling fps.
// lowSince: when the fps shortfall started, or null. lastSampled: the cap's own clock. looping: an
// rVFC/rAF chain is armed (guards against a parallel one). dropped: frames the cap deliberately skipped.
let level = 0, grid = null, dropped = 0, lastMs = 0, lowSince = null, lastSampled = 0, looping = false, frameTimes = [];
let needsLoad = true; // next frame must be rows.load() (creates rows); set whenever ensureGrid reconfigures dimensions
el('version').textContent = LatticeGrid.getVersion ? LatticeGrid.getVersion() : '';
video.loop = true;

/** Build one grid row per frame row: `{ y, x0: '#hex', x1: '#hex', ... }`. */
function toRows(frame) {
  return frame.map((line, y) => {
    const row = { y };
    for (let x = 0; x < line.length; x++) row[`x${x}`] = line[x];
    return row;
  });
}

/** One column per pixel, coloured by its own value (showHeader hides sort/filter chrome). */
function toColumns(cols, width) {
  const out = new Array(cols);
  const style = (p) => ({ background: p.value, color: p.value });
  for (let x = 0; x < cols; x++) {
    out[x] = { field: `x${x}`, id: `x${x}`, layout: { width, min: 1, resizable: false, movable: false }, cell: { style } };
  }
  return out;
}

/** Container width / columns, square; the grid's own rowHeight follows it. */
function cellSize() {
  return Math.max(1, Math.floor(el('grid').clientWidth / LEVELS[level].cols));
}

/** Create the grid once, or resize/recolumn it in place for a level switch. */
function ensureGrid(cols, size) {
  needsLoad = true;
  if (grid) { grid.set('columns', toColumns(cols, size)); grid.set('rowHeight', size); return; }
  grid = createGrid(el('grid'), {
    rowKey: 'y', rows: [], columns: toColumns(cols, size), rowHeight: size,
    showHeader: false, rowNumbers: false, gridLines: 'none', selection: 'none', filterRow: false, overscan: 4,
  });
  // Every paint the grid reports counts as one achieved frame; its own phase timing is the ms/frame.
  grid.on('render:done', (e) => { lastMs = e.phases.totalMs; frameTimes.push(performance.now()); });
}

/** Rolling-1s achieved fps from the timestamps of frames actually applied. */
function fps(now) {
  frameTimes = frameTimes.filter((t) => now - t <= 1000);
  return frameTimes.length;
}

/** Update the readout, including the honesty line when sustained below cap. */
function paintReadout(now) {
  const cap = LEVELS[level].cap;
  const achieved = fps(now);
  const short = achieved < cap * 0.8;
  if (short && lowSince === null) lowSince = now;
  if (!short) lowSince = null;
  const honest = short && lowSince !== null && now - lowSince >= 2000;
  el('readout').classList.toggle('warn', honest);
  el('readout').textContent =
    `${achieved} fps (cap ${cap})\n${lastMs.toFixed(1)} ms/frame\n${dropped} dropped` +
    (honest ? `\ngrid at ${achieved} fps, capped ${cap}` : '');
}

/** One sampled frame: downsample the video's current picture and queue it; the grid folds and paints on its next frame. */
function sampleFrame() {
  const { cols, rows } = LEVELS[level];
  if (video.paused || video.ended) return;
  const rowData = toRows(downsample(video, cols, rows, bg(), video.videoWidth, video.videoHeight));
  if (needsLoad) { needsLoad = false; grid.rows.load(rowData); } else grid.rows.queue({ update: rowData });
}

/** The per-video-frame (or rAF fallback) callback: enforces the level's fps cap by dropping, not queueing. */
function onVideoFrame(now) {
  if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(onVideoFrame); // stays armed through a pause
  else if (!video.paused) requestAnimationFrame(() => onVideoFrame(performance.now()));
  else { looping = false; return; } // rAF fallback: chain dies on pause, startLoop() re-arms it on the next play
  const interval = 1000 / LEVELS[level].cap;
  if (now - lastSampled < interval) { if (!video.paused) dropped++; return; }
  lastSampled = now;
  sampleFrame();
}

/** Arm the sampling chain, once: a no-op if it (or its dormant rVFC registration) is already running. */
function startLoop() {
  if (looping) return;
  looping = true;
  onVideoFrame(performance.now());
}

function switchLevel(i) {
  level = i;
  ensureGrid(LEVELS[i].cols, cellSize());
  dropped = 0; frameTimes = []; lowSince = null; lastSampled = 0;
}

for (const [i, input] of [...document.querySelectorAll('[name=level]')].entries()) {
  input.addEventListener('change', () => { if (input.checked) switchLevel(i); });
}
el('loop').addEventListener('change', (e) => { video.loop = e.target.checked; });
el('play').addEventListener('click', () => { video.paused ? video.play() : video.pause(); });
video.addEventListener('play', () => { el('play').textContent = 'Pause'; startLoop(); });
video.addEventListener('pause', () => { el('play').textContent = 'Play'; });
new ResizeObserver(() => { if (grid) ensureGrid(LEVELS[level].cols, cellSize()); }).observe(el('grid'));

// Frozen while paused (not recomputed against a clock that kept moving) so the readout visibly stops, not decays.
setInterval(() => { if (!video.paused) paintReadout(performance.now()); }, 200);

async function openFile(file) {
  el('status').textContent = `Loading "${file.name}"…`;
  video.src = URL.createObjectURL(file);
  await new Promise((resolve) => video.addEventListener('loadeddata', resolve, { once: true }));
  ensureGrid(LEVELS[level].cols, cellSize());
  dropped = 0; frameTimes = []; lowSince = null;
  el('status').textContent = `"${file.name}" — ${video.videoWidth}×${video.videoHeight}, nothing uploaded.`;
  looping = false;
  video.play();
}

for (const zone of [document.body, el('dropzone')]) {
  zone.addEventListener('dragover', (e) => { e.preventDefault(); el('dropzone').hidden = false; });
  zone.addEventListener('dragleave', () => { el('dropzone').hidden = true; });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    el('dropzone').hidden = true;
    const file = e.dataTransfer.files[0];
    if (file) openFile(file);
  });
}
el('pick').addEventListener('click', () => el('file-input').click());
el('file-input').addEventListener('change', (e) => { if (e.target.files[0]) openFile(e.target.files[0]); });

fetch('sample.webm').then((r) => r.blob()).then((b) => openFile(new File([b], 'sample.webm', { type: 'video/webm' })));
