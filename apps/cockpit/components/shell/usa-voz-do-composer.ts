'use client';

/**
 * A voz do composer: a transcrição, a fala ao vivo, o gravador e o modo da fala
 * que a caixa desenha. Saiu de `composer.tsx` (02/10) com os comentários; o que
 * a voz escreve cai no mesmo rascunho do campo.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { OrigemRascunho } from '../../lib/usa-rascunho';
import { modoDaFala } from './modo-da-fala';
import { usaFalaAoVivo } from './usa-fala-ao-vivo';
import { usaGravador } from './usa-gravador';
import {
  aparenciaDaVoz,
  diagnosticaTranscricao,
  mesclaTranscricao,
  type Impedimento,
} from './voz';

export function usaVozDoComposer({
  agentSlug,
  agentName,
  texto,
  setTexto,
  setOrigemDoRascunho,
  setRecusa,
  textareaRef,
}: {
  agentSlug: string;
  agentName: string;
  texto: string;
  setTexto: Dispatch<SetStateAction<string>>;
  setOrigemDoRascunho: Dispatch<SetStateAction<OrigemRascunho>>;
  setRecusa: (recusa: null) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  // ---- voz ----------------------------------------------------------------
  const [falhaDaFala, setFalhaDaFala] = useState<Impedimento | null>(null);

  const subirAudio = useCallback(
    async (audio: Blob) => {
      setRecusa(null);
      setFalhaDaFala(null);
      try {
        const { postAgentTranscription } = await import('@grupo_borges/cockpit-core/api');
        const { text: falado } = await postAgentTranscription(agentSlug, audio);
        setTexto((atual) => mesclaTranscricao(atual, falado));
        setOrigemDoRascunho('stt');
        requestAnimationFrame(() => {
          const campo = textareaRef.current;
          if (!campo) return;
          campo.focus();
          campo.setSelectionRange(campo.value.length, campo.value.length);
        });
      } catch (erro) {
        setFalhaDaFala(diagnosticaTranscricao(erro));
      }
    },
    [agentSlug, setOrigemDoRascunho, setTexto],
  );

  // ---- fala ao vivo (F3) ---------------------------------------------------
  // O texto chega palavra por palavra e é REMONTADO a cada pedaço a partir do
  // que já estava escrito. Remontar da base em vez de ir acrescentando é o que
  // deixa o final (que vem revisado, com pontuação) simplesmente substituir o
  // provisório, sem sobra na tela e sem diff de texto.
  const baseDaFalaRef = useRef('');
  const textoRef = useRef(texto);
  useEffect(() => {
    textoRef.current = texto;
  }, [texto]);

  const aoComecarFala = useCallback(() => {
    baseDaFalaRef.current = textoRef.current;
  }, []);

  const aoTextoAoVivo = useCallback(
    (falado: string) => {
      setRecusa(null);
      setFalhaDaFala(null);
      setTexto(mesclaTranscricao(baseDaFalaRef.current, falado));
      setOrigemDoRascunho('stt');
    },
    [setOrigemDoRascunho, setTexto],
  );

  const falaAoVivo = usaFalaAoVivo({
    agentSlug,
    aoComecar: aoComecarFala,
    aoTexto: aoTextoAoVivo,
  });

  const gravador = usaGravador({ aoGravar: subirAudio, aoVivo: falaAoVivo });
  const faseVoz = gravador.fase;
  const segundosVoz = gravador.segundos;
  const vozAparencia = aparenciaDaVoz(faseVoz, {
    segundos: segundosVoz,
    nome: agentName,
    impedimento: gravador.impedimento ?? undefined,
  });
  const niveisVoz = gravador.niveis;
  // Dois problemas, uma linha só: microfone que não abre e transcrição que não
  // veio. São momentos diferentes do mesmo gesto e nunca coexistem — dar duas
  // faixas de aviso ensinaria dois lugares para olhar quando a fala falha.
  const avisoDaVoz =
    faseVoz === 'impedida'
      ? gravador.impedimento ?? null
      : falhaDaFala;

  // O MODO DA FALA — um valor calculado, em vez dos cinco predicados que o JSX
  // recombinava à mão em dez pontos. Equivalente exato ao que os ternários
  // montavam: `emCaptura(modo)` = `capturando(faseVoz)`, e `modo === 'travada'`
  // = `faseVoz === 'travada'`.
  //
  // Só a fala: `compactando` e `enviando` CONVIVEM com o microfone aberto, e
  // enum é para estado que se exclui — eles seguem em eixo próprio, com as
  // funções de aparência que o repo já usa. `gerando` fica de fora em qualquer
  // hipótese: é estado do AGENTE e mora na linha da bolinha.
  const modo = modoDaFala({ faseVoz, falaFalhou: avisoDaVoz !== null });
  // O ÚNICO recado da voz que ainda se vê. Gravação travada passando de 20s é
  // o teto de 30s do STT chegando: a moldura vira âmbar, e cor sem motivo
  // escrito é enfeite. O resto do que `aparenciaDaVoz` diz virou narração de
  // fase e não aparece mais — ver a linha da voz, abaixo.
  const avisoDoTetoDoStt = modo === 'travada' && vozAparencia.longa;

  return {
    setFalhaDaFala,
    gravador,
    faseVoz,
    vozAparencia,
    niveisVoz,
    avisoDaVoz,
    modo,
    avisoDoTetoDoStt,
  };
}
