'use client';

/**
 * A linha da voz, acima da caixa: o microfone que não abriu, a transcrição que
 * não veio e o teto de 30s do STT. Saiu de `composer.tsx` (02/10) inteira, com
 * a reserva de altura e o porquê de ela nunca sair do layout.
 */
import { IconeDescartar } from './icones';
import type { Gravador } from './usa-gravador';
import type { AparenciaVoz, FaseVoz, Impedimento } from './voz';

export function LinhaDaVoz({
  avisoDaVoz,
  setFalhaDaFala,
  gravador,
  vozAparencia,
  faseVoz,
  avisoDoTetoDoStt,
}: {
  avisoDaVoz: Impedimento | null;
  setFalhaDaFala: (falha: Impedimento | null) => void;
  gravador: Gravador;
  vozAparencia: AparenciaVoz;
  faseVoz: FaseVoz;
  avisoDoTetoDoStt: boolean;
}) {
  return (
    /* A LINHA DA VOZ — sempre no layout, inclusive quando não há nada a
        dizer. As duas mensagens daqui montavam e desmontavam várias vezes por
        gesto (existem em `pedindo` e `transcrevendo`, somem em `gravando`), e
        como o composer está ancorado embaixo cada troca subia e descia 22,6px
        de TUDO que está acima. É o solavanco que o Rica sente ao SOLTAR o
        dedo — medido em `docs/cockpit-v2-medicao/faixa-da-voz-nao-empurra.py`,
        que reprova o build sem esta reserva.

        E ela mora ACIMA da caixa, não embaixo, embora fale do botão que está
        embaixo. Debaixo da caixa o orçamento já está fechado e é contado:
        `palco-da-conversa.tsx` desconta 21px do `safe-bottom` porque sabe que
        o reservador da linha de status está ali, e a conta existe para a
        caixa terminar a 34px do fundo — a barra de gestos do iPhone, régua
        que o Rica mandou em 13/08. Uma reserva permanente a mais ali empurra
        a caixa para cima do fundo da tela e nenhum padding traz de volta
        (`folga-embaixo-do-composer.py` reprova em 57px). Acima da caixa não
        há orçamento nenhum: quem cede o espaço é a conversa, que rola.

        `visibility: hidden` reservaria o espaço, mas some da árvore de
        acessibilidade — e esta linha existe justamente para AVISAR. Altura
        fixa também não serve: o aviso do microfone traz botão de dispensar e
        pode passar de uma linha. Daí `minHeight`, que é piso e não teto. O
        `flex-col` está aqui por causa do strut: em bloco comum a linha vazia
        herdaria o corpo de 16px e ficaria mais alta que o texto de 12px que
        ela reserva.

        DEPOIS DE 20/08 a reserva guarda MENOS gente: a narração de fase
        virou `sr-only` e não ocupa mais espaço nenhum. Quem ainda monta e
        desmonta aqui é o aviso do microfone e o teto de 30s do STT — ambos
        raros, ambos com botão ou moldura junto, e é para eles que a linha
        continua reservada. */
    <div
      className="mx-auto flex w-full flex-col"
      style={{
        maxWidth: 'var(--ck-w-composer)',
        padding: '0 var(--ck-space-2)',
        minHeight: 'calc(var(--ck-text-xs) * var(--ck-leading-body))',
      }}
    >
      {/* MICROFONE INDISPONÍVEL. Nunca um botão que não responde — o defeito
          que esta rodada consertou no envio, aqui com outra roupa. Sempre duas
          coisas: o que aconteceu e o que fazer a respeito. A saída é a parte
          que importa; "permissão negada" sozinho manda o Rica adivinhar em
          qual das telas de ajuste do iPhone ele mexe. */}
      {avisoDaVoz ? (
        <div
          className="flex w-full items-start justify-between"
          style={{ gap: 'var(--ck-space-3)' }}
        >
          <span
            role="status"
            aria-live="assertive"
            style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-state-attention)' }}
          >
            {avisoDaVoz.resumo} — {avisoDaVoz.saida}
          </span>
          <button
            type="button"
            onClick={() => {
              setFalhaDaFala(null);
              gravador.limparImpedimento();
            }}
            aria-label="Dispensar aviso do microfone"
            className="ck-veil flex shrink-0 items-center"
            style={{
              padding: '4px',
              borderRadius: 'var(--ck-radius-chip)',
              color: 'var(--ck-text-secondary)',
            }}
          >
            <IconeDescartar tamanho={13} />
          </button>
        </div>
      ) : null}

      {/* A VOZ FALANDO DE FORA DA CAIXA — agora só quando tem RECADO, nunca
          para narrar a fase. Rica, 20/08, vendo o ciclo gravado: *"na hora
          que eu clico aparece tipo umas frases em cima do composer, eu acho
          que não precisaria ter essa UI"*.

          Ele está certo sobre a narração: `liberando o microfone…` passa num
          quadro e ninguém lê, e `transcrevendo…` repete o que o fio na base
          da caixa já está dizendo com o próprio movimento. Duas peças para o
          mesmo recado, e a de cima é a que empurra a conversa.

          SOME DOS OLHOS, NÃO DA ÁRVORE DE ACESSIBILIDADE. Quem não enxerga o
          fio depende desta linha para saber que existe um tempo morto de STT
          — é literalmente o motivo pelo qual `visibility: hidden` foi
          recusado na reserva acima. `sr-only` mantém o nó no lugar e o
          `aria-live` falando; o que ele tira é a tinta.

          O ÚNICO que continua à vista é `travada` com áudio longo: ali a
          moldura vira âmbar, e cor sem motivo escrito é enfeite — quem vê o
          âmbar precisa saber que é o teto de 30s do STT chegando. Não é
          fase passando, é aviso, e aviso se lê. */}
      {vozAparencia.instrucao && faseVoz !== 'impedida' ? (
        <span
          role="status"
          aria-live="polite"
          // O punho da bancada. Há outras regiões `status` na tela (a bolinha
          // do agente é uma), e `troca-da-fala-nao-e-de-estalo.py` precisa
          // pegar ESTA para provar que ela ficou muda aos olhos e viva no
          // leitor de tela.
          data-linha="voz"
          className={avisoDoTetoDoStt ? undefined : 'sr-only'}
          style={
            avisoDoTetoDoStt
              ? {
                  fontSize: 'var(--ck-text-xs)',
                  color: vozAparencia.tinta ?? 'var(--ck-text-secondary)',
                }
              : undefined
          }
        >
          {vozAparencia.instrucao}
        </span>
      ) : null}
    </div>
  );
}
