'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';

import {
  ErroAnexo,
  enviaAnexo,
  type EspecieAnexo,
  type RespostaAnexo,
} from './anexo.ts';

/**
 * A máquina do anexo. Quatro fases, e cada uma existe porque tem consequência
 * na tela:
 *
 * - `enviando` TRAVA o botão. É a única defesa contra o duplo envio: um vídeo de
 *   100 MB por Tailscale demora, e o segundo toque no mesmo botão mandaria o
 *   arquivo duas vezes ao agente.
 * - `erro` carrega a FRASE do backend, não um código. O `detail` do 422 diz se
 *   foi o tipo ou o tamanho; sem ele o Rica tenta de novo às cegas.
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
export type FaseAnexo =
  | { fase: 'ocioso' }
  | { fase: 'enviando'; nome: string }
  | { fase: 'erro'; nome: string; motivo: string }
  | { fase: 'sucesso'; nome: string; especie: EspecieAnexo };

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
  /** `true` quando o arquivo chegou ao agente — é o sinal para o composer
   *  limpar o campo de texto, que virou legenda. Limpar antes seria perder o
   *  texto num 422 de tamanho. */
  enviar(arquivo: File, caption: string): Promise<boolean>;
  alternarGaveta(): void;
  fecharGaveta(): void;
  limpar(): void;
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

    async enviar(arquivo, caption) {
      // A trava do duplo envio mora aqui e não só no `disabled` do botão: o
      // `disabled` some se o React re-renderizar por outro motivo, e o input
      // de arquivo também dispara `change` por caminhos que não passam pelo
      // clique (arrastar, por exemplo).
      if (descartado || estado.fase === 'enviando') return false;
      limparTimer();
      // A gaveta fecha aqui, e não no clique do item: fechar no clique e só
      // então abrir o picker faria a gaveta piscar de volta se o usuário
      // cancelasse o picker sem escolher nada.
      publicar({ fase: 'enviando', nome: arquivo.name, gaveta: false });
      try {
        const resposta = await subir(agentSlug, arquivo, caption);
        if (descartado) return true;
        publicar({
          fase: 'sucesso',
          nome: arquivo.name,
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
        publicar({ fase: 'erro', nome: arquivo.name, motivo, gaveta: estado.gaveta });
        return false;
      }
    },

    alternarGaveta() {
      // Enquanto sobe, a gaveta não reabre: escolher um segundo arquivo no meio
      // do primeiro envio não tem para onde ir — é um arquivo por vez nesta
      // rodada, e um menu que abre para nada é o botão morto da §9.
      if (descartado || estado.fase === 'enviando') return;
      // Abrir a gaveta APAGA o erro anterior. Ele já foi lido — quem está
      // escolhendo outro arquivo não precisa da recusa do anterior na tela.
      const proximaFase: FaseAnexo = estado.fase === 'erro' ? { fase: 'ocioso' } : estado;
      publicar({ ...proximaFase, gaveta: !estado.gaveta });
    },

    fecharGaveta() {
      if (descartado || !estado.gaveta) return;
      publicar({ ...estado, gaveta: false });
    },

    limpar() {
      limparTimer();
      publicar({ fase: 'ocioso', gaveta: estado.gaveta });
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
  enviar: (arquivo: File, caption: string) => Promise<boolean>;
  alternarGaveta: () => void;
  fecharGaveta: () => void;
  limpar: () => void;
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
    enviar: controle.enviar,
    alternarGaveta: controle.alternarGaveta,
    fecharGaveta: controle.fecharGaveta,
    limpar: controle.limpar,
  };
}
