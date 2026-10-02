'use client';

/**
 * A recusa da porta: o gesto que não saiu, o botão que sacode e o aviso que só
 * vale enquanto o motivo valer. Saiu de `composer.tsx` (02/10); quem recusa
 * continua sendo o `enviar` de lá, pelo `setRecusa` que sai daqui.
 */
import { useState } from 'react';
import type { FaseEnvio } from '../../lib/envio';
import type { Retido } from '../../lib/fase-do-anexo';
import { type MotivoRecusa, recusaPersiste } from './porta-de-envio';

export function usaRecusaDaPorta({
  texto,
  retidoAnexo,
  anexoEmVoo,
  gerando,
  motorEnfileiraSozinho,
  travaCompact,
  faseLocal,
}: {
  texto: string;
  retidoAnexo: Retido | null;
  anexoEmVoo: boolean;
  gerando: boolean;
  motorEnfileiraSozinho: boolean;
  travaCompact: boolean;
  faseLocal: FaseEnvio;
}) {
  // Por que a recusa não foi despachada. Não tem botão de dispensar de
  // propósito: ela descreve um impedimento do INSTANTE, não um erro a ser
  // reconhecido — quando o motivo passa, o aviso vai junto.
  //
  // O que fica guardado é o GESTO recusado — motivo e recado, como nasceram.
  // Se ele ainda descreve o instante é pergunta de render, logo abaixo.
  const [recusa, setRecusa] = useState<{ motivo: MotivoRecusa; aviso: string } | null>(null);
  // O SINAL DE RECUSA. A porta recusou um toque com recado — o botão de enviar
  // sacode pra o Rica sentir o "não" mesmo quando o aviso da faixa fica
  // escondido atrás do teclado do iPhone. Estado e não classe persistente:
  // `onAnimationEnd` limpa, então o próximo toque recusado re-sacode.
  const [sinalRecusa, setSinalRecusa] = useState(false);
  // O AVISO É CALCULADO, não guardado. Aviso que sobrevive ao motivo vira
  // mentira na tela, e até 20/08 quem o apagava era um efeito que listava
  // quatro impedimentos à mão. A lista tinha buraco: `longo-demais` não estava
  // nela e nenhuma daquelas quatro flags muda quando o Rica apaga texto, então
  // o "texto longo demais" ficava preso com o campo já curto.
  //
  // Agora a pergunta é refeita à mesma porta, com as condições de agora. Não há
  // lista para manter em dia, e o efeito — que a documentação nomeia como
  // anti-padrão (`react.dev/learn/you-might-not-need-an-effect`, "Adjusting
  // state on prop change in an Effect") — deixa de existir.
  const avisoDaPorta =
    recusa &&
    recusaPersiste(recusa.motivo, {
      texto,
      temAnexo: retidoAnexo !== null,
      anexoEmVoo,
      turnoEmVoo: gerando,
      motorEnfileiraSozinho,
      compactando: travaCompact,
      faseEnvio: faseLocal,
    })
      ? recusa.aviso
      : null;

  return { setRecusa, sinalRecusa, setSinalRecusa, avisoDaPorta };
}
