import { TracePipeline, makeProgram } from './TracePipeline.js';

const VERT = `#version 300 es
precision highp float;
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// IRE grid. u_yMin/u_yMax describe the visible level window so the lines stay
// on real IRE values when the scope is zoomed into the shadows or highlights.
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
  // Line width in level units, so zoomed views don't get fat lines
  float lw = (1.5 / u_height) * span;

  float step = 0.1;
  // Tighten the grid when zoomed in far enough that 10% lines would be sparse
  if (span <= 0.25) step = 0.02;

  float alpha = abs(mod(level + lw, step) - step * 0.5) < lw ? 0.25 : 0.0;
  if (abs(mod(level + lw, 0.5) - 0.25) < lw * 1.5) alpha = 0.45;
  fragColor = vec4(0.5, 0.5, 0.5, alpha);
}`;

export class WaveformScope {
  /**
   * @param {import('./GLCell.js').GLCell|HTMLCanvasElement} cell
   * @param {{ range?: [number, number], color?: number[] }} options
   */
  constructor(cell, options = {}) {
    this.cell = cell;
    this.canvas = cell.canvas || cell;
    this.gl = cell.gl || this.canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!this.gl) throw new Error('WebGL2 not available');
    this.range = options.range || [0, 1];
    this.color = options.color || [1, 1, 1];
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

    // Raw histogram texture. NEAREST is fine — the pipeline reads it with
    // texelFetch and does its own filtering.
    this._tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this._gain = 10.0;
  }

  setSmoothing(level) { this._pipeline.setSmoothing(level); }
  setGain(gain) { this._gain = gain; }
  setRange(range) {
    this.range = range;
    this._pipeline.reset();
  }

  render(lumaData, width) {
    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    // computeWaveform already emits [Y*width+x], i.e. texture row order.
    gl.bindTexture(gl.TEXTURE_2D, this._tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, 256, 0, gl.RED, gl.FLOAT, lumaData);

    const traceTex = this._pipeline.process('luma', this._tex, width, cw, ch, this.range);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0.05, 0.05, 0.05, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this._gridProg);
    gl.uniform1f(gl.getUniformLocation(this._gridProg, 'u_height'), ch);
    gl.uniform1f(gl.getUniformLocation(this._gridProg, 'u_yMin'), this.range[0]);
    gl.uniform1f(gl.getUniformLocation(this._gridProg, 'u_yMax'), this.range[1]);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);

    gl.blendFunc(gl.ONE, gl.ONE); // additive
    this._pipeline.drawTonemapped(traceTex, this.color, this._gain);
    gl.disable(gl.BLEND);
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
    gl.deleteTexture(this._tex);
    gl.deleteVertexArray(this._vao);
  }
}
