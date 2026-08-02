/**
 * Shared trace-smoothing pipeline.
 *
 * Everything between "a raw density histogram" and "pixels on screen" lives
 * here, so the luma waveform, RGB waveform and histogram all get the same
 * look from one implementation.
 *
 * Per trace, per frame:
 *   1. resample  — box-filter the width×256 histogram down to cell resolution.
 *                  Sampling it directly minifies with no filtering, which is
 *                  what makes the current traces sparkle and alias.
 *   2. blur      — separable Gaussian; the vertical pass is what turns the
 *                  RGB waveform's integer bins into a continuous trace.
 *   3. temporal  — mix into a persistent accumulator to kill frame-to-frame
 *                  shimmer (this is what costs latency at higher settings).
 *   4. tonemap   — soft shoulder instead of a hard clip, so bright regions
 *                  keep internal structure and the trace has a glow ramp.
 */

const VERT = `#version 300 es
precision highp float;
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// Box-filter the source columns that fall under this output pixel, and
// linearly interpolate between the two nearest level rows. texelFetch is used
// so this works regardless of whether float textures are filterable here.
const RESAMPLE_FRAG = `#version 300 es
precision highp float;
uniform highp sampler2D u_src;
uniform int   u_srcW;
uniform int   u_taps;
uniform float u_yMin;
uniform float u_yMax;
in vec2 v_uv;
out vec4 fragColor;

void main() {
  float level = mix(u_yMin, u_yMax, v_uv.y) * 255.0;
  int y0 = clamp(int(floor(level)), 0, 255);
  int y1 = min(y0 + 1, 255);
  float fy = clamp(level - float(y0), 0.0, 1.0);

  int x0 = int(floor(v_uv.x * float(u_srcW))) - u_taps / 2;

  float sum = 0.0;
  for (int i = 0; i < u_taps; i++) {
    int x = clamp(x0 + i, 0, u_srcW - 1);
    float a = texelFetch(u_src, ivec2(x, y0), 0).r;
    float b = texelFetch(u_src, ivec2(x, y1), 0).r;
    sum += mix(a, b, fy);
  }

  fragColor = vec4(sum / float(u_taps), 0.0, 0.0, 1.0);
}`;

// 5-tap linear-sampled approximation of a 9-tap Gaussian
const BLUR_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec2 u_dir;
in vec2 v_uv;
out vec4 fragColor;

void main() {
  float c = texture(u_src, v_uv).r * 0.2270270270;
  c += (texture(u_src, v_uv + u_dir * 1.3846153846).r +
        texture(u_src, v_uv - u_dir * 1.3846153846).r) * 0.3162162162;
  c += (texture(u_src, v_uv + u_dir * 3.2307692308).r +
        texture(u_src, v_uv - u_dir * 3.2307692308).r) * 0.0702702703;
  fragColor = vec4(c, 0.0, 0.0, 1.0);
}`;

const BLEND_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_prev;
uniform sampler2D u_cur;
uniform float u_alpha;
in vec2 v_uv;
out vec4 fragColor;

void main() {
  float p = texture(u_prev, v_uv).r;
  float c = texture(u_cur,  v_uv).r;
  fragColor = vec4(mix(p, c, u_alpha), 0.0, 0.0, 1.0);
}`;

const TONEMAP_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec3  u_color;
uniform float u_gain;
uniform float u_toneGamma;
in vec2 v_uv;
out vec4 fragColor;

void main() {
  float d = texture(u_src, v_uv).r;
  // Soft shoulder: approaches 1.0 asymptotically instead of clipping, so
  // dense areas still show structure rather than flattening to solid colour.
  float t = 1.0 - exp(-d * u_gain);
  float v = pow(max(t, 0.0), 1.0 / u_toneGamma);
  fragColor = vec4(u_color * v, 1.0);
}`;

