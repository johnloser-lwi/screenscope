/**
 * Compute a luma waveform histogram.
 * @param {Uint8ClampedArray} rgba - flat RGBA pixel data
 * @param {number} width
 * @param {number} height
 * @returns {Float32Array} length width*256 — histogram[Y*width+x] = density 0..1
 *   (texture order: row-major with Y as the row, ready for direct upload)
 */
export function computeWaveform(rgba, width, height) {
  const histogram = new Float32Array(width * 256);

  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = row + x * 4;
      const R = rgba[i];
      const G = rgba[i + 1];
      const B = rgba[i + 2];
      // BT.709 luma, kept fractional so the sample can be split between the
      // two neighbouring bins instead of snapping to one. Without this, a
      // short capture region leaves visible gaps between bins.
      const Yf = 0.2126 * R + 0.7152 * G + 0.0722 * B;
      const Y0 = Yf | 0;
      const frac = Yf - Y0;
      const Y1 = Y0 < 255 ? Y0 + 1 : 255;
      histogram[Y0 * width + x] += 1 - frac;
      histogram[Y1 * width + x] += frac;
    }
  }

  // Normalise by column height so max possible value = 1.0
  const inv = 1 / height;
  for (let i = 0; i < histogram.length; i++) {
    histogram[i] *= inv;
  }

  return histogram;
}
