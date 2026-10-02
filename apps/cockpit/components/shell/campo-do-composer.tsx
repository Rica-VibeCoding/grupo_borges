'use client';

/**
 * O campo de escrever: a bolha de `/comandos` e o `textarea` com o que ele faz
 * com tecla, colagem e acentuação. Saiu de `composer.tsx` (02/10) inteiro; a
 * altura e o foco seguem com o composer, que é o dono do `textareaRef`.
 */
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { motion } from 'motion/react';
import type { Retido } from '../../lib/fase-do-anexo';
import type { usaAnexo } from '../../lib/usa-anexo';
import type { OrigemRascunho } from '../../lib/usa-rascunho';
import { BolhaDeComandos } from './bolha-de-comandos';
import { emCaptura, type ModoDaFala } from './modo-da-fala';
import { TROCA_DE_FILEIRA } from './troca-de-fileira';
import { origemDepoisDaEdicao } from './voz';

export type CampoDoComposerProps = {
  agentSlug: string;
  agentName: string;
  texto: string;
  setTexto: Dispatch<SetStateAction<string>>;
  setOrigemDoRascunho: Dispatch<SetStateAction<OrigemRascunho>>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  substituicaoIntegralRef: RefObject<boolean>;
  formaDaCaixa: string;
  modo: ModoDaFala;
  anexo: ReturnType<typeof usaAnexo>;
  tecladoTouch: boolean;
  retidoAnexo: Retido | null;
  enviar: (corpo: string) => Promise<boolean>;
  travaCompact: boolean;
};

