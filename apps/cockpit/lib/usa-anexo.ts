'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';

import {
  ErroAnexo,
  enviaAnexo,
  validaAnexo,
  type EspecieAnexo,
  type RespostaAnexo,
} from './anexo.ts';

/**
 * A máquina do anexo. Cinco fases, e cada uma existe porque tem consequência
 * na tela:
 *
 * - `escolhido` é o arquivo RETIDO: escolhido, validado e ainda não enviado.
 *   Antes ele não existia — escolher a foto disparava o upload na hora, e o
 *   Rica via o arquivo chegar ao agente sem legenda nenhuma, porque ele nem
 *   tinha tido a chance de escrever. Reter é o que separa o gesto em dois
 *   tempos: escolher e, depois, mandar foto e legenda de uma vez.
 * - `enviando` TRAVA o botão. É a única defesa contra o duplo envio: um vídeo de
 *   50 MB por Tailscale demora, e o segundo toque no mesmo botão mandaria o
 *   arquivo duas vezes ao agente.
 * - `erro` carrega a FRASE do backend, não um código. O `detail` do 422 diz se
 *   foi o tipo ou o tamanho; sem ele o Rica tenta de novo às cegas.
 *
 * O ARQUIVO ATRAVESSA AS FASES INTEIRO. `escolhido`, `enviando` e o `erro` de
 * upload seguram o mesmo `File` — ele muda de fase, nunca evapora. Sem isso, um
 * 422 de tamanho apagaria a foto da tela e o Rica teria de escolhê-la de novo
 * para ler o motivo pelo qual ela não subiu. O único `erro` sem arquivo na mão é
 * o da validação na escolha, onde reter seria guardar uma promessa falsa: aquele
 * arquivo não sobe nem tentando.
 * - `sucesso` some sozinho. Confirmação que fica na tela vira ruído — o arquivo
 *   já aparece no feed, este aviso só cobre o intervalo entre soltar o arquivo
 *   e ele existir por lá.
 *
 * Não é a máquina de seis fases do texto de propósito: ali a pergunta é "o
 * agente RECEBEU?", respondida só pelo eco no stream. Aqui o `POST /file`
 * devolve `tmux_delivered` e o próprio arquivo aparece no feed — não há eco de
 * anexo para casar, e inventar um `nao-confirmado` sem nada que o resolvesse
 * deixaria um estado do qual não se sai.
 */
/** O arquivo em mãos. Fica INTEIRO no estado: a miniatura precisa dele para o
 *  preview e o despacho precisa dele para subir — guardar só o nome obrigaria a
 *  pedir o arquivo de volta ao input, que já foi zerado. */
export type Retido = { arquivo: File; especie: EspecieAnexo };

export type FaseAnexo =
  | { fase: 'ocioso' }
  | ({ fase: 'escolhido' } & Retido)
  | ({ fase: 'enviando' } & Retido)
  /** `retido` é `null` só quando a recusa veio da validação na escolha — ali não
   *  há arquivo enviável para segurar. Vindo de um upload que falhou, o arquivo
   *  continua na mão e o próximo toque em enviar é nova tentativa. */
  | { fase: 'erro'; nome: string; motivo: string; retido: Retido | null }
  | { fase: 'sucesso'; nome: string; especie: EspecieAnexo };

/** O que a miniatura mostra e o que a porta conta como gesto — a pergunta "tem
 *  arquivo na mão?" atravessa três fases e não se responde por uma só. */
export function arquivoRetido(estado: FaseAnexo): Retido | null {
  if (estado.fase === 'escolhido' || estado.fase === 'enviando') {
    return { arquivo: estado.arquivo, especie: estado.especie };
  }
  if (estado.fase === 'erro') return estado.retido;
  return null;
}

/**
 * A gaveta mora no MESMO estado do envio porque as duas coisas se cruzam: a
 * gaveta fecha quando um item é escolhido, e não pode reabrir enquanto um
 * arquivo está subindo. Dois `useState` soltos no componente deixariam essa
 * regra implícita — e implícita ela é a que se perde na próxima edição.
 */
export type EstadoAnexo = FaseAnexo & { gaveta: boolean };

export const estadoInicialAnexo: EstadoAnexo = { fase: 'ocioso', gaveta: false };

/** Quanto o "✓ enviado" fica na tela antes de sumir sozinho. */
export const PRAZO_SUCESSO_MS = 4_000;

type Timer = ReturnType<typeof setTimeout>;

