// Image helpers: decode a dropped/chosen file, downsample it by area averaging
// into a cols x rows grid of hex colours (letterboxed to 16:9), and quantise a
// small palette out of the result. No canvas ever leaves this module; app.js
// only ever sees hex strings and plain arrays, so the same shape can carry a
// video frame later.

/** Decode a File/Blob (PNG or JPG) into a bitmap, entirely in the browser. */
export async function decodeImage(file) {
  return createImageBitmap(file);
}

/**
 * Downsample a bitmap (or any other `drawImage`-able source, e.g. a
 * `<video>` element mid-playback) into a `cols` x `rows` grid of `#rrggbb`
 * strings by area averaging: draw the source, letterboxed to 16:9, into a
 * canvas of exactly that many pixels with high-quality smoothing, then read
 * every pixel back. The browser's own resampler does the averaging; nothing
 * here touches individual source pixels.
 *
 * `srcWidth`/`srcHeight` default to `bitmap.width`/`bitmap.height` (true for
 * an `ImageBitmap`) but are accepted explicitly because a `<video>` element
 * exposes its frame size as `videoWidth`/`videoHeight` instead — the video
 * demo passes those in rather than this module reaching into a DOM element.
 * @param {CanvasImageSource} bitmap decoded image or other drawable source
 * @param {number} cols grid columns (pixel width of the target frame)
 * @param {number} rows grid rows (pixel height of the target frame)
 * @param {string} bg CSS colour painted into the letterbox bars
 * @param {number} [srcWidth] source pixel width, if not `bitmap.width`
 * @param {number} [srcHeight] source pixel height, if not `bitmap.height`
 * @returns {string[][]} rows of `#rrggbb` strings, `rows` long, `cols` wide
 */
export function downsample(bitmap, cols, rows, bg, srcWidth = bitmap.width, srcHeight = bitmap.height) {
  const canvas = new OffscreenCanvas(cols, rows);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cols, rows);

  const targetAspect = cols / rows; // always 16:9 for our three levels
  const srcAspect = srcWidth / srcHeight;
  let dw = cols, dh = rows, dx = 0, dy = 0;
  if (srcAspect > targetAspect) { dh = cols / srcAspect; dy = (rows - dh) / 2; }
  else if (srcAspect < targetAspect) { dw = rows * srcAspect; dx = (cols - dw) / 2; }
  ctx.drawImage(bitmap, dx, dy, dw, dh);

  const { data } = ctx.getImageData(0, 0, cols, rows);
  const grid = [];
  for (let y = 0; y < rows; y++) {
    const line = new Array(cols);
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 4;
      line[x] = toHex(data[i], data[i + 1], data[i + 2]);
    }
    grid.push(line);
  }
  return grid;
}

/** @returns {string} `#rrggbb` for one 0-255 RGB triple. */
export function toHex(r, g, b) {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** @returns {{r:number,g:number,b:number}} the RGB triple for a `#rrggbb` string. */
export function fromHex(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * The most common colours in a downsampled frame, after a coarse quantisation
 * (5 bits per channel) so near-identical anti-aliased pixels count together.
 * @param {string[][]} grid the downsampled frame
 * @param {number} n how many tiles to report
 * @returns {{hex:string, share:number}[]} commonest first, share in [0, 1]
 */
export function palette(grid, n = 8) {
  const counts = new Map();
  let total = 0;
  for (const row of grid) {
    for (const hex of row) {
      const { r, g, b } = fromHex(hex);
      const q = toHex(quantise(r), quantise(g), quantise(b));
      counts.set(q, (counts.get(q) || 0) + 1);
      total += 1;
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([hex, count]) => ({ hex, share: count / total }));
}

/** Reduce an 8-bit channel to 5 bits and back, so nearby shades collapse. */
function quantise(c) {
  const bucket = Math.round((c / 255) * 31);
  return Math.round((bucket / 31) * 255);
}
