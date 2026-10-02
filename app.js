// Wiring only. Image decode/downsample/palette live in image.js. One grid is
// created once and never destroyed: a drop, a level change and the recolour
// benchmark below all go through rows.load()/rows.queue() on that same
// instance, the path the mp4 follow-on will reuse for real video frames.
import { decodeImage, downsample, fromHex, palette } from './image.js?v=20261003b-0009';

const { createGrid } = LatticeGrid;
const el = (id) => document.getElementById(id);
const LEVELS = [{ cols: 64, rows: 36 }, { cols: 128, rows: 72 }, { cols: 256, rows: 144 }];
const bg = () => getComputedStyle(document.body).backgroundColor || '#ffffff';

let level = 1; // 128 x 72 default
let bitmap = null;
let grid = null;
el('version').textContent = LatticeGrid.getVersion ? LatticeGrid.getVersion() : '';

// Console log of every stage, so a stall or a failure says where it happened.
const T0 = performance.now();
const log = (...args) => console.info(`[picture-grid +${((performance.now() - T0) / 1000).toFixed(2)}s]`, ...args);
const fail = (stage, err) => {
  console.error(`[picture-grid] FAILED at ${stage}:`, err);
  el('status').textContent = `Failed at ${stage}: ${err && err.message ? err.message : err}`;
};
window.addEventListener('error', (e) => console.error('[picture-grid] window error:', e.message, e.filename, e.lineno));
window.addEventListener('unhandledrejection', (e) => console.error('[picture-grid] unhandled rejection:', e.reason));
log('script started; grid', LatticeGrid.getVersion ? LatticeGrid.getVersion() : '(version unknown)',
  '| OffscreenCanvas', typeof OffscreenCanvas !== 'undefined', '| createImageBitmap', typeof createImageBitmap !== 'undefined');

/** Build one grid row per image row: `{ y, x0: '#hex', x1: '#hex', ... }`. */
function toRows(frame) {
  return frame.map((line, y) => {
    const row = { y };
    for (let x = 0; x < line.length; x++) row[`x${x}`] = line[x];
    return row;
  });
}

/** One column per pixel: fixed square width, coloured by its own value (showHeader hides sort/filter chrome). */
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

/** Create the grid once (and bind the hover readout to it), or resize it in place. */
function ensureGrid(cols, size) {
  if (grid) { grid.set('columns', toColumns(cols, size)); grid.set('rowHeight', size); return; }
  grid = createGrid(el('grid'), {
    rowKey: 'y', rows: [], columns: toColumns(cols, size), rowHeight: size,
    showHeader: false, rowNumbers: false, gridLines: 'none', selection: 'none', filterRow: false, overscan: 4,
  });
  grid.on('cell:mouseover', (e) => {
    const { r, g, b } = fromHex(e.value);
    // e.key is the row's key (rowKey: 'y'), i.e. the y coordinate itself.
    el('readout').textContent = `${e.value} — rgb(${r}, ${g}, ${b}) — (${Number(e.colId.slice(1))}, ${e.key})`;
  });
}

/**
 * Wait for the one render pass a row change causes and return the grid's own
 * `render:done` phase timing (`phases.totalMs`) rather than a wall-clock
 * delta: this tab's JS event loop shares the machine with everything else
 * on it, so wall-clock time to *deliver* the event is noisy under load, but
 * the grid's own account of how long its layout/hint/write phases took is
 * not — it is measured before the event is even dispatched.
 */
function timedApply(rows) {
  return new Promise((resolve) => {
    grid.once('render:done', (e) => resolve(e.phases.totalMs));
    grid.rows.queue({ update: rows });
  });
}

/** Re-render the current bitmap at `level`, timing decode-complete-to-painted. */
async function renderLevel() {
  const { cols, rows } = LEVELS[level];
  const size = cellSize();
  const tD = performance.now();
  const frame = downsample(bitmap, cols, rows, bg());
  log(`analysed picture at ${cols} × ${rows}: ${(performance.now() - tD).toFixed(1)} ms, cell size ${size} px, top-left ${frame[0][0]}`);
  const rowData = toRows(frame);
  ensureGrid(cols, size);
  const t0 = performance.now();
  await new Promise((resolve) => { grid.once('render:done', resolve); grid.rows.load(rowData); });
  const ms = performance.now() - t0;
  log(`grid painted ${cols} × ${rows} = ${cols * rows} cells in ${ms.toFixed(1)} ms`);
  return { ms, frame };
}

