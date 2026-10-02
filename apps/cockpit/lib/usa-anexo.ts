'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';

import {
  ErroAnexo,
  enviaAnexo,
  validaAnexo,
  type RespostaAnexo,
} from './anexo.ts';
import {
  arquivoRetido,
  estadoInicialAnexo,
  type EstadoAnexo,
  type FaseAnexo,
} from './fase-do-anexo.ts';

/* As cinco fases da máquina, o arquivo retido e a gaveta no mesmo estado
 * moram em `fase-do-anexo.ts`, sem React — reexportadas daqui. Este arquivo é o
 * controle que move o estado entre elas e o hook que o pendura no composer. */
export {
  arquivoRetido,
  estadoInicialAnexo,
  type EstadoAnexo,
  type FaseAnexo,
  type Retido,
} from './fase-do-anexo.ts';

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
   *  miniatura está mostrando. `true` quando ele saiu da mão — entregue ou não
   *  confirmado —, que é o sinal para o composer NÃO devolver a legenda. O não
   *  confirmado avisa por `aoNaoConfirmar`, com a resposta quando ela veio. */
  enviar(
    caption: string,
    aoEntregar?: (resposta: RespostaAnexo) => void,
    aoNaoConfirmar?: (resposta: RespostaAnexo | null) => void,
  ): Promise<boolean>;
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

    async enviar(caption, aoEntregar, aoNaoConfirmar) {
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
        // A confirmação vem ANTES da guarda de descarte: trocar de agente no meio
        // do upload desmonta este controle, mas a bolha otimista mora num store
        // de módulo e só sai quando souber o nome gravado no servidor. Sem isso
        // ela ficava em "enviando…" ao lado da real até recarregar a página.
        aoEntregar?.(resposta);
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
        // Incerto não é falha: a bolha fica (quem a resolve é o chamador, mesmo
        // com o controle descartado — ela mora num store de módulo) e o arquivo
        // não volta, porque reenviá-lo duplicaria a entrega.
        if (erro instanceof ErroAnexo && erro.incerto) {
          aoNaoConfirmar?.(erro.resposta);
          if (descartado) return true;
          publicar({
            fase: 'nao-confirmado',
            nome: retido.arquivo.name,
            motivo: erro.message,
            gaveta: estado.gaveta,
          });
          return true;
        }
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
        estado.fase === 'nao-confirmado'
          ? { fase: 'ocioso' }
          : estado.fase !== 'erro'
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
      if (descartado) return;
      if (estado.fase === 'nao-confirmado') {
        publicar({ fase: 'ocioso', gaveta: estado.gaveta });
        return;
      }
      if (estado.fase !== 'erro') return;
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
  enviar: ControleAnexo['enviar'];
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
