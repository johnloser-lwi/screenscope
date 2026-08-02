import { makeProgram } from './TracePipeline.js';
import { SMOOTHING_LEVELS } from './TracePipeline.js';

const VERT = `#version 300 es
precision highp float;
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// Filled area under one channel's curve. Bins are read with texelFetch and
// interpolated by hand, plus a small blur across bins, so the curve reads as
// a continuous shape rather than 256 hard steps.
const FRAG = `#version 300 es
precision highp float;
uniform highp sampler2D u_hist;
uniform int   u_row;
uniform float u_max;
uniform float u_blur;      // in bins
uniform float u_height;    // device pixels, for edge antialiasing
uniform vec3  u_color;
uniform float u_toneGamma;
in vec2 v_uv;
out vec4 fragColor;

float fetchBin(float xf) {
  int x0 = clamp(int(floor(xf)), 0, 255);
  int x1 = clamp(x0 + 1, 0, 255);
  float f = clamp(xf - float(x0), 0.0, 1.0);
  return mix(texelFetch(u_hist, ivec2(x0, u_row), 0).r,
             texelFetch(u_hist, ivec2(x1, u_row), 0).r, f);
}

void main() {
  float xf = v_uv.x * 255.0;

  // 5-tap Gaussian across bins
  float v = fetchBin(xf) * 0.383;
  v += (fetchBin(xf + u_blur) + fetchBin(xf - u_blur)) * 0.242;
  v += (fetchBin(xf + u_blur * 2.0) + fetchBin(xf - u_blur * 2.0)) * 0.0665;

  // Histograms are extremely peaked; a gamma keeps the low counts readable
  // without an autoscale that would make the whole shape jump every frame.
  float h = pow(clamp(v / u_max, 0.0, 1.0), 1.0 / u_toneGamma);

  float e = 1.5 / u_height;
  float fill = smoothstep(h + e, h - e, v_uv.y);
  // Brighter top edge, so overlapping channels stay distinguishable
  float edge = exp(-pow((v_uv.y - h) / (e * 2.0), 2.0));

  fragColor = vec4(u_color * (fill * 0.55 + edge * 0.9), 1.0);
}`;

const GRID_FRAG = `#version 300 es
precision highp float;
uniform float u_width;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  float lw = 1.5 / u_width;
  // Vertical lines every 10% of the level range, brighter at 0/50/100%
  float alpha = abs(mod(v_uv.x + lw, 0.1) - 0.05) < lw ? 0.18 : 0.0;
  if (abs(mod(v_uv.x + lw, 0.5) - 0.25) < lw * 1.5) alpha = 0.35;
  fragColor = vec4(0.5, 0.5, 0.5, alpha);
}`;

// Plane offsets in the packed [R | G | B | Y] histogram
const ROW = { r: 0, g: 1, b: 2, y: 3 };

const RGB_COLORS = [
  [1.0, 0.12, 0.12],
  [0.12, 1.0, 0.12],
  [0.2, 0.45, 1.0],
];

export class HistogramScope {
  /**
   * @param {import('./GLCell.js').GLCell|HTMLCanvasElement} cell
   * @param {{ mode?: 'rgb'|'parade'|'luma' }} options
   */
  constructor(cell, options = {}) {
    this.cell = cell;
    this.canvas = cell.canvas || cell;
    this.gl = cell.gl || this.canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!this.gl) throw new Error('WebGL2 not available');
    this._mode = options.mode || 'rgb';
    this._init();
    this.setSmoothing('medium');
  }

  _init() {
    const gl = this.gl;
    this._prog = makeProgram(gl, VERT, FRAG);
    this._gridProg = makeProgram(gl, VERT, GRID_FRAG);

    const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    this._vao = gl.createVertexArray();
    gl.bindVertexArray(this._vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    for (const prog of [this._prog, this._gridProg]) {
      gl.useProgram(prog);
      const loc = gl.getAttribLocation(prog, 'a_pos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    }
    gl.bindVertexArray(null);

    this._tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Temporal smoothing here is only 1024 floats, so it runs on the CPU
    // rather than needing the FBO ping-pong the waveforms use.
    this._smoothed = new Float32Array(256 * 4);
    this._primed = false;
    this._max = 0.01;
    this._toneGamma = 1.8;
  }

  setMode(mode) { this._mode = mode; }

  setSmoothing(level) {
    const cfg = SMOOTHING_LEVELS[level] || SMOOTHING_LEVELS.medium;
    this._alpha = cfg.alpha;
    this._blur = 0.5 + cfg.radius;
  }

  render(histData) {
    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    const a = this._primed ? this._alpha : 1.0;
    const s = this._smoothed;
    for (let i = 0; i < s.length; i++) s[i] += (histData[i] - s[i]) * a;
    this._primed = true;

    // Autoscale to the tallest bin across whichever planes are shown, eased so
    // the curve doesn't jump in height every frame.
    const from = this._mode === 'luma' ? 768 : 0;
    const to = this._mode === 'luma' ? 1024 : 768;
    let frameMax = 1e-6;
    for (let i = from; i < to; i++) if (s[i] > frameMax) frameMax = s[i];
    this._max += (frameMax - this._max) * 0.15;

    gl.bindTexture(gl.TEXTURE_2D, this._tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 256, 4, 0, gl.RED, gl.FLOAT, s);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0.05, 0.05, 0.05, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.bindVertexArray(this._vao);

    if (this._mode === 'parade') {
      this._renderParade(cw, ch);
    } else if (this._mode === 'luma') {
      this._drawGrid(cw);
      gl.blendFunc(gl.ONE, gl.ONE);
      this._drawChannel(ROW.y, [0.9, 0.9, 0.9], ch);
    } else {
      this._drawGrid(cw);
      // Additive so overlapping channels sum to white where they agree
      gl.blendFunc(gl.ONE, gl.ONE);
      this._drawChannel(ROW.r, RGB_COLORS[0], ch);
      this._drawChannel(ROW.g, RGB_COLORS[1], ch);
      this._drawChannel(ROW.b, RGB_COLORS[2], ch);
    }

    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  _renderParade(cw, ch) {
    const gl = this.gl;
    const panelH = Math.floor(ch / 3);
    const rows = [ROW.r, ROW.g, ROW.b];

    gl.enable(gl.SCISSOR_TEST);
    rows.forEach((row, i) => {
      // R on top, B on the bottom; GL's origin is bottom-left, so the last
      // panel absorbs the remainder. 1px gaps separate the first two.
      const last = i === 2;
      const y = last ? 0 : ch - (i + 1) * panelH;
      const h = last ? ch - 2 * panelH : panelH - 1;
      gl.viewport(0, y, cw, h);
      gl.scissor(0, y, cw, h);
      this._drawGrid(cw);
      gl.blendFunc(gl.ONE, gl.ONE);
      this._drawChannel(row, RGB_COLORS[i], h);
    });
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, cw, ch);
  }

  _drawGrid(cw) {
    const gl = this.gl;
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this._gridProg);
    gl.uniform1f(gl.getUniformLocation(this._gridProg, 'u_width'), cw);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  _drawChannel(row, color, ch) {
    const gl = this.gl;
    gl.useProgram(this._prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._tex);
    gl.uniform1i(gl.getUniformLocation(this._prog, 'u_hist'), 0);
    gl.uniform1i(gl.getUniformLocation(this._prog, 'u_row'), row);
    gl.uniform1f(gl.getUniformLocation(this._prog, 'u_max'), this._max);
    gl.uniform1f(gl.getUniformLocation(this._prog, 'u_blur'), this._blur);
    gl.uniform1f(gl.getUniformLocation(this._prog, 'u_height'), ch);
    gl.uniform1f(gl.getUniformLocation(this._prog, 'u_toneGamma'), this._toneGamma);
    gl.uniform3fv(gl.getUniformLocation(this._prog, 'u_color'), color);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  resize(w, h) {
    this.canvas.width = w;
    this.canvas.height = h;
  }

  destroy() {
    const gl = this.gl;
    gl.deleteProgram(this._prog);
    gl.deleteProgram(this._gridProg);
    gl.deleteTexture(this._tex);
    gl.deleteVertexArray(this._vao);
  }
}
