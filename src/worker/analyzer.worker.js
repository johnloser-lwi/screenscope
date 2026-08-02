import { computeWaveform } from '../renderer/analysis/waveform.js';
import { computeWaveformRGB } from '../renderer/analysis/waveformRGB.js';
import { computeVectorscope } from '../renderer/analysis/vectorscope.js';
import { computeHistogram } from '../renderer/analysis/histogram.js';

// Worker entry — receives raw RGBA frame buffers from CaptureEngine.
//
// Each analysis is a full pass over the frame (up to 1920×1080) on this one
// thread, so we only run the ones some visible scope actually asked for.
// The renderer keeps this in sync via 'set-enabled' whenever the layout changes.

let enabled = { luma: true, rgb: true, vector: true, histogram: false };

self.onmessage = ({ data }) => {
  if (data.type === 'set-enabled') {
    enabled = { ...enabled, ...data.enabled };
    return;
  }

  const { buffer, width, height } = data;
  const rgba = new Uint8ClampedArray(buffer);

  const payload = { width, height };
  const transfer = [];

  if (enabled.luma) {
    payload.lumaData = computeWaveform(rgba, width, height);
    transfer.push(payload.lumaData.buffer);
  }

  if (enabled.rgb) {
    const { r, g, b } = computeWaveformRGB(rgba, width, height);
    payload.rData = r;
    payload.gData = g;
    payload.bData = b;
    transfer.push(r.buffer, g.buffer, b.buffer);
  }

  if (enabled.vector) {
    payload.vectorData = computeVectorscope(rgba, width, height);
    transfer.push(payload.vectorData.buffer);
  }

  if (enabled.histogram) {
    payload.histogramData = computeHistogram(rgba, width, height);
    transfer.push(payload.histogramData.buffer);
  }

  self.postMessage(payload, transfer);
};
