'use client';

/**
 * A base da caixa: o `+` (ou o descartar do áudio travado), a troca entre a
 * onda e o seletor do motor, e os slots. Saiu de `composer.tsx` (02/10) com os
 * comentários; os slots moram em `slots-da-base.tsx`.
 */
import type { RefObject } from 'react';
import { motion } from 'motion/react';
import type { usaAnexo } from '../../lib/usa-anexo';
import { BotaoAnexo } from './gaveta-anexo';
import { IconeDescartar } from './icones';
import { emCaptura, type ModoDaFala } from './modo-da-fala';
import { type Motor } from './motor';
import { SeletorMotor } from './seletor-motor';
import { SlotDaConversa, SlotDeDespacho, SlotDeEntrada, SlotDeEstado } from './slots-da-base';
import { TROCA_DE_FILEIRA } from './troca-de-fileira';
import type { Gravador } from './usa-gravador';
import type { AparenciaVoz, FaseVoz } from './voz';

function OndaCompacta({ niveis, tinta }: { niveis: number[]; tinta: string }) {
  return (
    <div
      aria-hidden
      className="flex min-w-0 flex-1 items-center justify-end overflow-hidden"
      style={{ gap: '3px', height: '24px' }}
    >
      {niveis.map((nivel, indice) => (
        <span
          key={indice}
          style={{
            width: '2px',
            flex: '0 0 2px',
            height: `${Math.max(2, Math.round((nivel / 100) * 20))}px`,
            borderRadius: '1px',
            background: tinta,
            opacity: 0.45 + (nivel / 100) * 0.55,
          }}
        />
      ))}
    </div>
  );
}

export type BaseDaCaixaProps = {
  agentSlug: string;
  agentName: string;
  motor: Motor;
  esforcoCobrePedido: boolean;
  formaDaCaixa: string;
  modo: ModoDaFala;
  gravador: Gravador;
  faseVoz: FaseVoz;
  vozAparencia: AparenciaVoz;
  niveisVoz: number[];
  anexo: ReturnType<typeof usaAnexo>;
  botaoAnexoRef: RefObject<HTMLButtonElement | null>;
  travaCompact: boolean;
  temConteudo: boolean;
  despachoEmCena: boolean;
  sinalRecusa: boolean;
  setSinalRecusa: (sinal: boolean) => void;
  pararEmCena: boolean;
  parando: boolean;
  interromper: () => Promise<void>;
};

