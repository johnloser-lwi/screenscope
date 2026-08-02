/**
 * Compute three per-channel waveform histograms (R, G, B).
 * @param {Uint8ClampedArray} rgba
 * @param {number} width
 * @param {number} height
 * @returns {{ r: Float32Array, g: Float32Array, b: Float32Array }}
 *   Each array is length width*256 indexed [level*width+x] (texture order),
 *   normalised 0..1
 */
export function computeWaveformRGB(rgba, width, height) {
  const r = new Float32Array(width * 256);
  const g = new Float32Array(width * 256);
  const b = new Float32Array(width * 256);

  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = row + x * 4;
      // Channel values are already integers, so there is nothing to splat —
      // continuity comes from the vertical blur in TracePipeline.
      r[rgba[i]     * width + x]++;
      g[rgba[i + 1] * width + x]++;
      b[rgba[i + 2] * width + x]++;
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
