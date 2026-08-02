/**
 * Confirmação observável de um envio ao agente.
 *
 * O `200` do backend só prova que o texto foi colado no pane. A confirmação
 * acontece exclusivamente quando um item `user` posterior volta pelo stream.
 *
 * A amostra local de 30/07 teve pior caso de 1,434 s, mas não cobriu o cenário
 * que importa no uso real: agente ocupado, pane rolando e iPhone via Tailscale.
 * Em 02/08, 3 s produziu falso negativo e induziu uma entrega duplicada.
 * 12 s dá 8,3× de margem sobre o pior caso medido sem deixar a decisão humana
 * presa por tempo demais. Estourar o prazo significa apenas "não confirmado".
 */
export const PRAZO_ECO_MS = 12_000;

export type FaseEnvio =
  | 'ocioso'
  | 'enviando'
  | 'aceito'
  | 'confirmado'
  | 'nao-confirmado'
  | 'falhou';

type BaseEnvio = {
  texto: string;
  /**
   * Ecos idênticos que ainda podem pertencer a uma tentativa anterior
   * não confirmada. São consumidos antes de confirmar a tentativa atual.
   * É conservador: na ambiguidade, prefere não confirmar a mensagem a atribuir
   * ao segundo "ok" um eco que pode ser do primeiro.
   */
  ecosIguaisSemDono: number;
};

export type EstadoEnvio =
  | { fase: 'ocioso' }
  | ({
      fase: 'enviando';
      fronteira?: FronteiraEnvio;
      ecoCandidatoId?: number;
    } & BaseEnvio)
  | ({
      fase: 'aceito';
      fronteira: FronteiraEnvio;
      aceitoEmMs: number;
    } & BaseEnvio)
  | ({
      fase: 'confirmado';
      fronteira: FronteiraEnvio;
      ecoId: number;
      /** Presente quando a confirmação veio da FILA (`kind: "queued"` do
       *  stream) e não do eco: o agente estava ocupado e o CLI enfileirou a
       *  mensagem — que é recibo de entrega MELHOR que o eco, porque prova
       *  que o texto entrou na caixa de entrada dele. O eco `user` chega
       *  depois, quando a fila drena, e só apaga esta marca — nunca
       *  reconfirma (uma entrega, uma notificação). */
      fila?: true;
    } & BaseEnvio)
  | ({
      fase: 'nao-confirmado';
      fronteira?: FronteiraEnvio;
      aceitoEmMs?: number;
      erro?: unknown;
    } & BaseEnvio)
  | ({
      fase: 'falhou';
      fronteira?: FronteiraEnvio;
      erro: unknown;
    } & BaseEnvio);

/**
 * High-water obtido atomicamente do servidor imediatamente antes do POST.
 *
 * O último callback SSE processado NÃO serve: um item antigo pode estar na
 * fila do browser com id maior. O backend devolve esta barreira no POST antes
 * da primeira operação capaz de entregar o texto.
 */
export type FronteiraEnvio = {
  id: number;
  origem: 'barreira-do-servidor';
};

export type EventoEnvio =
  | { tipo: 'enviar'; texto: string; fronteira?: FronteiraEnvio }
  | {
      tipo: 'aceitar';
      agoraMs: number;
      fronteira?: FronteiraEnvio;
    }
  | { tipo: 'nao-confirmar'; erro: unknown }
  | { tipo: 'falhar'; erro: unknown }
  | {
      tipo: 'item-do-stream';
      item: { id: number; papel: string; texto: string };
    }
  | { tipo: 'tempo-passou'; agoraMs: number };

export const estadoInicialEnvio: EstadoEnvio = { fase: 'ocioso' };

/**
 * Normaliza apenas diferenças de apresentação esperadas no terminal:
 * Unicode canônico (NFC), qualquer sequência de whitespace vira um espaço e
 * as bordas são aparadas. Isso tolera CRLF, quebras e espaços refluídos sem
 * apagar pontuação, caixa ou outros caracteres semanticamente relevantes.
 */
