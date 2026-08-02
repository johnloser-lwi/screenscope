/**
 * Compute R, G, B and luma level histograms over the whole frame.
 *
 * All four planes live in one array so the worker only pays for a single
 * transfer. Float32 rather than Uint32 because the luma plane uses fractional
 * sub-bin splatting; counts stay exact up to 2^24 samples, well past the
 * 1920×1080 (~2M) ceiling the capture engine imposes.
 *
 * @param {Uint8ClampedArray} rgba
 * @param {number} width
 * @param {number} height
 * @returns {Float32Array} length 256*4 — four contiguous 256-bin planes
 *   laid out as [R | G | B | Y], indexed [plane*256 + level]
 */
export function computeHistogram(rgba, width, height) {
  const out = new Float32Array(256 * 4);
  const total = width * height;

  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    const R = rgba[idx];
    const G = rgba[idx + 1];
    const B = rgba[idx + 2];

    out[R]++;
    out[256 + G]++;
    out[512 + B]++;

    // Same BT.709 coefficients and sub-bin splatting as the luma waveform,
    // so the two scopes agree on where a level sits.
    const Yf = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    const Y0 = Yf | 0;
    const frac = Yf - Y0;
    const Y1 = Y0 < 255 ? Y0 + 1 : 255;
    out[768 + Y0] += 1 - frac;
    out[768 + Y1] += frac;
  }

  // Normalise so a bin holding every pixel in the frame reads 1.0
  const inv = 1 / total;
  for (let i = 0; i < out.length; i++) out[i] *= inv;

  return out;
}
