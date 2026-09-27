/**
 * WebGL cru para os visuais da conversa: um triângulo que cobre a tela e um
 * fragment shader que desenha tudo. Sem `three`, sem dependência.
 *
 * Quem cria chama `libera()` ao desmontar: GPU de celular divide memória com a
 * CPU, e contexto esquecido é memória presa até o Safari matar a aba.
 */

export type TelaWebGL = {
  gl: WebGLRenderingContext;
  u(nome: string): WebGLUniformLocation | null;
  /** Redimensiona o buffer e devolve quantos pixels de buffer valem um px CSS. */
  ajusta(): number;
  desenha(): void;
  libera(): void;
};

const VERTICE = 'attribute vec2 a; void main() { gl_Position = vec4(a, 0., 1.); }';

export function criaTelaWebGL(
  canvas: HTMLCanvasElement,
  fragmento: string,
  escala: number,
): TelaWebGL | null {
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
  });
  if (!gl) return null;

  const perde = () => gl.getExtension('WEBGL_lose_context')?.loseContext();
  const compila = (tipo: number, fonte: string) => {
    const shader = gl.createShader(tipo);
    if (!shader) return null;
    gl.shaderSource(shader, fonte);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    console.warn('[conversa] shader não compilou:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  };

  const vs = compila(gl.VERTEX_SHADER, VERTICE);
  const fs = compila(gl.FRAGMENT_SHADER, fragmento);
  const programa = gl.createProgram();
  if (!vs || !fs || !programa) {
    perde();
    return null;
  }
  gl.attachShader(programa, vs);
  gl.attachShader(programa, fs);
  gl.linkProgram(programa);
  if (!gl.getProgramParameter(programa, gl.LINK_STATUS)) {
    perde();
    return null;
  }
  gl.useProgram(programa);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const cache = new Map<string, WebGLUniformLocation | null>();
  return {
    gl,
    u(nome) {
      if (!cache.has(nome)) cache.set(nome, gl.getUniformLocation(programa, nome));
      return cache.get(nome) ?? null;
    },
    ajusta() {
      const caixa = canvas.getBoundingClientRect();
      const px = Math.min(2, window.devicePixelRatio || 1) * escala;
      canvas.width = Math.max(1, Math.round(caixa.width * px));
      canvas.height = Math.max(1, Math.round(caixa.height * px));
      gl.viewport(0, 0, canvas.width, canvas.height);
      return canvas.width / Math.max(1, caixa.width);
    },
    desenha() {
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    libera() {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(programa);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      perde();
    },
  };
}

/**
 * Lê tokens de cor do tema como RGB 0–1. Os tokens são `oklch()` e o
 * `getComputedStyle` devolve `oklch(...)`, que o WebGL não entende: passa por
 * um canvas 2D de 1 px, que converte para sRGB (fora do gamut, reduz).
 */
export function leCoresDoTema<T extends string>(
  tokens: Record<T, string>,
): Record<T, [number, number, number]> {
  const sonda = document.createElement('canvas');
  sonda.width = 1;
  sonda.height = 1;
  const ctx = sonda.getContext('2d', { willReadFrequently: true });
  const amostra = document.createElement('span');
  document.body.append(amostra);
  const cores = {} as Record<T, [number, number, number]>;
  for (const nome of Object.keys(tokens) as T[]) {
    amostra.style.color = `var(${tokens[nome]})`;
    const cor = getComputedStyle(amostra).color;
    if (!ctx) {
      cores[nome] = [0.5, 0.5, 0.5];
      continue;
    }
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = cor;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    cores[nome] = [r / 255, g / 255, b / 255];
  }
  amostra.remove();
  return cores;
}
