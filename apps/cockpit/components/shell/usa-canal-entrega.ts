'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchAgentPainel, postAgentDestrava } from '@grupo_borges/cockpit-core/api';

import { leCanalBloqueado, type CanalBloqueado } from './canal-entrega.ts';

/**
 * Pergunta ao back POR QUE o envio não fechou, e só quando não fechou.
 *
 * A consulta é sob demanda de propósito: o `/painel` só é chamado quando a
 * máquina de envio para num dos dois estados de insucesso. Poll periódico
 * gastaria uma requisição por agente aberto para responder uma pergunta que,
 * no caminho normal, ninguém faz.
 *
 * ── O ESQUECIMENTO DEPOIS DO DESTRAVA ────────────────────────────────────
 *
 * `recover_input` (o que o `POST /{slug}/destrava` executa) **não** limpa o
 * `_DELIVERY_CHANNEL_RECORDS` do driver — conferido em `tmux_driver.py:1875`.
 * O `canal_entrega` do `/painel` descreve a última TENTATIVA DE ENTREGA, e
 * destravar não é uma; então o back continua respondendo `bloqueado` até
 * alguém mandar a próxima mensagem.
 *
 * Reconsultar depois do destrava, portanto, devolveria o mesmo bloqueio e a
 * faixa seguiria dizendo "não entrou" sobre um canal que já foi aberto — a
 * mentira de UI da §9 da estética, e das piores, porque seria a tela
 * desmentindo um gesto que a própria tela pediu.
 *
 * Por isso o esquecimento é LOCAL: destrava confirmado (`tmux_delivered`)
 * apaga o bloqueio daqui, a faixa volta ao texto genérico e o botão volta a
 * ser "mandar de novo", que é exatamente o próximo passo. Destrava que não se
 * confirmou não apaga nada — o `200` do endpoint não é sucesso, e o front que
 * tratasse como sucesso estaria inventando a mesma prova que a máquina de
 * envio inteira existe para não inventar.
 *
 * ── E O DESTRAVA QUE NÃO RESOLVE FALA ────────────────────────────────────
 *
 * Medido no canário em 05/08: com texto humano armado no terminal, o
 * `/destrava` devolve `tmux_delivered: false`, `acao:
 * "texto_armado_nao_recuperavel"` — a guarda que protege o que a pessoa
 * digitou impede que ele resolva. E `input_ocupado_ou_travado` é justamente o
 * motivo mais comum de bloqueio, então esse é o caminho FREQUENTE, não a
 * borda: sem `destravaFalhou`, o botão seria tocado e não responderia nada
 * exatamente onde é mais tocado. Recusa com gesto na mão sempre tem recado —
 * é a mesma regra da porta de envio.
 */
export function usaCanalEntrega(
  agentSlug: string,
  perguntar: boolean,
): {
  canalBloqueado: CanalBloqueado | null;
  destravaFalhou: boolean;
  destravar: () => Promise<void>;
} {
  const [canalBloqueado, setCanalBloqueado] = useState<CanalBloqueado | null>(null);
  const [destravaFalhou, setDestravaFalhou] = useState(false);

  useEffect(() => {
    if (!perguntar) {
      // Sair do insucesso zera o diagnóstico. Bloqueio que sobrevive ao motivo
      // é a mesma mentira do aviso pendurado que o `d6b1a46` fechou.
      setCanalBloqueado(null);
      setDestravaFalhou(false);
      return;
    }
    // `ignorar` em vez de `AbortSignal`: a resposta abortada e a obsoleta
    // pedem o mesmo tratamento — não escrever — e o flag cobre também o caso
    // de o componente desmontar com a promessa em voo.
    let ignorar = false;
    void (async () => {
      try {
        const painel = await fetchAgentPainel(agentSlug);
        if (!ignorar) setCanalBloqueado(leCanalBloqueado(painel));
      } catch {
        // Consulta que falha não vira aviso próprio: a faixa genérica já está
        // na tela dizendo a verdade menor, e dois erros na mesma linha por um
        // envio só é ruído. Fica o que já estava escrito.
      }
    })();
    return () => {
      ignorar = true;
    };
  }, [agentSlug, perguntar]);

  const destravar = useCallback(async () => {
    try {
      const { tmux_delivered } = await postAgentDestrava(agentSlug);
      setDestravaFalhou(!tmux_delivered);
      if (tmux_delivered) setCanalBloqueado(null);
    } catch {
      // Rede caiu ou o endpoint recusou: do ponto de vista do Rica é a mesma
      // coisa — ele tocou e não resolveu. O silêncio aqui é que seria mentira.
      setDestravaFalhou(true);
    }
  }, [agentSlug]);

  return { canalBloqueado, destravaFalhou, destravar };
}