export function CampoDoComposer({
  agentSlug, agentName, texto, setTexto, setOrigemDoRascunho, textareaRef,
  substituicaoIntegralRef, formaDaCaixa, modo, anexo, tecladoTouch, retidoAnexo, enviar,
  travaCompact,
}: CampoDoComposerProps) {
  // Mesma condição que decide `aberta` dentro de `BolhaDeComandos` — duplicada
  // aqui porque o Popover vive num Portal (subárvore separada do textarea) e
  // nunca recebe o Enter que o campo despacha. Sem este espelho, digitar `/`
  // e apertar Enter mandava o `/` sozinho como mensagem pro agente.
  const bolhaComandosAberta = texto === '/';

  return (
    <BolhaDeComandos
      agentSlug={agentSlug}
      texto={texto}
      aoSelecionar={(valor) => {
        setTexto(valor);
        setOrigemDoRascunho('text');
      }}
      campoRef={textareaRef}
    >
      <motion.textarea
          layout="position"
          layoutDependency={formaDaCaixa}
          transition={{ layout: TROCA_DE_FILEIRA }}
          ref={textareaRef}
          // UMA LINHA que cresce digitando — ordem do Rica em 08/08, olhando a
          // referência: "queria que o input de texto tivesse uma linha só,
          // igual a do CC, e não duas linhas … conforme eu vou digitando e
          // pulando linha, ela vai aumentando na altura". Revoga a §12 do histórico da
          // estética, que mandava caixa alta; os controles continuam dentro.
          rows={1}
          value={texto}
          // SEM `disabled`, de propósito. A doc do React descreve `disabled`
          // como "will not be interactive and will appear dimmed": o elemento
          // sai do alcance do foco, e no iPhone isso fecha o teclado no meio
          // da digitação. Quem bloqueia é a PORTA, no submit — o campo segue
          // editável, ele escreve durante a espera e manda com um toque quando
          // ela passa. É o que garante que o texto nunca evapora.
          readOnly={emCaptura(modo)}
          onChange={(e) => {
            setTexto(e.target.value);
            setOrigemDoRascunho((atual) =>
              origemDepoisDaEdicao(
                atual,
                e.target.value,
                substituicaoIntegralRef.current,
              ),
            );
            substituicaoIntegralRef.current = false;
          }}
          onBeforeInput={(e) => {
            const campo = e.currentTarget;
            substituicaoIntegralRef.current =
              campo.selectionStart === 0 && campo.selectionEnd === campo.value.length;
          }}
          // COLAR IMAGEM. No iPhone, "copiar" numa foto e colar no campo é
          // o gesto natural — e até 15/08 não fazia nada, nem erro: o
          // clipboard trazia o arquivo e ninguém o pegava. Cai na MESMA
          // máquina do botão de anexar, então a foto vira miniatura com o
          // controle de remover e quem decide se ela parte continua sendo a
          // porta. Print de tela chega sem nome; o `File` do clipboard já
          // vem com um sintético do navegador, e a máquina de anexo lida
          // com isso desde sempre.
          onPaste={(e) => {
            const arquivo = [...e.clipboardData.items]
              .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
              ?.getAsFile();
            if (!arquivo) return; // texto colado segue o caminho normal
            e.preventDefault();
            anexo.escolher(arquivo);
          }}
          // Com ANEXO na mão o Enter volta a enviar no touch. A quebra de linha
          // ficou pro texto puro, mas sem o envio a foto era um beco: o Shift
          // não existe no teclado virtual, e o "manda e não sai" do reporte de
          // 08/08 era o Enter virando newline com a foto retida — o único
          // gesto de enviar que o Rica tinha ali. `enterKeyHint` troca a tecla
          // do teclado virtual pra "Enviar" exatamente nesse caso, pra o toque
          // não parecer morto.
          enterKeyHint={tecladoTouch && retidoAnexo !== null ? 'send' : undefined}
          onKeyDown={(e) => {
            // A ACENTUAÇÃO não pode virar envio. Segurar a tecla no iPhone
            // para escolher "ã"/"ç" — ou usar tecla morta no teclado físico
            // — abre uma sessão de composição, e o Enter que confirma a
            // escolha chega aqui como um Enter comum. Sem guarda, escrever
            // "não" ou "ação" despacha a mensagem no meio da palavra; em
            // português isso não é caso de borda, é quase toda frase.
            //
            // O TESTE É DUPLO, e a segunda metade não é redundância: a MDN
            // é explícita em que `isComposing` vale `false` no PRIMEIRO e no
            // ÚLTIMO caractere da composição — "compositionstart may fire
            // after keydown… In these cases, isComposing is false even when
            // the event is part of composition". A receita publicada lá é
            // literalmente `if (event.isComposing || event.keyCode === 229)
            // return;`, e o 229 é normativo: o W3C UI Events (§7.2.1) manda
            // "If an Input Method Editor is processing key input and the
            // event is keydown, return 229". Minha primeira versão checava
            // só `isComposing` e deixava passar exatamente as duas bordas.
            const compondo = e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229;
            if (
              e.key === 'Enter' &&
              !compondo &&
              !e.shiftKey &&
              (!tecladoTouch || retidoAnexo !== null)
            ) {
              e.preventDefault();
              // Bolha aberta: Enter não é "enviar `/`", é ainda estar
              // escolhendo. Sem esta guarda o único jeito de sair do
              // gesto de digitar `/` e apertar Enter era mandar um `/`
              // sozinho pro agente.
              if (bolhaComandosAberta) return;
              enviar(texto);
            }
          }}
          // "aguarde" era a mesma promessa vazia da faixa: dizia para esperar
          // sem dizer o que aconteceria com o que ele escrevesse. Agora entra
          // na fila e sai sozinha, e o campo diz isso antes do primeiro Enter.
          aria-label={`Mensagem para ${agentName}`}
          placeholder={
            emCaptura(modo)
              ? 'Ouvindo…'
              : travaCompact
                ? 'compactando… pode escrever, entra na fila'
                : undefined
          }
          className="ck-campo leading-body min-w-0 resize-none bg-transparent outline-none"
          style={{
            fontSize: 'var(--ck-text-md)', // 16px: piso do iOS contra zoom no foco
            // Teto para o crescimento: passando disto o composer comeria a
            // conversa. Rolagem interna assume, que é o que o CC faz.
            maxHeight: 'var(--ck-h-campo-max)',
          }}
      />
    </BolhaDeComandos>
  );
}
