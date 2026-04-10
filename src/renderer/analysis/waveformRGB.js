/**
 * Compute three per-channel waveform histograms (R, G, B).
 * @param {Uint8ClampedArray} rgba
 * @param {number} width
 * @param {number} height
 * @returns {{ r: Float32Array, g: Float32Array, b: Float32Array }}
 *   Each array is length width*256, normalised 0..1
 */
export function computeWaveformRGB(rgba, width, height) {
  const r = new Float32Array(width * 256);
  const g = new Float32Array(width * 256);
  const b = new Float32Array(width * 256);

  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = row + x * 4;
      r[x * 256 + rgba[i]]++;
      g[x * 256 + rgba[i + 1]]++;
      b[x * 256 + rgba[i + 2]]++;
    }
  }

  const inv = 1 / height;
  for (let i = 0; i < r.length; i++) {
    r[i] *= inv;
    g[i] *= inv;
    b[i] *= inv;
  }

  return { r, g, b };
}