/** Steady-state recolour cost: flip between a frame and its colour inverse. */
async function measureRecolour(frame, iterations = 5) {
  const rowsA = toRows(frame);
  const rowsB = toRows(frame.map((line) => line.map((hex) => {
    const { r, g, b } = fromHex(hex);
    return `#${[255 - r, 255 - g, 255 - b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  })));
  let total = 0;
  for (let i = 0; i < iterations; i++) total += await timedApply(i % 2 === 0 ? rowsB : rowsA);
  log(`recolour benchmark: ${(total / iterations).toFixed(2)} ms per full replacement (${iterations} runs)`);
  return total / iterations;
}

function renderPalette(frame) {
  el('palette').innerHTML = palette(frame, 8).map(({ hex, share }) =>
    `<div class="tile"><span class="sw" style="background:${hex}"></span>${hex} <b>${(share * 100).toFixed(1)}%</b></div>`).join('');
}

/** Cycle every level once: paints each, records both timings, leaves `level` showing. */
async function measureAllLevels() {
  const results = [];
  const chosen = level;
  log('measuring all three levels (paints each once and benchmarks the recolour; the 256 × 144 pass takes several seconds)…');
  for (let i = 0; i < LEVELS.length; i++) {
    level = i;
    const { ms, frame } = await renderLevel();
    const recolour = await measureRecolour(frame);
    results.push({ level: `${LEVELS[i].cols} × ${LEVELS[i].rows}`, paint: ms.toFixed(1), recolour: recolour.toFixed(2) });
  }
  level = chosen;
  const { frame } = await renderLevel();
  renderPalette(frame);
  el('measure').innerHTML = results.map((r) => `<tr><td>${r.level}</td><td>${r.paint} ms</td><td>${r.recolour} ms</td></tr>`).join('');
  log('measurements done', results);
  window.__demo = { grid, results, frame };
}

async function openFile(file) {
  log(`file received: "${file.name}" (${file.type || 'no type'}, ${(file.size / 1024).toFixed(0)} KB)`);
  el('status').textContent = `Decoding "${file.name}"…`;
  let stage = 'decode';
  try {
    const tD = performance.now();
    bitmap = await decodeImage(file);
    log(`decoded "${file.name}": ${bitmap.width} × ${bitmap.height} px in ${(performance.now() - tD).toFixed(1)} ms`);
    el('status').textContent = `"${file.name}": ${bitmap.width}×${bitmap.height}, painting ${LEVELS[level].cols} × ${LEVELS[level].rows}…`;
    stage = 'analyse + paint';
    const { frame } = await renderLevel();
    renderPalette(frame);
    el('measure').innerHTML = '';
    window.__demo = { grid, frame };
    el('status').textContent = `"${file.name}" — showing ${LEVELS[level].cols} × ${LEVELS[level].rows}.`;
    log(`done: "${file.name}" showing ${LEVELS[level].cols} × ${LEVELS[level].rows}`);
  } catch (err) {
    fail(stage, err);
  }
}

// The three-level benchmark is opt-in: it repaints every level and runs five
// recolours each, which takes tens of seconds and would make a fresh drop look stuck.
el('measure-btn').addEventListener('click', async () => {
  if (!bitmap) return;
  el('measure-btn').disabled = true;
  el('status').textContent = 'Measuring every level (this takes a while; watch the console)…';
  try { await measureAllLevels(); el('status').textContent = `Measured — showing ${LEVELS[level].cols} × ${LEVELS[level].rows}.`; }
  catch (err) { fail('measure', err); }
  el('measure-btn').disabled = false;
});

for (const [i, input] of [...document.querySelectorAll('[name=level]')].entries()) {
  input.addEventListener('change', async () => {
    if (!input.checked || !bitmap) return;
    level = i;
    log(`level changed to ${LEVELS[i].cols} × ${LEVELS[i].rows}`);
    const { frame } = await renderLevel();
    renderPalette(frame);
  });
}

new ResizeObserver(() => { if (bitmap && grid) ensureGrid(LEVELS[level].cols, cellSize()); }).observe(el('grid'));

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
el('grid').addEventListener('mouseleave', () => { el('readout').textContent = 'Hover a cell…'; });

log('fetching sample.jpg…');
fetch('sample.jpg')
  .then((r) => { log(`sample.jpg fetched: HTTP ${r.status}`); return r.blob(); })
  .then((b) => openFile(new File([b], 'sample.jpg', { type: 'image/jpeg' })))
  .catch((err) => fail('fetch sample.jpg', err));