export type DependenciasAnexoControle = {
  subir?: (slug: string, arquivo: File, caption: string) => Promise<RespostaAnexo>;
  agendar?: (callback: () => void, atrasoMs: number) => Timer;
  cancelar?: (timer: Timer) => void;
};

export type ControleAnexo = {
  getEstado(): EstadoAnexo;
  subscribe(ouvinte: () => void): () => void;
  /** Retém o arquivo escolhido, já validado. Não sobe nada — quem sobe é o
   *  `enviar`, no toque do botão. */
  escolher(arquivo: File): void;
  /** Sobe o arquivo que está na mão, com o texto do composer como legenda. Não
   *  recebe o `File` de fora porque quem o guarda é esta máquina — pedi-lo de
   *  volta ao chamador abriria a porta para subir um arquivo diferente do que a
   *  miniatura está mostrando. `true` quando ele chegou ao agente, que é o sinal
   *  para o composer esvaziar o campo. */
  enviar(caption: string): Promise<boolean>;
  alternarGaveta(): void;
  fecharGaveta(): void;
  limpar(): void;
  /** Fecha o recado sem soltar o arquivo — quem dispensa o aviso está dizendo
   *  "li", não "desisti". Desistir é o × da miniatura, que chama `limpar`. */
  dispensarAviso(): void;
  dispose(): void;
};

