/**
 * Confirmação observável de um envio ao agente.
 *
 * O `200` do backend só prova que o texto foi colado no pane. A confirmação
 * acontece exclusivamente quando um item `user` posterior volta pelo stream.
 *
 * O corpus atual não permite medir o intervalo POST → eco: `task_events`
 * persiste o `jsonl:user`, mas `/input` não persiste o instante da tentativa
 * nem seu `idempotency_key`. Portanto 3 s é um fallback operacional, alinhado
 * à inclinação registrada no contrato. Para substituí-lo por um percentil
 * medido, o backend precisará registrar `send_attempt_id`, `accepted_at_ms` e
 * o eco correlacionado.
 */
export const PRAZO_ECO_MS = 3_000;

export type FaseEnvio =
  | 'ocioso'
  | 'enviando'
  | 'aceito'
  | 'confirmado'
  | 'pendurado'
  | 'falhou';

type BaseEnvio = {
  texto: string;
  /**
   * Ecos idênticos que ainda podem pertencer a uma tentativa anterior
   * pendurada/falha. São consumidos antes de confirmar a tentativa atual.
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
    } & BaseEnvio)
  | ({
      fase: 'pendurado';
      fronteira: FronteiraEnvio;
      aceitoEmMs: number;
    } & BaseEnvio)
  | ({
      fase: 'falhou';
      fronteira?: FronteiraEnvio;
      erro: unknown;
      entregaIncerta: boolean;
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
  | { tipo: 'falhar'; erro: unknown; entregaIncerta: boolean }
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
    estado.fase === 'pendurado' ||
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
      (estado.fase === 'pendurado' ||
        (estado.fase === 'falhou' && estado.entregaIncerta)) &&
      mesmoTextoAnterior;
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

  if (evento.tipo === 'falhar') {
    if (estado.fase !== 'enviando') return estado;
    const { ecoCandidatoId: _, ...base } = estado;
    return {
      ...base,
      fase: 'falhou',
      erro: evento.erro,
      entregaIncerta: evento.entregaIncerta,
    };
  }

  if (evento.tipo === 'tempo-passou') {
    if (
      estado.fase !== 'aceito' ||
      evento.agoraMs < estado.aceitoEmMs + PRAZO_ECO_MS
    ) {
      return estado;
    }
    return { ...estado, fase: 'pendurado' };
  }

  if (
    (estado.fase !== 'enviando' &&
      estado.fase !== 'aceito' &&
      estado.fase !== 'pendurado') ||
    estado.fronteira === undefined ||
    evento.item.papel !== 'user' ||
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

  return { ...estado, fase: 'confirmado', ecoId: evento.item.id };
}