export function BaseDaCaixa({
  agentSlug, agentName, motor, esforcoCobrePedido, formaDaCaixa, modo, gravador, faseVoz,
  vozAparencia, niveisVoz, anexo, botaoAnexoRef, travaCompact, temConteudo, despachoEmCena,
  sinalRecusa, setSinalRecusa, pararEmCena, parando, interromper,
}: BaseDaCaixaProps) {
  return (
    /* Base do composer: os controles moram AQUI, dentro da caixa — estética §8.
        O piso é a altura que a fileira de botões produz de fato: alvo de
        44px menos os 4px com que `MARGEM_INFERIOR_DA_BASE` encosta os
        controles na linha do texto. Com o piso 4px abaixo disso a linha
        encolhia toda vez que a onda entrava no lugar dos botões — a caixa
        perdia 4px na captura e a conversa andava junto. */
    <div
      className="ck-base-da-caixa flex items-end justify-between"
      style={{
        gap: 'var(--ck-space-2)',
        minHeight: 'calc(var(--ck-touch-min) - var(--ck-space-1))',
      }}
    >
      {modo === 'travada' ? (
        <button
          type="button"
          onClick={gravador.descartarTravada}
          aria-label="Descartar áudio"
          className="ck-veil flex shrink-0 items-center"
          style={{
            gap: '5px',
            minHeight: 'var(--ck-touch-min)',
            padding: '0 var(--ck-space-2)',
            marginLeft: 'calc(var(--ck-space-2) * -1)',
            marginBottom: 'calc(var(--ck-space-2) * -1)',
            borderRadius: 'var(--ck-radius-chip)',
            fontSize: 'var(--ck-text-sm)',
            color: 'var(--ck-text-secondary)',
          }}
        >
          <IconeDescartar tamanho={15} />
          Descartar
        </button>
      ) : emCaptura(modo) ? null : (
        <BotaoAnexo
          dependenciaDeLayout={formaDaCaixa}
          estado={anexo.estado}
          alternarGaveta={anexo.alternarGaveta}
          // `emAndamento` SAIU daqui (15/08). Abrir a gaveta e escolher um
          // arquivo é gesto LOCAL: nada sobe, o arquivo fica retido na
          // miniatura e quem decide se ele pode partir continua sendo a
          // porta, no toque de enviar. Desabilitar por causa do envio
          // ANTERIOR fazia o `+` morrer nos segundos em que o Rica mais o
          // usa — enquanto lê a resposta e quer mandar a foto do assunto —
          // e botão morto não responde nem diz por quê, que é o defeito da
          // §9 que este composer inteiro existe para não cometer. É a mesma
          // razão pela qual o botão de ENVIAR fica habilitado mesmo quando
          // a porta vai recusar.
          desabilitado={travaCompact}
          botaoRef={botaoAnexoRef}
        />
      )}

      <div
        // Sem despacho em cena o botão de enviar sai pela borda e não
        // guarda lugar (Rica, 20/08: *"parecendo uma boca com um dente a
        // menos"*). Regra em `.ck-fileira-acoes`; o movimento é da Motion.
        className="ck-fileira-acoes flex min-w-0 flex-1 items-center justify-end"
        data-despacho={despachoEmCena ? 'em-cena' : 'oculto'}
      >
        {/* A Motion anima ESTE grupo, não a fileira: a fileira muda de
            largura na troca (inteira com texto, só o conteúdo vazia), e a
            Motion anda pelo canto esquerdo — com os botões encostados à
            direita, eles iam primeiro para o lado errado e voltavam (a
            "tremidinha" do vídeo do Rica, 30/09). O grupo tem a mesma
            largura nos dois modos, então só a posição anda. */}
        <motion.div
          layout="position"
          layoutDependency={formaDaCaixa}
          transition={{ layout: TROCA_DE_FILEIRA }}
          className="flex min-w-0 items-center justify-end"
          style={{ gap: 'var(--ck-space-3)' }}
        >
        {/* A TROCA DA FALA. Rica, 20/08, no mesmo vídeo: *"a transição
            entre uma coisa e outra tem que respeitar um certo slow, que é
            o que a gente tem na hora que a gente abre o painel, senão fica
            duro"*. A onda entrava e saía de estalo porque isto era um
            ternário — e saída não se anima com o elemento sendo REMOVIDO
            do DOM, que é a regra que fez a gaveta virar `data-aberto` em
            vez de desmontar.

            Agora os dois lados ficam montados, empilhados na mesma célula
            de grade, e quem troca é o `data-onda`. A fileira não muda de
            largura nem de altura na passagem, quem anima é só `opacity`
            (§9.4), e fora de cena é `visibility` — não pinta, não recebe
            toque, não entra em leitor de tela. Regra em
            `.ck-troca-da-fala`. */}
        <div
          className="ck-troca-da-fala"
          data-onda={emCaptura(modo) ? 'true' : 'false'}
        >
          <div className="ck-troca-da-fala-face" data-face="onda">
            <OndaCompacta
              niveis={niveisVoz}
              tinta={vozAparencia.tinta ?? 'var(--ck-state-running)'}
            />
          </div>
          <div className="ck-troca-da-fala-face" data-face="acoes">
            <SeletorMotor
              agentSlug={agentSlug}
              agentName={agentName}
              motor={motor}
              esforcoCobrePedido={esforcoCobrePedido}
            />
          </div>
        </div>
        {/* TRÊS SLOTS, UM ASSUNTO CADA. Até 20/08 havia um só, com quatro
            donos em cascata, e a cascata é que produzia os becos: o ■ comeu
            o microfone de madrugada (`678f598`), e antes disso o microfone
            tinha comido o envio (15/08). Cada conserto empurrava o defeito
            para o vizinho porque o lugar era um e os assuntos, três.

            Agora a posição na árvore é a identidade — a documentação
            oferece as duas formas de separar estado, `key` explícita ou
            posições diferentes, e esta fase escolhe a segunda
            (`react.dev/learn/preserving-and-resetting-state`). A `key` de
            cada ramo continua onde estava: dentro de um slot ela ainda
            impede o React de mutar o `type` do mesmo nó, que é o que fazia
            o clique do microfone cair no submit logo em seguida.

            O que ISTO destrava, e não era o objetivo: com o microfone em
            lugar próprio, dá para falar com texto já escrito no campo. Não
            dava — o botão de voz só existia quando o campo estava vazio, e
            `mesclaTranscricao` já sabia costurar a fala no que havia antes.
            A tela é que não deixava chegar lá. */}

        <SlotDeEstado
          interromper={interromper}
          parando={parando}
          agentName={agentName}
          pararEmCena={pararEmCena}
        />

        <SlotDeEntrada
          modo={modo}
          gravador={gravador}
          faseVoz={faseVoz}
          vozAparencia={vozAparencia}
          agentName={agentName}
          temConteudo={temConteudo}
          pararEmCena={pararEmCena}
        />

        <SlotDaConversa agentSlug={agentSlug} agentName={agentName} modo={modo} />

        <SlotDeDespacho
          despachoEmCena={despachoEmCena}
          sinalRecusa={sinalRecusa}
          setSinalRecusa={setSinalRecusa}
          agentName={agentName}
        />
        </motion.div>
      </div>
    </div>
  );
}
