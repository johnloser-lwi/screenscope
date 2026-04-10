/**
 * Compute a Cb/Cr vectorscope histogram using BT.601.
 * @param {Uint8ClampedArray} rgba
 * @param {number} width
 * @param {number} height
 * @returns {Uint32Array} length 256*256 — histogram[Cr*256+Cb] = count
 */
export function computeVectorscope(rgba, width, height) {
  const histogram = new Uint32Array(256 * 256);
  const total = width * height;

  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    const R = rgba[idx] / 255;
    const G = rgba[idx + 1] / 255;
    const B = rgba[idx + 2] / 255;

    // BT.709 Cb/Cr — matches sRGB/Rec.709 screen content (DaVinci Resolve default)
    const Cb = (-0.11457 * R - 0.38543 * G + 0.5    * B) * 255 + 128;
    const Cr = ( 0.5    * R - 0.45415 * G - 0.04585 * B) * 255 + 128;

    const cbI = Math.max(0, Math.min(255, (Cb + 0.5) | 0));
    const crI = Math.max(0, Math.min(255, (Cr + 0.5) | 0));

    histogram[crI * 256 + cbI]++;
  }

  return histogram;
}
