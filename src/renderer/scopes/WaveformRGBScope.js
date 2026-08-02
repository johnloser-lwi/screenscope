import { TracePipeline, makeProgram } from './TracePipeline.js';

const VERT = `#version 300 es
precision highp float;
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const GRID_FRAG = `#version 300 es
precision highp float;
uniform float u_height;
uniform float u_yMin;
uniform float u_yMax;
in vec2 v_uv;
out vec4 fragColor;

void main() {
  float level = mix(u_yMin, u_yMax, v_uv.y);
  float span = max(u_yMax - u_yMin, 0.0001);
  float lw = (1.5 / u_height) * span;
  float step = span <= 0.25 ? 0.02 : 0.1;
  float alpha = abs(mod(level + lw, step) - step * 0.5) < lw ? 0.22 : 0.0;
  if (abs(mod(level + lw, 0.5) - 0.25) < lw * 1.5) alpha = 0.4;
  fragColor = vec4(0.5, 0.5, 0.5, alpha);
}`;

const PARADE_COLORS = [
  [1.0, 0.15, 0.15],
  [0.15, 1.0, 0.15],
  [0.15, 0.4, 1.0],
];

const OVERLAY_COLORS = [
  [1.0, 0.05, 0.05],
  [0.05, 1.0, 0.05],
  [0.1, 0.3, 1.0],
];

export class WaveformRGBScope {
  /**
   * @param {import('./GLCell.js').GLCell|HTMLCanvasElement} cell
   * @param {{ mode?: 'parade'|'overlay', range?: [number, number] }} options
   */
  constructor(cell, options = {}) {
    this.cell = cell;
    this.canvas = cell.canvas || cell;
    this.gl = cell.gl || this.canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!this.gl) throw new Error('WebGL2 not available');
    this._mode = options.mode || 'parade';
    this.range = options.range || [0, 1];
    this._init();
  }

  _init() {
    const gl = this.gl;
    this._pipeline = new TracePipeline(gl);
    this._gridProg = makeProgram(gl, VERT, GRID_FRAG);

    const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    this._vao = gl.createVertexArray();
    gl.bindVertexArray(this._vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.useProgram(this._gridProg);
    const loc = gl.getAttribLocation(this._gridProg, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this._tex = [this._makeTex(), this._makeTex(), this._makeTex()];
    this._gain = 10.0;
  }

  setMode(mode) {
    if (mode === this._mode) return;
    this._mode = mode;
    // Panel geometry changes, so the accumulators no longer line up
    this._pipeline.reset();
  }

  setSmoothing(level) { this._pipeline.setSmoothing(level); }
  setGain(gain) { this._gain = gain; }
  setRange(range) {
    this.range = range;
    this._pipeline.reset();
  }

  _makeTex() {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  _upload(i, data, width) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this._tex[i]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, 256, 0, gl.RED, gl.FLOAT, data);
  }

  render(rData, gData, bData, width) {
    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    // computeWaveformRGB already emits [level*width+x], i.e. texture row order.
    this._upload(0, rData, width);
    this._upload(1, gData, width);
    this._upload(2, bData, width);

    if (this._mode === 'parade') {
      this._renderParade(cw, ch, width);
    } else {
      this._renderOverlay(cw, ch, width);
    }
  }

  _renderParade(cw, ch, srcW) {
    const gl = this.gl;
    const panelW = Math.floor(cw / 3);
    const ids = ['r', 'g', 'b'];

    // Process all three before touching the default framebuffer — the pipeline
    // binds its own FBO, so interleaving would mean redundant rebinds.
    const traces = ids.map((id, i) =>
      this._pipeline.process(id, this._tex[i], srcW, panelW, ch, this.range)
    );

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0.05, 0.05, 0.05, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.enable(gl.BLEND);
    gl.enable(gl.SCISSOR_TEST);

    traces.forEach((tex, i) => {
      const x = i * panelW + (i > 0 ? 1 : 0); // 1px separator gap after first panel
      const w = i === 2 ? (cw - x) : (panelW - (i < 2 ? 1 : 0));

      gl.viewport(x, 0, w, ch);
      gl.scissor(x, 0, w, ch);

      this._drawGrid(ch);

      gl.blendFunc(gl.ONE, gl.ONE);
      this._pipeline.drawTonemapped(tex, PARADE_COLORS[i], this._gain);
    });

    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, cw, ch);
  }

  _renderOverlay(cw, ch, srcW) {
    const gl = this.gl;
    const ids = ['r', 'g', 'b'];
    const traces = ids.map((id, i) =>
      this._pipeline.process(id, this._tex[i], srcW, cw, ch, this.range)
    );

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0.05, 0.05, 0.05, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.enable(gl.BLEND);
    this._drawGrid(ch);

    // Additive, so overlapping channels read as their sum (white where all
    // three agree) rather than whichever drew last.
    gl.blendFunc(gl.ONE, gl.ONE);
    traces.forEach((tex, i) => {
      this._pipeline.drawTonemapped(tex, OVERLAY_COLORS[i], this._gain);
    });
    gl.disable(gl.BLEND);
  }

  _drawGrid(ch) {
    const gl = this.gl;
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this._gridProg);
    gl.uniform1f(gl.getUniformLocation(this._gridProg, 'u_height'), ch);
    gl.uniform1f(gl.getUniformLocation(this._gridProg, 'u_yMin'), this.range[0]);
    gl.uniform1f(gl.getUniformLocation(this._gridProg, 'u_yMax'), this.range[1]);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  resize(w, h) {
    this.canvas.width = w;
    this.canvas.height = h;
    this._pipeline.reset();
  }

  destroy() {
    const gl = this.gl;
    this._pipeline.destroy();
    gl.deleteProgram(this._gridProg);
    this._tex.forEach(t => gl.deleteTexture(t));
    gl.deleteVertexArray(this._vao);
  }
}