export function createControleAnexo(
  agentSlug: string,
  dependencias: DependenciasAnexoControle = {},
): ControleAnexo {
  const subir = dependencias.subir ?? ((slug, arquivo, caption) => enviaAnexo(slug, arquivo, caption));
  const agendar = dependencias.agendar ?? setTimeout;
  const cancelar = dependencias.cancelar ?? clearTimeout;

  let estado: EstadoAnexo = estadoInicialAnexo;
  let descartado = false;
  let timerSucesso: Timer | undefined;
  const ouvintes = new Set<() => void>();

  function publicar(proximo: EstadoAnexo): void {
    if (descartado) return;
    estado = proximo;
    for (const ouvinte of ouvintes) ouvinte();
  }

  function limparTimer(): void {
    if (timerSucesso === undefined) return;
    cancelar(timerSucesso);
    timerSucesso = undefined;
  }

  return {
    getEstado: () => estado,
    subscribe(ouvinte) {
      ouvintes.add(ouvinte);
      return () => ouvintes.delete(ouvinte);
    },

    escolher(arquivo) {
      // Mesma trava do `enviar`, e pelo mesmo motivo: com um arquivo em voo não
      // há para onde mandar o segundo.
      if (descartado || estado.fase === 'enviando') return;
      limparTimer();
      // A validação passou a rodar AQUI, e não só dentro do `enviaAnexo`. Reter
      // um arquivo que o servidor vai recusar é guardar uma promessa falsa na
      // tela: o Rica anexaria o vídeo de 60 MB, escreveria a legenda e só então
      // levaria o não. O `enviaAnexo` continua validando na fronteira dele —
      // esta é uma segunda porta, não a mudança de lugar da primeira.
      const veredito = validaAnexo(arquivo);
      // A gaveta fecha nos dois desfechos, e fecha AQUI e não no clique do item
      // (ver a nota do `enviar`): quem cancelou o picker sem escolher nada
      // continua com a gaveta aberta, que é onde ele estava.
      if (!veredito.ok) {
        // `retido: null` — este arquivo não sobe nem tentando, e guardá-lo seria
        // deixar na tela uma foto com botão de enviar que só sabe recusar.
        publicar({
          fase: 'erro',
          nome: arquivo.name,
          motivo: veredito.motivo,
          retido: null,
          gaveta: false,
        });
        return;
      }
      publicar({ fase: 'escolhido', arquivo, especie: veredito.especie, gaveta: false });
    },

    async enviar(caption) {
      // A trava do duplo envio mora aqui e não só no `disabled` do botão: o
      // `disabled` some se o React re-renderizar por outro motivo, e o input
      // de arquivo também dispara `change` por caminhos que não passam pelo
      // clique (arrastar, por exemplo). Ela é MUDA de propósito — quem responde
      // ao toque do Rica é a porta (`anexo-em-voo`), que roda antes daqui.
      if (descartado || estado.fase === 'enviando') return false;
      const retido = arquivoRetido(estado);
      // Sem arquivo na mão não há o que mandar. Não é recusa a explicar: é
      // chamada que não devia existir, porque quem pergunta se existe gesto é a
      // porta, no composer.
      if (!retido) return false;
      limparTimer();
      publicar({ fase: 'enviando', ...retido, gaveta: false });
      try {
        const resposta = await subir(agentSlug, retido.arquivo, caption);
        if (descartado) return true;
        publicar({
          fase: 'sucesso',
          nome: retido.arquivo.name,
          especie: resposta.kind,
          gaveta: estado.gaveta,
        });
        timerSucesso = agendar(() => {
          timerSucesso = undefined;
          if (estado.fase === 'sucesso') publicar({ fase: 'ocioso', gaveta: estado.gaveta });
        }, PRAZO_SUCESSO_MS);
        return true;
      } catch (erro) {
        if (descartado) return false;
        // `ErroAnexo` já vem com a frase pronta (do `detail` do backend ou da
        // validação local). Qualquer outra coisa é bug nosso, e mesmo aí a tela
        // recebe a mensagem crua em vez de um "falhou" mudo.
        const motivo =
          erro instanceof ErroAnexo
            ? erro.message
            : erro instanceof Error && erro.message
              ? erro.message
              : 'Não foi possível enviar o arquivo.';
        // O ARQUIVO NÃO EVAPORA NO ERRO. Ele volta para a mão com o recado ao
        // lado: a miniatura continua na tela e o próximo toque em enviar é uma
        // nova tentativa, com a mesma foto e a mesma legenda. Soltá-lo aqui
        // cobraria duas vezes pelo mesmo 422 — escolher o arquivo de novo só
        // para ler por que ele não subiu.
        publicar({ fase: 'erro', nome: retido.arquivo.name, motivo, retido, gaveta: estado.gaveta });
        return false;
      }
    },

    alternarGaveta() {
      // Enquanto sobe, a gaveta não reabre: escolher um segundo arquivo no meio
      // do primeiro envio não tem para onde ir — é um arquivo por vez nesta
      // rodada, e um menu que abre para nada é o botão morto da §9.
      if (descartado || estado.fase === 'enviando') return;
      // Abrir a gaveta APAGA o erro anterior. Ele já foi lido — quem está
      // escolhendo outro arquivo não precisa da recusa do anterior na tela. O
      // que não se apaga é o ARQUIVO: quem abriu a gaveta e desistiu no picker
      // volta com a foto ainda na mão, não com o composer vazio.
      const proximaFase: FaseAnexo =
        estado.fase !== 'erro'
          ? estado
          : estado.retido
            ? { fase: 'escolhido', ...estado.retido }
            : { fase: 'ocioso' };
      publicar({ ...proximaFase, gaveta: !estado.gaveta });
    },

    fecharGaveta() {
      if (descartado || !estado.gaveta) return;
      publicar({ ...estado, gaveta: false });
    },

    /** Solta o que estiver na mão — o aviso de erro já lido e, agora, o arquivo
     *  retido. Sem esta saída, escolher a foto errada seria um beco. */
    limpar() {
      limparTimer();
      publicar({ fase: 'ocioso', gaveta: estado.gaveta });
    },

    dispensarAviso() {
      if (descartado || estado.fase !== 'erro') return;
      limparTimer();
      const retido = estado.retido;
      publicar(
        retido
          ? { fase: 'escolhido', ...retido, gaveta: estado.gaveta }
          : { fase: 'ocioso', gaveta: estado.gaveta },
      );
    },

    dispose() {
      if (descartado) return;
      descartado = true;
      limparTimer();
      ouvintes.clear();
    },
  };
}

export function usaAnexo(agentSlug: string): {
  estado: EstadoAnexo;
  escolher: (arquivo: File) => void;
  enviar: (caption: string) => Promise<boolean>;
  alternarGaveta: () => void;
  fecharGaveta: () => void;
  limpar: () => void;
  dispensarAviso: () => void;
} {
  const controle = useMemo(() => createControleAnexo(agentSlug), [agentSlug]);
  const estado = useSyncExternalStore(
    controle.subscribe,
    controle.getEstado,
    controle.getEstado,
  );

  useEffect(() => {
    return () => controle.dispose();
  }, [controle]);

  return {
    estado,
    escolher: controle.escolher,
    enviar: controle.enviar,
    alternarGaveta: controle.alternarGaveta,
    fecharGaveta: controle.fecharGaveta,
    limpar: controle.limpar,
    dispensarAviso: controle.dispensarAviso,
  };
}