export function normalizaTextoDoEco(texto: string): string {
  return texto.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

function podeComecarNovoEnvio(estado: EstadoEnvio): boolean {
  return (
    estado.fase === 'ocioso' ||
    estado.fase === 'confirmado' ||
    estado.fase === 'nao-confirmado' ||
    estado.fase === 'falhou'
  );
}

export function reduzEnvio(
  estado: EstadoEnvio,
  evento: EventoEnvio,
): EstadoEnvio {
  if (evento.tipo === 'enviar') {
    if (!podeComecarNovoEnvio(estado)) return estado;
    const mesmoTextoAnterior =
      estado.fase !== 'ocioso' &&
      normalizaTextoDoEco(estado.texto) === normalizaTextoDoEco(evento.texto);
    const tentativaAnteriorIncerta =
      estado.fase === 'nao-confirmado' && mesmoTextoAnterior;
    return {
      fase: 'enviando',
      texto: evento.texto,
      fronteira: evento.fronteira,
      ecosIguaisSemDono:
        (mesmoTextoAnterior ? estado.ecosIguaisSemDono : 0) +
        (tentativaAnteriorIncerta ? 1 : 0),
    };
  }

  if (estado.fase === 'ocioso') return estado;

  if (evento.tipo === 'aceitar') {
    if (estado.fase !== 'enviando') return estado;
    const fronteira = evento.fronteira ?? estado.fronteira;
    if (fronteira === undefined) return estado;
    if (estado.ecoCandidatoId !== undefined) {
      const { ecoCandidatoId, ...base } = estado;
      return { ...base, fase: 'confirmado', fronteira, ecoId: ecoCandidatoId };
    }
    return { ...estado, fase: 'aceito', fronteira, aceitoEmMs: evento.agoraMs };
  }

  if (evento.tipo === 'nao-confirmar') {
    if (estado.fase !== 'enviando') return estado;
    const { ecoCandidatoId: _, ...base } = estado;
    return { ...base, fase: 'nao-confirmado', erro: evento.erro };
  }

  if (evento.tipo === 'falhar') {
    if (estado.fase !== 'enviando') return estado;
    const { ecoCandidatoId: _, ...base } = estado;
    return {
      ...base,
      fase: 'falhou',
      erro: evento.erro,
    };
  }

  if (evento.tipo === 'tempo-passou') {
    if (
      estado.fase !== 'aceito' ||
      evento.agoraMs < estado.aceitoEmMs + PRAZO_ECO_MS
    ) {
      return estado;
    }
    return { ...estado, fase: 'nao-confirmado' };
  }

  // item-do-stream daqui pra baixo. Dois papéis confirmam: o eco `user` de
  // sempre e o `fila` (`kind: "queued"` — o recibo de que a mensagem entrou
  // na fila do agente ocupado). Qualquer outro papel é ignorado.
  const papel = evento.item.papel;
  if (papel !== 'user' && papel !== 'fila') return estado;

  // O eco que chega DEPOIS do "entrou na fila": a fila drenou e a mensagem
  // virou item user de verdade. Ele só apaga a marca `fila` — reconfirmar
  // notificaria a mesma entrega duas vezes, e é exatamente a briga que a
  // marca existe para impedir.
  if (estado.fase === 'confirmado') {
    if (
      estado.fila !== true ||
      papel !== 'user' ||
      evento.item.id <= estado.fronteira.id ||
      normalizaTextoDoEco(evento.item.texto) !== normalizaTextoDoEco(estado.texto)
    ) {
      return estado;
    }
    const { fila: _fila, ...confirmado } = estado;
    return { ...confirmado, ecoId: evento.item.id };
  }

  if (
    (estado.fase !== 'enviando' &&
      estado.fase !== 'aceito' &&
      estado.fase !== 'nao-confirmado') ||
    estado.fronteira === undefined ||
    evento.item.id <= estado.fronteira.id ||
    normalizaTextoDoEco(evento.item.texto) !==
      normalizaTextoDoEco(estado.texto)
  ) {
    return estado;
  }

  if (estado.ecosIguaisSemDono > 0) {
    return { ...estado, ecosIguaisSemDono: estado.ecosIguaisSemDono - 1 };
  }

  if (estado.fase === 'enviando') {
    return { ...estado, ecoCandidatoId: evento.item.id };
  }

  return {
    ...estado,
    fase: 'confirmado',
    fronteira: estado.fronteira,
    ecoId: evento.item.id,
    ...(papel === 'fila' ? { fila: true as const } : {}),
  };
}
