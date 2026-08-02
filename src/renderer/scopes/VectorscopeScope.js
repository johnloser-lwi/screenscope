const VERT = `#version 300 es
precision highp float;
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
uniform highp usampler2D u_histogram;
uniform float u_maxVal;
uniform float u_gain;
uniform float u_toneGamma;
uniform float u_zoom;
in vec2 v_uv;
out vec4 fragColor;

void main() {
  // Magnify about the neutral centre so near-neutral tones can be judged
  vec2 uv = (v_uv - 0.5) / u_zoom + 0.5;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  uint count = texture(u_histogram, uv).r;
  float norm = log2(float(count) + 1.0) / log2(u_maxVal + 1.0);
  // Same soft shoulder the waveforms use — no hard clip, so dense clusters
  // keep their internal structure instead of flattening to solid colour.
  float t = 1.0 - exp(-norm * u_gain);
  float density = pow(max(t, 0.0), 1.0 / u_toneGamma);

  // Derive hue from Cb/Cr position — BT.709 inverse at Y=1, 2x chroma boost
  float cb = uv.x - 0.5;
  float cr = uv.y - 0.5;
  vec3 hue;
  hue.r = clamp(1.0 + 1.5748 * cr * 2.0, 0.0, 1.0);
  hue.g = clamp(1.0 - (0.1873 * cb + 0.4681 * cr) * 2.0, 0.0, 1.0);
  hue.b = clamp(1.0 + 1.8556 * cb * 2.0, 0.0, 1.0);

  fragColor = vec4(hue * density, 1.0);
}`;

// 75% color bar Cb/Cr targets — BT.709 full-range (matches DaVinci Resolve for sRGB/Rec.709)
const TARGETS = [
  { label: 'R',  cb: 106, cr: 224, color: '#ff4444' },
  { label: 'Yl', cb:  32, cr: 137, color: '#ffff44' },
  { label: 'G',  cb:  54, cr:  41, color: '#44ff44' },
  { label: 'Cy', cb: 150, cr:  32, color: '#44ffff' },
  { label: 'B',  cb: 224, cr: 119, color: '#4444ff' },
  { label: 'Mg', cb: 202, cr: 215, color: '#ff44ff' },
];

