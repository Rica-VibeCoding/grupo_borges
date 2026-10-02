/**
 * O microfone e o STT que falham — o diagnóstico, sempre com uma saída. Saiu de
 * `voz.ts` (02/10) com os comentários; lá ficam o gesto, o piso e a aparência.
 */

// ---------------------------------------------------------------------------
// Microfone indisponível — o item 4 do despacho.
// ---------------------------------------------------------------------------

export type Impedimento = {
  /** O que aconteceu, na voz do Rica. */
  resumo: string;
  /** O que fazer a respeito. Nunca vazio: mensagem de erro sem saída é o mesmo
   *  botão morto que esta peça existe pra consertar. */
  saida: string;
  /** `true` quando insistir no mesmo lugar não resolve (precisa mexer em
   *  ajuste do sistema ou trocar de URL) — a tela esconde o "tentar de novo". */
  definitivo: boolean;
  /** A MÁQUINA NÃO TEM MICROFONE. Não é impedimento a explicar, é controle que
   *  não deveria estar na tela: quem lê isto retira o botão em vez de escrever
   *  um aviso (ver a nota do slot de entrada em `composer.tsx`). */
  semAparelho?: boolean;
};

/** Contexto não-seguro: `navigator.mediaDevices` simplesmente não existe.
 *
 * Isto NÃO é hipotético aqui. O cockpit é publicado por `tailscale serve` com
 * certificado real (`https://…​.ts.net:3443`), mas o mesmo servidor responde
 * pelo IP `100.x` em HTTP puro — e abrir pelo IP mata o microfone sem dizer
 * por quê. Está escrito no playbook (§ "Regra: abrir sempre pelo nome .ts.net")
 * como a causa número um de "o mic não funciona". Uma tela que sabe disso e
 * cala é pior que um botão morto.
 */
/**
 * O STT falhou NO SERVIDOR — o áudio subiu, a fala não virou texto.
 *
 * Mesma régua do microfone: nunca só o diagnóstico, sempre a saída. Erros
 * conhecidos de STT acontecem antes da entrega e podem ser categóricos. Um
 * erro genérico, porém, também pode ser perda da resposta depois que o back
 * entregou; nesse caso a tela assume incerteza para não induzir duplicação.
 *
 * Os detalhes vêm crus do `detail` do FastAPI, embutidos na mensagem do erro
 * que `postAgentTranscription` lança. Casar por substring é frágil de propósito: se o
 * back mudar o rótulo, cai no caso geral, que continua acionável.
 */
export function diagnosticaTranscricao(erro: unknown): Impedimento {
  const texto =
    typeof erro === 'string'
      ? erro
      : erro instanceof Error
        ? erro.message
        : typeof erro === 'object' && erro !== null && 'message' in erro
          ? String((erro as { message: unknown }).message)
          : '';

  if (texto.includes('stt_empty')) {
    return {
      resumo: 'não veio fala nenhuma no áudio',
      saida: 'segure o botão, espere meio segundo e fale — o começo costuma se perder',
      definitivo: false,
    };
  }
  if (texto.includes('stt_timeout')) {
    return {
      resumo: 'o áudio passou do tempo que o servidor transcreve',
      saida: 'grave em trechos mais curtos — o teto é 30s de processamento',
      definitivo: false,
    };
  }
  if (texto.includes('stt_script_not_found')) {
    return {
      resumo: 'o servidor está sem o script de transcrição',
      saida: 'isto é infra, não é você: mande por texto e avise o Pavan',
      definitivo: true,
    };
  }
  if (texto.includes('stt_failed')) {
    return {
      resumo: 'a transcrição falhou no servidor',
      saida: 'tente de novo; se repetir, mande por texto',
      definitivo: false,
    };
  }
  if (texto.includes('422')) {
    return {
      resumo: 'o servidor recusou o formato ou o tamanho do áudio',
      saida: 'áudios acima de 10 MB não sobem — grave um trecho menor',
      definitivo: false,
    };
  }
  return {
    resumo: 'não consegui confirmar se o áudio entrou',
    saida: 'confira no chat antes de mandar de novo — repetir pode duplicar',
    definitivo: false,
  };
}

export function impedimentoDeContexto(): Impedimento {
  return {
    resumo: 'o navegador não libera o microfone nesta página',
    saida: 'abra o cockpit pelo endereço .ts.net, não pelo IP 100.x — o microfone só existe em HTTPS',
    definitivo: true,
  };
}

/** Traduz o erro do `getUserMedia`. Os nomes vêm do padrão e são os mesmos em
 *  Safari, Chrome e Firefox; o `name` é o contrato, a `message` não é. */
export function diagnosticaMicrofone(erro: unknown): Impedimento {
  const nome =
    typeof erro === 'object' && erro !== null && 'name' in erro
      ? String((erro as { name: unknown }).name)
      : '';

  switch (nome) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        resumo: 'microfone bloqueado para esta página',
        saida: 'no iPhone: Ajustes ▸ Safari ▸ Microfone, ou o "aA" na barra de endereço ▸ Ajustes do Site',
        definitivo: true,
      };
    case 'NotFoundError':
      // `OverconstrainedError` morava junto e SAIU: ele diz "o aparelho existe,
      // as exigências é que não fecham", e a exigência daqui é `{ audio: true }`
      // — a mais frouxa que existe. Agrupar os dois faria um aparelho presente
      // ser tratado como ausente e o botão sumir por engano.
      return {
        resumo: 'nenhum microfone encontrado',
        saida: 'conecte um microfone ou use o teclado',
        definitivo: true,
        semAparelho: true,
      };
    case 'NotReadableError':
      return {
        resumo: 'o microfone está ocupado por outro app',
        saida: 'feche quem está usando (chamada, gravador) e tente de novo',
        definitivo: false,
      };
    case 'AbortError':
      return {
        resumo: 'a captura foi interrompida',
        saida: 'tente de novo',
        definitivo: false,
      };
    default:
      return {
        resumo: 'não consegui abrir o microfone',
        saida: 'tente de novo, ou use o teclado',
        definitivo: false,
      };
  }
}
