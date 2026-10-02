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

/**
 * Tamanho do buffer a partir do tamanho de LAYOUT do canvas (`clientWidth`), não
 * do `getBoundingClientRect`: este já vem multiplicado pelo `transform` dos
 * ancestrais. A esfera mini entra com `scale(0.6)` — medida no meio da entrada,
 * o buffer nascia com 60% dos pixels e o canvas era ampliado (borrão), e o
 * `ResizeObserver` não dispara em mudança de transform, então nunca remedia.
 */
export function tamanhoDoBuffer(larguraCss: number, alturaCss: number, dpr: number, escala: number) {
  const px = Math.min(2, dpr || 1) * escala;
  const largura = Math.max(1, Math.round(larguraCss * px));
  const altura = Math.max(1, Math.round(alturaCss * px));
  return { largura, altura, esc: largura / Math.max(1, larguraCss) };
}

/**
 * Avisa quando o `devicePixelRatio` muda (janela arrastada para outro monitor,
 * zoom do navegador): nada disso muda o tamanho em px CSS, então o
 * `ResizeObserver` fica calado. A consulta vale para UM valor de dpr — a cada
 * troca, refaz para o novo. Devolve quem desliga.
 */
export function ouveTrocaDeDpr(aoTrocar: () => void): () => void {
  let consulta: MediaQueryList | null = null;
  const arma = () => {
    consulta?.removeEventListener('change', troca);
    consulta = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    consulta.addEventListener('change', troca);
  };
  const troca = () => {
    arma();
    aoTrocar();
  };
  arma();
  return () => consulta?.removeEventListener('change', troca);
}

const VERTICE = 'attribute vec2 a; void main() { gl_Position = vec4(a, 0., 1.); }';

/** `transparente`: o canvas deixa ver o que está atrás (saída em alfa pré-multiplicado). */
export function criaTelaWebGL(
  canvas: HTMLCanvasElement,
  fragmento: string,
  escala: number,
  { transparente = false } = {},
): TelaWebGL | null {
  const gl = canvas.getContext('webgl', {
    alpha: transparente,
    premultipliedAlpha: true,
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
      const { largura, altura, esc } = tamanhoDoBuffer(
        canvas.clientWidth,
        canvas.clientHeight,
        window.devicePixelRatio,
        escala,
      );
      // Mudar o tamanho apaga e realoca o buffer: só quando mudou de fato.
      if (canvas.width !== largura || canvas.height !== altura) {
        canvas.width = largura;
        canvas.height = altura;
        gl.viewport(0, 0, largura, altura);
      }
      return esc;
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

/** `data-nivel` a 10 Hz, só quando muda: é o que o E2E lê para provar que a luz segue a voz. */
export function criaPublicadorDeNivel(raiz: HTMLElement) {
  let publicado = -1;
  let publicadoEm = 0;
  return (nivel: number, agora: number) => {
    if (agora - publicadoEm < 100) return;
    publicadoEm = agora;
    const arredondado = Math.round(nivel * 100) / 100;
    if (arredondado !== publicado) raiz.dataset.nivel = String(arredondado);
    publicado = arredondado;
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
  const cores = {} as Record<T, [number, number, number]>;
  for (const nome of Object.keys(tokens) as T[]) {
    // Uma amostra nova por token: trocar a cor da mesma amostra dispara a
    // transição global do movimento reduzido (0,01 ms), e a leitura sai com a
    // cor anterior — tudo ficava da cor do primeiro token.
    const amostra = document.createElement('span');
    amostra.style.color = `var(${tokens[nome]})`;
    document.body.append(amostra);
    const cor = getComputedStyle(amostra).color;
    amostra.remove();
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
  return cores;
}
