// Tela do agente (`/maquinas/<maquina>/chrome/<chrome>`) — ver ao vivo o Chrome de
// um agente, assumir, digitar e devolver. O contrato é `docs/tela-do-agente/contrato-api.md`;
// aqui moram os tipos, os fetchers e a lógica que decide o que a tela diz. Sem React:
// testável em `node --test`.

export type ChromeDoCatalogo = { id: string; maquina: string; rotulo: string };

export type StatusDoPedido = 'aguardando' | 'em_atendimento' | 'devolvido' | 'expirado' | 'interrompido';

export type Pedido = {
  id: string;
  chrome: string;
  motivo: string;
  agente: string;
  prazo_s: number;
  /** Epoch em segundos. */
  expira_em: number;
  status: StatusDoPedido;
  aviso_enviado: boolean;
  url: string;
};

export type Sessao = {
  id: string;
  chrome: string;
  aba: string;
  inatividade_s: number;
  sem_fluxo_s: number;
  pedido: Pedido | null;
};

export type Quadro = {
  id: string;
  aba: string;
  jpeg: string;
  largura: number;
  altura: number;
  viewport: { largura: number; altura: number };
};

export type EstadoDoFluxo = { assumido: boolean; aba: string; pedido: Pedido | null };

export type Aba = { id: string; titulo: string; url: string };

export type Entrada =
  | { tipo: 'clique'; quadro: string; x: number; y: number }
  | { tipo: 'rolagem'; quadro: string; x: number; y: number; delta_x: number; delta_y: number }
  | { tipo: 'texto'; texto: string }
  | { tipo: 'tecla'; tecla: 'Enter' | 'Tab' | 'Backspace' }
  | { tipo: 'aba'; aba: string };

/** Erro HTTP da API com o código: a tela escolhe o texto pelo número. */
export class FalhaDaTela extends Error {
  status: number;
  constructor(mensagem: string, status: number) {
    super(mensagem);
    this.status = status;
  }
}

const RAIZ = '/api/tela-agente';

function base(): string {
  if (typeof window !== 'undefined') return '';
  return process.env.API_BACKEND_URL ?? 'http://127.0.0.1:8002';
}

async function pede<T>(caminho: string, init: RequestInit = {}, controle?: string | null): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  if (controle) headers.set('X-Tela-Controle', controle);
  const res = await fetch(`${base()}${RAIZ}${caminho}`, { cache: 'no-store', ...init, headers });
  if (!res.ok) {
    let detalhe = `erro ${res.status}`;
    try {
      const corpo = await res.json();
      if (typeof corpo?.detail === 'string') detalhe = corpo.detail;
    } catch {
      /* corpo sem JSON: fica o código */
    }
    throw new FalhaDaTela(detalhe, res.status);
  }
  return res.json();
}

export const fetchChromes = () => pede<ChromeDoCatalogo[]>('/chromes');

export const abrirSessao = (chrome: string, pedido?: string | null) =>
  pede<Sessao>(`/chromes/${encodeURIComponent(chrome)}/sessoes${pedido ? `?pedido=${encodeURIComponent(pedido)}` : ''}`, {
    method: 'POST',
  });

export const urlDosQuadros = (sessao: string) => `${RAIZ}/sessoes/${encodeURIComponent(sessao)}/quadros`;

/** Área do quadro no aparelho, em CSS px: no controle, a página é desenhada nesse tamanho. */
export type Tamanho = { largura: number; altura: number };

export const assumir = (sessao: string, tamanho?: Tamanho | null) =>
  pede<{ controle: string }>(`/sessoes/${encodeURIComponent(sessao)}/assumir`, {
    method: 'POST',
    body: tamanho ? JSON.stringify(tamanho) : undefined,
  });

/** O back aceita 1–4096 e põe piso de 320 em cada lado; aqui só arredonda e prende. */
const LADO_MINIMO = 320;
const LADO_MAXIMO = 4096;
/**
 * O que fica abaixo do quadro no controle (dica da pinça, rótulo, campo, teclas e
 * o respiro do fim), medido em 390px: ~212px. Com folga para a quebra a 320px.
 */
export const RESERVA_ABAIXO_DO_QUADRO = 240;