export const SMOOTHING_LEVELS = {
  off:    { alpha: 1.00, radius: 0.0 },
  low:    { alpha: 0.60, radius: 1.0 },
  medium: { alpha: 0.35, radius: 1.5 },
  high:   { alpha: 0.18, radius: 2.5 },
};

export class TracePipeline {
  constructor(gl) {
    this.gl = gl;

    // Half-float render targets need this in WebGL2; without it we fall back
    // to RGBA8, which bands badly in the shadows once gain is applied.
    this._float =
      !!gl.getExtension('EXT_color_buffer_float') ||
      !!gl.getExtension('EXT_color_buffer_half_float');

    this._progResample = makeProgram(gl, VERT, RESAMPLE_FRAG);
    this._progBlur     = makeProgram(gl, VERT, BLUR_FRAG);
    this._progBlend    = makeProgram(gl, VERT, BLEND_FRAG);
    this._progTonemap  = makeProgram(gl, VERT, TONEMAP_FRAG);

    const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    this._vao = gl.createVertexArray();
    gl.bindVertexArray(this._vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    for (const prog of [this._progResample, this._progBlur, this._progBlend, this._progTonemap]) {
      gl.useProgram(prog);
      const loc = gl.getAttribLocation(prog, 'a_pos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    }
    gl.bindVertexArray(null);

    this._fbo = gl.createFramebuffer();
    this._scratch = [null, null];   // shared work buffers, reused per trace
    this._accums = new Map();       // id -> ping-pong accumulator
    this._w = 0;
    this._h = 0;

    this.setSmoothing('medium');
  }

  setSmoothing(level) {
    const cfg = SMOOTHING_LEVELS[level] || SMOOTHING_LEVELS.medium;
    this.level = level;
    this._alpha = cfg.alpha;
    this._radius = cfg.radius;
  }

  /** Drop accumulated history — call on resize or when the source changes. */
  reset() {
    for (const acc of this._accums.values()) acc.primed = false;
  }

  /**
   * Run a raw histogram texture through the pipeline.
   *
   * @param {string} id        stable key for this trace's temporal accumulator
   * @param {WebGLTexture} srcTex  width×256 R32F histogram
   * @param {number} srcW      histogram width in texels
   * @param {number} dstW      target width in device pixels
   * @param {number} dstH      target height in device pixels
   * @param {[number,number]} range  level window to display, e.g. [0, 0.2]
   * @returns {WebGLTexture} smoothed density at dstW×dstH
   */
  process(id, srcTex, srcW, dstW, dstH, range = [0, 1]) {
    const gl = this.gl;
    const w = Math.max(1, dstW);
    const h = Math.max(1, dstH);

    this._ensureSize(w, h);
    const acc = this._ensureAccum(id, w, h);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindVertexArray(this._vao);

    // 1. resample
    const taps = Math.max(1, Math.min(16, Math.round(srcW / w)));
    this._attach(this._scratch[0]);
    gl.useProgram(this._progResample);
    this._bindTex(this._progResample, 'u_src', srcTex, 0);
    gl.uniform1i(gl.getUniformLocation(this._progResample, 'u_srcW'), srcW);
    gl.uniform1i(gl.getUniformLocation(this._progResample, 'u_taps'), taps);
    gl.uniform1f(gl.getUniformLocation(this._progResample, 'u_yMin'), range[0]);
    gl.uniform1f(gl.getUniformLocation(this._progResample, 'u_yMax'), range[1]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 2. separable blur (scratch0 -> scratch1 -> scratch0)
    let cur = this._scratch[0];
    if (this._radius > 0) {
      const r = this._radius / 3.0;
      gl.useProgram(this._progBlur);
      const dirLoc = gl.getUniformLocation(this._progBlur, 'u_dir');

      this._attach(this._scratch[1]);
      this._bindTex(this._progBlur, 'u_src', this._scratch[0], 0);
      gl.uniform2f(dirLoc, r / w, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      this._attach(this._scratch[0]);
      this._bindTex(this._progBlur, 'u_src', this._scratch[1], 0);
      gl.uniform2f(dirLoc, 0, r / h);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      cur = this._scratch[0];
    }

    // 3. temporal blend into the accumulator (ping-pong: read a, write b)
    const alpha = acc.primed ? this._alpha : 1.0;
    const dst = acc.tex[1 - acc.cur];
    this._attach(dst);
    gl.useProgram(this._progBlend);
    this._bindTex(this._progBlend, 'u_prev', acc.tex[acc.cur], 0);
    this._bindTex(this._progBlend, 'u_cur', cur, 1);
    gl.uniform1f(gl.getUniformLocation(this._progBlend, 'u_alpha'), alpha);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    acc.cur = 1 - acc.cur;
    acc.primed = true;

    gl.bindVertexArray(null);
    // Callers draw to the canvas next and rebind this themselves, but leaving
    // an FBO bound here would be a trap for anything added later.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return acc.tex[acc.cur];
  }

  /**
   * Tonemap and colorize a processed density texture into whatever framebuffer,
   * viewport and blend state the caller has set up.
   */
  drawTonemapped(tex, color, gain, toneGamma = 1.6) {
    const gl = this.gl;
    gl.useProgram(this._progTonemap);
    gl.bindVertexArray(this._vao);
    this._bindTex(this._progTonemap, 'u_src', tex, 0);
    gl.uniform3fv(gl.getUniformLocation(this._progTonemap, 'u_color'), color);
    gl.uniform1f(gl.getUniformLocation(this._progTonemap, 'u_gain'), gain);
    gl.uniform1f(gl.getUniformLocation(this._progTonemap, 'u_toneGamma'), toneGamma);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  destroy() {
    const gl = this.gl;
    for (const t of this._scratch) if (t) gl.deleteTexture(t);
    for (const acc of this._accums.values()) acc.tex.forEach(t => gl.deleteTexture(t));
    this._accums.clear();
    this._scratch = [null, null];
    if (this._fbo) gl.deleteFramebuffer(this._fbo);
    for (const p of [this._progResample, this._progBlur, this._progBlend, this._progTonemap]) {
      gl.deleteProgram(p);
    }
  }

  // ── internals ───────────────────────────────────────────
  _makeTarget(w, h) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (this._float) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, w, h, 0, gl.RED, gl.HALF_FLOAT, null);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  _ensureSize(w, h) {
    if (this._w === w && this._h === h) return;
    const gl = this.gl;
    for (const t of this._scratch) if (t) gl.deleteTexture(t);
    this._scratch = [this._makeTarget(w, h), this._makeTarget(w, h)];
    // Accumulators are sized to the target too, so they all go stale at once
    for (const acc of this._accums.values()) acc.tex.forEach(t => gl.deleteTexture(t));
    this._accums.clear();
    this._w = w;
    this._h = h;
  }

  _ensureAccum(id, w, h) {
    let acc = this._accums.get(id);
    if (!acc) {
      acc = { tex: [this._makeTarget(w, h), this._makeTarget(w, h)], cur: 0, primed: false };
      this._accums.set(id, acc);
    }
    return acc;
  }

  _attach(tex) {
    const gl = this.gl;
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  }

  _bindTex(prog, name, tex, unit) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(prog, name), unit);
  }
}

export function makeProgram(gl, vs, fs) {
  const vert = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vert, vs);
  gl.compileShader(vert);
  if (!gl.getShaderParameter(vert, gl.COMPILE_STATUS)) {
    console.error('vertex shader:', gl.getShaderInfoLog(vert));
  }

  const frag = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(frag, fs);
  gl.compileShader(frag);
  if (!gl.getShaderParameter(frag, gl.COMPILE_STATUS)) {
    console.error('fragment shader:', gl.getShaderInfoLog(frag));
  }

  const prog = gl.createProgram();
  gl.attachShader(prog, vert);
  gl.attachShader(prog, frag);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('link:', gl.getProgramInfoLog(prog));
  }
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  return prog;
}