export class VectorscopeScope {
  /**
   * @param {import('./GLCell.js').GLCell|HTMLCanvasElement} cell
   * @param {{ zoom?: number }} options
   */
  constructor(cell, options = {}) {
    this.cell = cell;
    this.canvas = cell.canvas || cell;
    this.overlay = cell.overlay || options.overlay; // element for the graticule
    this.gl = cell.gl || this.canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!this.gl) throw new Error('WebGL2 not available');
    this._zoom = options.zoom || 1;
    this._init();
    this._buildGraticule();
  }

  setZoom(zoom) {
    this._zoom = zoom;
    this._buildGraticule();
  }

  _init() {
    const gl = this.gl;
    this._prog = this._makeProgram(VERT, FRAG);

    const quad = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);
    this._vao = gl.createVertexArray();
    gl.bindVertexArray(this._vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.useProgram(this._prog);
    const loc = gl.getAttribLocation(this._prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this._tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this._gain = 2.0;
    this._maxVal = 1;
  }

  _buildGraticule() {
    if (!this.overlay) return;
    // Build an SVG graticule as a string and inject it
    const cx = 128, cy = 128, r75 = 96; // 75% circle radius in 256 space

    // The viewBox is the same centred window the shader magnifies, so data and
    // graticule stay locked together at any zoom. Strokes and text are divided
    // by the zoom to keep their on-screen size constant.
    const z = this._zoom;
    const span = 256 / z;
    const origin = 128 - span / 2;
    const sw = (v) => (v / z).toFixed(3);

    let svg = `<svg xmlns="http://www.w3.org/2000/svg"
      viewBox="${origin.toFixed(3)} ${origin.toFixed(3)} ${span.toFixed(3)} ${span.toFixed(3)}"
      style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;">`;

    // 75% color bar circle
    svg += `<circle cx="${cx}" cy="${cy}" r="${r75}"
      fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="${sw(0.5)}"/>`;

    // 100% circle
    svg += `<circle cx="${cx}" cy="${cy}" r="120"
      fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="${sw(0.5)}"/>`;

    // Crosshairs
    svg += `<line x1="128" y1="8" x2="128" y2="248" stroke="rgba(255,255,255,0.15)" stroke-width="${sw(0.5)}"/>`;
    svg += `<line x1="8"   y1="128" x2="248" y2="128" stroke="rgba(255,255,255,0.15)" stroke-width="${sw(0.5)}"/>`;

    // Skin tone I-line — NTSC I-axis at 132.5° (atan2(dCr, dCb) of the I-axis direction)
    const skinAngle = (132.5 * Math.PI) / 180;
    const sx = cx + Math.cos(skinAngle) * 120;
    const sy = cy - Math.sin(skinAngle) * 120;
    svg += `<line x1="${cx}" y1="${cy}" x2="${sx.toFixed(1)}" y2="${sy.toFixed(1)}"
      stroke="rgba(255,200,100,0.4)" stroke-width="${sw(0.75)}" stroke-dasharray="${sw(3)},${sw(3)}"/>`;

    // Color target boxes
    const box = 8 / z;
    for (const t of TARGETS) {
      // Map Cb (0-255) → x, Cr (0-255) → y (Cr increases downward in standard display)
      const tx = (t.cb / 255) * 256;
      const ty = (1 - t.cr / 255) * 256;
      svg += `<rect x="${(tx - box / 2).toFixed(2)}" y="${(ty - box / 2).toFixed(2)}"
        width="${box.toFixed(2)}" height="${box.toFixed(2)}" rx="${sw(1)}"
        fill="none" stroke="${t.color}" stroke-width="${sw(1.0)}"/>`;
      svg += `<text x="${(tx + box * 0.625).toFixed(2)}" y="${(ty + box * 0.5).toFixed(2)}"
        font-size="${sw(7)}" fill="${t.color}" font-family="monospace">${t.label}</text>`;
    }

    svg += `</svg>`;
    this.overlay.innerHTML = svg;
  }

  render(vectorData) {
    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    // Clear the full canvas first
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0.04, 0.04, 0.04, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Render into a centered square — matches SVG overlay's default
    // preserveAspectRatio="xMidYMid meet" so graticule and data align
    // at any window size.
    const size = Math.min(cw, ch);
    const xOff = Math.floor((cw - size) / 2);
    const yOff = Math.floor((ch - size) / 2);
    gl.viewport(xOff, yOff, size, size);

    // Find max value for normalisation. Normalising to the instantaneous max
    // makes the whole scope pump in brightness frame to frame, so ease toward
    // it instead of snapping.
    let frameMax = 1;
    for (let i = 0; i < vectorData.length; i++) {
      if (vectorData[i] > frameMax) frameMax = vectorData[i];
    }
    this._maxVal += (frameMax - this._maxVal) * 0.15;
    const maxVal = this._maxVal;

    gl.bindTexture(gl.TEXTURE_2D, this._tex);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.R32UI,
      256, 256, 0,
      gl.RED_INTEGER, gl.UNSIGNED_INT,
      vectorData
    );

    gl.useProgram(this._prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._tex);
    gl.uniform1i(gl.getUniformLocation(this._prog, 'u_histogram'), 0);
    gl.uniform1f(gl.getUniformLocation(this._prog, 'u_maxVal'), maxVal);
    gl.uniform1f(gl.getUniformLocation(this._prog, 'u_gain'), this._gain);
    gl.uniform1f(gl.getUniformLocation(this._prog, 'u_toneGamma'), 1.6);
    gl.uniform1f(gl.getUniformLocation(this._prog, 'u_zoom'), this._zoom);

    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  resize(w, h) {
    this.canvas.width = w;
    this.canvas.height = h;
  }

  destroy() {
    const gl = this.gl;
    gl.deleteProgram(this._prog);
    gl.deleteTexture(this._tex);
    gl.deleteVertexArray(this._vao);
    if (this.overlay) this.overlay.innerHTML = '';
  }

  _makeProgram(vs, fs) {
    const gl = this.gl;
    const vert = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vert, vs);
    gl.compileShader(vert);
    const frag = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(frag, fs);
    gl.compileShader(frag);
    const prog = gl.createProgram();
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);
    return prog;
  }
}