/**
 * O tamanho que a página do agente vai ter enquanto o Rica controla: a largura do
 * quadro na tela dele, e a altura que sobra do topo do quadro até a reserva dos
 * controles. No iPhone isso dá uma página em coluna, do tamanho do dedo.
 */
export function tamanhoDoAparelho(larguraDoQuadro: number, topoDoQuadro: number, alturaDaJanela: number): Tamanho {
  const prende = (v: number) => Math.max(LADO_MINIMO, Math.min(LADO_MAXIMO, Math.round(v)));
  return {
    largura: prende(larguraDoQuadro),
    altura: prende(alturaDaJanela - Math.max(0, topoDoQuadro) - RESERVA_ABAIXO_DO_QUADRO),
  };
}

/**
 * Reaplica o tamanho com a posse já tomada (o aparelho girou). Rota nova do back:
 * `POST /sessoes/{id}/tamanho`, mesmo corpo do Assumir, com `X-Tela-Controle`.
 * Back sem a rota responde 404/405 — a tela segue no tamanho do Assumir.
 */
export const ajustarTamanho = (sessao: string, controle: string, tamanho: Tamanho) =>
  pede<{ ajustado: true }>(`/sessoes/${encodeURIComponent(sessao)}/tamanho`, { method: 'POST', body: JSON.stringify(tamanho) }, controle);

export const devolver = (sessao: string, controle: string) =>
  pede<{ devolvido: true }>(`/sessoes/${encodeURIComponent(sessao)}/devolver`, { method: 'POST' }, controle);

export const enviarEntrada = (sessao: string, controle: string, entrada: Entrada) =>
  pede<{ entregue_cdp: true }>(
    `/sessoes/${encodeURIComponent(sessao)}/entrada`,
    { method: 'POST', body: JSON.stringify(entrada) },
    controle,
  );

export const fetchAbas = (sessao: string) => pede<Aba[]>(`/sessoes/${encodeURIComponent(sessao)}/abas`);

/**
 * Ao sair. `keepalive` deixa o pedido viver depois que a página fecha. A promessa
 * cumpre quando o back soltou a sessão (ou falhou): reabrir depois dela não leva 409.
 */
export function encerrarSessao(sessao: string): Promise<void> {
  return fetch(`${RAIZ}/sessoes/${encodeURIComponent(sessao)}`, { method: 'DELETE', keepalive: true }).then(
    () => undefined,
    () => undefined,
  );
}

/**
 * Do catálogo para a linha de Abertos: `maquina|rotulo` → id do Chrome. Só o par
 * exato e único oferece a tela — rótulo repetido na mesma máquina fica sem botão
 * (contrato: sem correspondência aproximada).
 */
export function mapaDeTelas(catalogo: ChromeDoCatalogo[]): Map<string, string> {
  const contagem = new Map<string, number>();
  for (const c of catalogo) contagem.set(`${c.maquina}|${c.rotulo}`, (contagem.get(`${c.maquina}|${c.rotulo}`) ?? 0) + 1);
  const mapa = new Map<string, string>();
  for (const c of catalogo) if (contagem.get(`${c.maquina}|${c.rotulo}`) === 1) mapa.set(`${c.maquina}|${c.rotulo}`, c.id);
  return mapa;
}

export function caminhoDaTela(maquina: string, chrome: string, pedido?: string | null): string {
  const caminho = `/maquinas/${encodeURIComponent(maquina)}/chrome/${encodeURIComponent(chrome)}`;
  return pedido ? `${caminho}?pedido=${encodeURIComponent(pedido)}` : caminho;
}

type Caixa = { left: number; top: number; width: number; height: number };

/**
 * Do toque na tela para a coordenada normalizada DENTRO da imagem. A caixa é a
 * do elemento; com `object-fit: contain` a imagem pode ter faixas dos lados ou em
 * cima, e o toque na faixa não vira clique (null). Resultado em `0 ≤ x,y < 1`.
 */
