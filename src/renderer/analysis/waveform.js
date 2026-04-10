/**
 * Compute a luma waveform histogram.
 * @param {Uint8ClampedArray} rgba - flat RGBA pixel data
 * @param {number} width
 * @param {number} height
 * @returns {Float32Array} length width*256 — histogram[x*256+Y] = density 0..1
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
      // BT.709 luma
      const Y = (0.2126 * R + 0.7152 * G + 0.0722 * B + 0.5) | 0;
      histogram[x * 256 + Y]++;
    }
  }

  // Normalise by column height so max possible value = 1.0
  const inv = 1 / height;
  for (let i = 0; i < histogram.length; i++) {
    histogram[i] *= inv;
  }

  return histogram;
}
