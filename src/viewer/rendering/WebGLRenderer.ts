import type { DecodedFrame } from '../../types/dicom';
import type { RenderOptions, RenderingEngine } from '../core/RenderingEngine';
import { imagePlacement } from '../measurements/CoordinateTransforms';

// Places the image quad with the same flip → clockwise rotation → scale → centre + pan as imagePlacement(),
// computed in pixels so rotation keeps the image's shape on a non-square viewport.
const vertexShaderSource = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
uniform vec2 u_halfSize;
uniform vec2 u_center;
uniform vec2 u_viewport;
uniform vec2 u_rotation;
uniform vec2 u_flip;
out vec2 v_texCoord;
void main() {
  vec2 local = vec2(a_position.x * u_halfSize.x, -a_position.y * u_halfSize.y);
  vec2 screen = u_center + vec2(local.x * u_rotation.x - local.y * u_rotation.y, local.x * u_rotation.y + local.y * u_rotation.x);
  gl_Position = vec4(screen.x / u_viewport.x * 2.0 - 1.0, 1.0 - screen.y / u_viewport.y * 2.0, 0.0, 1.0);
  v_texCoord = vec2(u_flip.x > 0.5 ? 1.0 - a_texCoord.x : a_texCoord.x, u_flip.y > 0.5 ? 1.0 - a_texCoord.y : a_texCoord.y);
}`;

const fragmentShaderSource = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform float u_windowWidth;
uniform float u_windowCenter;
uniform float u_invert;
uniform float u_monochromeOne;
in vec2 v_texCoord;
out vec4 outColor;

float sampleBilinear(vec2 uv) {
  vec2 size = vec2(textureSize(u_image, 0));
  vec2 pixel = uv * size - 0.5;
  vec2 base = floor(pixel);
  vec2 f = fract(pixel);
  ivec2 p00 = ivec2(clamp(base, vec2(0.0), size - 1.0));
  ivec2 p10 = ivec2(clamp(base + vec2(1.0, 0.0), vec2(0.0), size - 1.0));
  ivec2 p01 = ivec2(clamp(base + vec2(0.0, 1.0), vec2(0.0), size - 1.0));
  ivec2 p11 = ivec2(clamp(base + vec2(1.0, 1.0), vec2(0.0), size - 1.0));
  float v00 = texelFetch(u_image, p00, 0).r;
  float v10 = texelFetch(u_image, p10, 0).r;
  float v01 = texelFetch(u_image, p01, 0).r;
  float v11 = texelFetch(u_image, p11, 0).r;
  return mix(mix(v00, v10, f.x), mix(v01, v11, f.x), f.y);
}

void main() {
  float value = sampleBilinear(v_texCoord);
  float low = u_windowCenter - 0.5 - (u_windowWidth - 1.0) / 2.0;
  float high = u_windowCenter - 0.5 + (u_windowWidth - 1.0) / 2.0;
  float gray = clamp((value - low) / max(1.0, high - low), 0.0, 1.0);
  if (u_monochromeOne > 0.5) gray = 1.0 - gray;
  if (u_invert > 0.5) gray = 1.0 - gray;
  outColor = vec4(gray, gray, gray, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to create shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader compilation failed.');
  return shader;
}

function link(gl: WebGL2RenderingContext): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('Unable to create WebGL program.');
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexShaderSource));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentShaderSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Program linking failed.');
  return program;
}

export class WebGLRenderer implements RenderingEngine {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private texture?: WebGLTexture;
  private textureKey = '';
  private width = 1;
  private height = 1;
  private dpr = 1;
  private readonly uniforms = new Map<string, WebGLUniformLocation | null>();

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.program = link(gl);
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Unable to create VAO.');
    this.vao = vao;
    gl.bindVertexArray(vao);

    const data = new Float32Array([
      -1, -1, 0, 1,
       1, -1, 1, 1,
      -1,  1, 0, 0,
       1,  1, 1, 0
    ]);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const stride = 4 * Float32Array.BYTES_PER_ELEMENT;
    const position = gl.getAttribLocation(this.program, 'a_position');
    const texCoord = gl.getAttribLocation(this.program, 'a_texCoord');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(texCoord);
    gl.vertexAttribPointer(texCoord, 2, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT);
  }

  resize(width: number, height: number): void {
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    this.width = Math.max(1, Math.floor(width * this.dpr));
    this.height = Math.max(1, Math.floor(height * this.dpr));
    if (this.canvas.width !== this.width || this.canvas.height !== this.height) {
      this.canvas.width = this.width;
      this.canvas.height = this.height;
    }
  }

  render(frame: DecodedFrame, options: RenderOptions): number {
    const started = performance.now();
    const gl = this.gl;
    const key = frame.metadata.sopInstanceUID;
    if (this.textureKey !== key) {
      this.upload(frame);
      this.textureKey = key;
    }

    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture ?? null);
    gl.uniform1i(this.uniform('u_image'), 0);
    gl.uniform1f(this.uniform('u_windowWidth'), options.windowWidth);
    gl.uniform1f(this.uniform('u_windowCenter'), options.windowCenter);
    gl.uniform1f(this.uniform('u_invert'), options.camera.inverted ? 1 : 0);
    gl.uniform1f(this.uniform('u_monochromeOne'), frame.metadata.photometricInterpretation === 'MONOCHROME1' ? 1 : 0);
    gl.uniform2f(this.uniform('u_flip'), options.camera.flipH ? 1 : 0, options.camera.flipV ? 1 : 0);
    // Placement is worked out in CSS pixels, like the overlay, then converted to device pixels.
    const place = imagePlacement(options.camera, this.width / this.dpr, this.height / this.dpr, frame.metadata.columns, frame.metadata.rows);
    gl.uniform2f(this.uniform('u_halfSize'), (frame.metadata.columns / 2) * place.scale * this.dpr, (frame.metadata.rows / 2) * place.scale * this.dpr);
    gl.uniform2f(this.uniform('u_center'), place.centerX * this.dpr, place.centerY * this.dpr);
    gl.uniform2f(this.uniform('u_viewport'), this.width, this.height);
    gl.uniform2f(this.uniform('u_rotation'), place.cos, place.sin);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return performance.now() - started;
  }

  private uniform(name: string): WebGLUniformLocation | null {
    if (!this.uniforms.has(name)) this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
    return this.uniforms.get(name) ?? null;
  }

  dispose(): void {
    if (this.texture) this.gl.deleteTexture(this.texture);
    this.gl.deleteProgram(this.program);
    this.gl.deleteVertexArray(this.vao);
  }

  private upload(frame: DecodedFrame): void {
    const gl = this.gl;
    if (!this.texture) this.texture = gl.createTexture() ?? undefined;
    gl.bindTexture(gl.TEXTURE_2D, this.texture ?? null);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, frame.metadata.columns, frame.metadata.rows, 0, gl.RED, gl.FLOAT, frame.modalityPixels);
  }
}