export function pontoNaImagem(
  clienteX: number,
  clienteY: number,
  caixa: Caixa,
  natural: { largura: number; altura: number },
): { x: number; y: number } | null {
  if (caixa.width <= 0 || caixa.height <= 0 || natural.largura <= 0 || natural.altura <= 0) return null;
  const escala = Math.min(caixa.width / natural.largura, caixa.height / natural.altura);
  const largura = natural.largura * escala;
  const altura = natural.altura * escala;
  const esquerda = caixa.left + (caixa.width - largura) / 2;
  const topo = caixa.top + (caixa.height - altura) / 2;
  const x = (clienteX - esquerda) / largura;
  const y = (clienteY - topo) / altura;
  if (x < 0 || y < 0 || x >= 1 || y >= 1) return null;
  return { x, y };
}

/** Quantos px CSS da página valem um px da imagem na tela: arrastar o dedo rola a mesma distância. */
export function pxDaPagina(larguraNaTela: number, viewportLargura: number): number {
  return larguraNaTela > 0 ? viewportLargura / larguraNaTela : 1;
}

export const LIMITE_DA_ROLAGEM = 3000;

export function limitaRolagem(delta: number): number {
  return Math.max(-LIMITE_DA_ROLAGEM, Math.min(LIMITE_DA_ROLAGEM, Math.round(delta)));
}

/** "9:41" ou "0:07" — quanto falta para o prazo do pedido. */
export function textoDoPrazo(expiraEm: number, agoraS: number): string {
  const resta = Math.max(0, Math.floor(expiraEm - agoraS));
  const min = Math.floor(resta / 60);
  const s = resta % 60;
  return `${min}:${String(s).padStart(2, '0')}`;
}

/** O que falhou, dito para quem está com o dedo na tela. */
export function textoDaFalha(acao: 'abrir' | 'assumir' | 'devolver' | 'entrada' | 'ajustar', status: number | undefined, detalhe: string): string {
  if (acao === 'abrir') {
    if (status === 404) return 'Este Chrome não está no cadastro da tela.';
    if (status === 409) return 'Já tem uma tela aberta para este Chrome, talvez em outra aba ou aparelho. Feche a outra e reconecte.';
    if (status === 502) return 'O Chrome não respondeu: pode estar fechado ou a máquina fora do ar. Reconecte em instantes.';
  }
  if (acao === 'assumir' && status === 409) return 'Um agente está usando este Chrome agora. Tente assumir de novo em instantes.';
  if (acao === 'entrada' && status === 409) return 'A imagem mudou antes do toque. Toque de novo na imagem nova.';
  if (status === 403) return 'A posse acabou. Assuma de novo para continuar.';
  if (status === 410) return 'A tela foi encerrada. Reconecte para continuar.';
  if (acao === 'ajustar') return 'A página do Chrome ficou no tamanho anterior. Dá para seguir assim.';
  const proximo =
    acao === 'abrir'
      ? 'Não consegui abrir a tela. Toque em Reconectar.'
      : acao === 'assumir'
        ? 'Não consegui assumir. Toque em Assumir de novo.'
        : acao === 'devolver'
          ? 'Não consegui devolver. Toque em Devolver de novo; se continuar, saia da tela e a posse volta ao agente.'
          : 'O Chrome não recebeu o toque. Tente de novo.';
  return `${proximo} (${detalhe})`;
}

/** Ampliação local do quadro (pinça): `translate(x, y) scale(escala)`, origem no canto. */
export type Vista = { escala: number; x: number; y: number };

export const VISTA_INTEIRA: Vista = { escala: 1, x: 0, y: 0 };
export const ESCALA_MAXIMA = 5;

/**
 * Dois dedos: o ponto da imagem que estava sob o meio dos dedos no começo segue
 * sob o meio dos dedos agora; a escala acompanha a distância. A imagem nunca
 * deixa vão dentro da moldura.
 */
export function pinca(
  inicio: Vista,
  distancia0: number,
  distancia: number,
  meio0: { x: number; y: number },
  meio: { x: number; y: number },
  moldura: { largura: number; altura: number },
): Vista {
  const escala = Math.max(1, Math.min(ESCALA_MAXIMA, inicio.escala * (distancia0 > 0 ? distancia / distancia0 : 1)));
  const ux = (meio0.x - inicio.x) / inicio.escala;
  const uy = (meio0.y - inicio.y) / inicio.escala;
  const prende = (v: number, lado: number) => Math.min(0, Math.max(lado - lado * escala, v));
  return { escala, x: prende(meio.x - escala * ux, moldura.largura), y: prende(meio.y - escala * uy, moldura.altura) };
}
