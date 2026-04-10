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
in vec2 v_uv;
out vec4 fragColor;

void main() {
  uint count = texture(u_histogram, v_uv).r;
  float density = min(log2(float(count) + 1.0) / log2(u_maxVal + 1.0) * u_gain, 1.0);

  // Derive hue from Cb/Cr position — BT.709 inverse at Y=1, 2x chroma boost
  float cb = v_uv.x - 0.5;
  float cr = v_uv.y - 0.5;
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
  constructor(canvas, overlayEl) {
    this.canvas = canvas;
    this.overlay = overlayEl; // <svg> or <canvas> element for graticule
    this.gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!this.gl) throw new Error('WebGL2 not available');
    this._init();
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
  }

  _buildGraticule() {
    if (!this.overlay) return;
    // Build an SVG graticule as a string and inject it
    const size = 256; // logical units
    const cx = 128, cy = 128, r75 = 96; // 75% circle radius in 256 space

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"
      style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;">`;

    // 75% color bar circle
    svg += `<circle cx="${cx}" cy="${cy}" r="${r75}"
      fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="0.5"/>`;

    // 100% circle
    svg += `<circle cx="${cx}" cy="${cy}" r="120"
      fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="0.5"/>`;

    // Crosshairs
    svg += `<line x1="128" y1="8" x2="128" y2="248" stroke="rgba(255,255,255,0.15)" stroke-width="0.5"/>`;
    svg += `<line x1="8"   y1="128" x2="248" y2="128" stroke="rgba(255,255,255,0.15)" stroke-width="0.5"/>`;

    // Skin tone I-line — NTSC I-axis at 132.5° (atan2(dCr, dCb) of the I-axis direction)
    const skinAngle = (132.5 * Math.PI) / 180;
    const sx = cx + Math.cos(skinAngle) * 120;
    const sy = cy - Math.sin(skinAngle) * 120;
    svg += `<line x1="${cx}" y1="${cy}" x2="${sx.toFixed(1)}" y2="${sy.toFixed(1)}"
      stroke="rgba(255,200,100,0.4)" stroke-width="0.75" stroke-dasharray="3,3"/>`;

    // Color target boxes
    for (const t of TARGETS) {
      // Map Cb (0-255) → x, Cr (0-255) → y (Cr increases downward in standard display)
      const tx = (t.cb / 255) * 256;
      const ty = (1 - t.cr / 255) * 256;
      svg += `<rect x="${(tx - 4).toFixed(1)}" y="${(ty - 4).toFixed(1)}"
        width="8" height="8" rx="1"
        fill="none" stroke="${t.color}" stroke-width="1.0"/>`;
      svg += `<text x="${(tx + 5).toFixed(1)}" y="${(ty + 4).toFixed(1)}"
        font-size="7" fill="${t.color}" font-family="monospace">${t.label}</text>`;
    }

    svg += `</svg>`;
    this.overlay.innerHTML = svg;
  }

  render(vectorData) {
    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0.04, 0.04, 0.04, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Find max value for normalisation
    let maxVal = 1;
    for (let i = 0; i < vectorData.length; i++) {
      if (vectorData[i] > maxVal) maxVal = vectorData[i];
    }

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

    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  resize(w, h) {
    this.canvas.width = w;
    this.canvas.height = h;
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
