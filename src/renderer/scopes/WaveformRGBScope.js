const VERT = `#version 300 es
precision highp float;
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// Single-channel histogram rendered with a tint colour
const FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_histogram;
uniform vec3 u_color;
uniform float u_gain;
in vec2 v_uv;
out vec4 fragColor;

void main() {
  float density = min(texture(u_histogram, v_uv).r * u_gain, 1.0);
  fragColor = vec4(u_color * density, 1.0);
}`;

const GRID_FRAG = `#version 300 es
precision highp float;
uniform float u_height;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  float y = v_uv.y;
  float lineWidth = 1.5 / u_height;
  float nearest = abs(mod(y, 0.1) - 0.05);
  float alpha = nearest < lineWidth ? 0.22 : 0.0;
  float major = abs(mod(y + 0.001, 0.5));
  if (major < lineWidth * 1.5) alpha = 0.4;
  fragColor = vec4(0.5, 0.5, 0.5, alpha);
}`;

export class WaveformRGBScope {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!this.gl) throw new Error('WebGL2 not available');
    this._init();
  }

  _init() {
    const gl = this.gl;
    // LINEAR filtering on float textures requires this extension in WebGL2
    const floatLinear = gl.getExtension('OES_texture_float_linear');
    this._filter = floatLinear ? gl.LINEAR : gl.NEAREST;

    this._prog = this._makeProgram(VERT, FRAG);
    this._gridProg = this._makeProgram(VERT, GRID_FRAG);

    const quad = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);
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

    // Three textures for R, G, B
    this._texR = this._makeTex(gl);
    this._texG = this._makeTex(gl);
    this._texB = this._makeTex(gl);

    this._texWidth = 0;
    this._texDataR = null;
    this._texDataG = null;
    this._texDataB = null;
    this._gain = 10.0;
  }

  _makeTex(gl) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this._filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this._filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  _transposeChannel(src, width, dst) {
    for (let x = 0; x < width; x++) {
      for (let Y = 0; Y < 256; Y++) {
        dst[Y * width + x] = src[x * 256 + Y];
      }
    }
  }

  _uploadTex(tex, data, width) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, 256, 0, gl.RED, gl.FLOAT, data);
  }

  render(rData, gData, bData, width) {
    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0.05, 0.05, 0.05, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (this._texWidth !== width) {
      this._texDataR = new Float32Array(width * 256);
      this._texDataG = new Float32Array(width * 256);
      this._texDataB = new Float32Array(width * 256);
      this._texWidth = width;
    }

    this._transposeChannel(rData, width, this._texDataR);
    this._transposeChannel(gData, width, this._texDataG);
    this._transposeChannel(bData, width, this._texDataB);

    this._uploadTex(this._texR, this._texDataR, width);
    this._uploadTex(this._texG, this._texDataG, width);
    this._uploadTex(this._texB, this._texDataB, width);

    gl.enable(gl.BLEND);
    gl.bindVertexArray(this._vao);

    // Grid
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this._gridProg);
    gl.uniform1f(gl.getUniformLocation(this._gridProg, 'u_height'), ch);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // RGB channels with additive blending
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this._prog);
    const histLoc = gl.getUniformLocation(this._prog, 'u_histogram');
    const colLoc  = gl.getUniformLocation(this._prog, 'u_color');
    const gainLoc = gl.getUniformLocation(this._prog, 'u_gain');
    gl.uniform1f(gainLoc, this._gain);

    const channels = [
      { tex: this._texR, color: [1.0, 0.05, 0.05] },
      { tex: this._texG, color: [0.05, 1.0, 0.05] },
      { tex: this._texB, color: [0.1,  0.3,  1.0] },
    ];

    for (const { tex, color } of channels) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(histLoc, 0);
      gl.uniform3fv(colLoc, color);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    gl.disable(gl.BLEND);
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
