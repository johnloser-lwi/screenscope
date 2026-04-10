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
uniform sampler2D u_histogram;
uniform float u_gain;
in vec2 v_uv;
out vec4 fragColor;

void main() {
  // v_uv.x = column (0..1), v_uv.y = luma level (0=black..1=white)
  float density = min(texture(u_histogram, v_uv).r * u_gain, 1.0);
  fragColor = vec4(vec3(density), 1.0);
}`;

const GRID_FRAG = `#version 300 es
precision highp float;
uniform float u_width;
uniform float u_height;
in vec2 v_uv;
out vec4 fragColor;

void main() {
  float y = v_uv.y;
  // IRE grid lines at 0%, 10%, 20%...100%
  float gridStep = 0.1;
  float nearest = abs(mod(y, gridStep) - gridStep * 0.5);
  float lineWidth = 1.0 / u_height;
  float alpha = nearest < lineWidth * 1.5 ? 0.25 : 0.0;
  // Slightly brighter at 0, 50, 100
  float major = abs(mod(y + 0.001, 0.5));
  if (major < lineWidth * 2.0) alpha = 0.45;
  fragColor = vec4(0.5, 0.5, 0.5, alpha);
}`;

export class WaveformScope {
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
    const filter = floatLinear ? gl.LINEAR : gl.NEAREST;

    this._prog = this._makeProgram(VERT, FRAG);
    this._gridProg = this._makeProgram(VERT, GRID_FRAG);

    // Full-screen quad
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

    // Histogram texture (width × 256, single channel float)
    this._tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this._texWidth = 0;
    this._gain = 10.0;
  }

  render(lumaData, width) {
    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0.05, 0.05, 0.05, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Upload histogram texture: width columns × 256 luma rows
    // lumaData is Float32Array[width*256] indexed [x*256+Y]
    // We need it as [Y*width+x] for correct texture layout (row-major = Y axis)
    let texData;
    if (this._texWidth !== width) {
      texData = new Float32Array(width * 256);
      this._texWidth = width;
    } else {
      texData = this._texData || new Float32Array(width * 256);
    }
    this._texData = texData;

    for (let x = 0; x < width; x++) {
      for (let Y = 0; Y < 256; Y++) {
        texData[Y * width + x] = lumaData[x * 256 + Y];
      }
    }

    gl.bindTexture(gl.TEXTURE_2D, this._tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, 256, 0, gl.RED, gl.FLOAT, texData);

    // Draw grid first
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this._gridProg);
    gl.uniform1f(gl.getUniformLocation(this._gridProg, 'u_width'), cw);
    gl.uniform1f(gl.getUniformLocation(this._gridProg, 'u_height'), ch);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Draw waveform
    gl.useProgram(this._prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._tex);
    gl.uniform1i(gl.getUniformLocation(this._prog, 'u_histogram'), 0);
    gl.uniform1f(gl.getUniformLocation(this._prog, 'u_gain'), this._gain);
    gl.blendFunc(gl.ONE, gl.ONE); // additive
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
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
