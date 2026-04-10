import { computeWaveform } from '../renderer/analysis/waveform.js';
import { computeWaveformRGB } from '../renderer/analysis/waveformRGB.js';
import { computeVectorscope } from '../renderer/analysis/vectorscope.js';

// Worker entry — receives raw RGBA frame buffers from CaptureEngine

self.onmessage = ({ data }) => {
  const { buffer, width, height } = data;
  const rgba = new Uint8ClampedArray(buffer);

  const lumaData = computeWaveform(rgba, width, height);
  const { r, g, b } = computeWaveformRGB(rgba, width, height);
  const vectorData = computeVectorscope(rgba, width, height);

  self.postMessage(
    { lumaData, rData: r, gData: g, bData: b, vectorData, width, height },
    [lumaData.buffer, r.buffer, g.buffer, b.buffer, vectorData.buffer]
  );
};
