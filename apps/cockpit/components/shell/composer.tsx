'use client';

/**
 * Composer — a caixa alta, controles por dentro (estética §8).
 *
 * A referência do Rica pediu duas coisas com todas as letras: "chat input
 * maior com modelo em baixo" e o motor a um toque de onde se escreve. As
 * decisões que traduzem isso:
 *
 * 1. **Caixa alta com respiro**, não a linha fina que o v1 tinha. Os controles
 *    moram DENTRO dela, na base — não numa barra externa acima ou abaixo.
 * 2. **Modelo e esforço são controles reais.** O seletor abre um menu ancorado e
 *    recebe do painel somente as opções que o servidor autoriza. Para Claude
 *    Code, a troca de modelo acontece na sessão viva; com o agente trabalhando,
 *    o chip espera o ocioso e reenvia sozinho (27/09).
 * 3. **O único elemento sólido é o envio.** Tudo ao redor — anexo, motor,
 *    microfone — é traço ou texto. É a hierarquia que a referência desenha:
 *    uma tela inteira de contorno com UM ponto de massa.
 *
 * O FIO NA BASE é a tradução visual das seis fases da §3.1 do contrato de
 * dados — ver `aparencia-envio.ts` para a régua completa. Resumo do porquê:
 * `aceito` e `confirmado` são hoje INDISTINGUÍVEIS na tela (é o defeito que
 * gerou texto pendurado sem aviso), e a distinção aqui não depende de ler
 * palavra nenhuma — depende do fio se mover, parar, ou sumir.
 *
 * O SELETOR É AUTOSSUFICIENTE. A página que usa o Composer não precisa buscar
 * `/painel` antes: ele lê as opções ao montar e aplica as trocas pela API.
 *
 * NÃO EXISTE MODO DE DEMONSTRAÇÃO AQUI. O componente fala com o agente de
 * verdade e mostra o que ele está fazendo — nada de estado forçado, nada de
 * caminho que só a tela de teste exercita.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { aparenciaDe, type AcaoEnvio } from './aparencia-envio';
import { copyText } from '../../lib/clipboard';
import { usaCompact } from '../../lib/compact';
import { arquivoRetido, usaAnexo } from '../../lib/usa-anexo';
import { usaRascunho } from '../../lib/usa-rascunho';
import {
  descartaEcoPendente,
  registraEcoPendente,
  PRAZO_CC_MS,
} from '../../lib/eco-pendente';
import { MARCA_VOZ, usaEnvio, type OrigemEnvio } from '../../lib/usa-envio';
import { BarraCompact } from './barra-compact';
import { BlocoDaFila } from './bloco-da-fila';
import { BolinhaAgente } from './bolinha-agente';
import { FILA_VAZIA, enfileira, retira, soltaPausa } from './fila-de-envio';
import { fallbackCopy } from '../renderers/copia-fallback';
import { type Motor } from './motor';
import { BarraPerguntaMotor } from './barra-pergunta-motor';
import { preparaEnvio } from './porta-de-envio';
import { podePesquisar, prefixaPesquisa } from './pesquisa-canario';
import { usaPesquisaAtiva } from './usa-pesquisa';
import { emCaptura } from './modo-da-fala';
import { usaCanalEntrega } from './usa-canal-entrega';
import { voaParaBolha } from '../../lib/voo-do-envio';
import {
  confirmaAnexoPendente,
  descartaAnexoPendente,
  devolveLegenda,
  naoConfirmaAnexoPendente,
  registraAnexoPendente,
} from '../../lib/anexo-pendente';
import { MotionConfig, motion } from 'motion/react';
import { TROCA_DE_FILEIRA } from './troca-de-fileira';
import { AvisosDoComposer } from './avisos-do-composer';
import { BaseDaCaixa } from './base-da-caixa';
import { CaixaDoComposer } from './caixa-do-composer';
import { CampoDoComposer } from './campo-do-composer';
import { LinhaDaVoz } from './linha-da-voz';
import { usaDrenagemDaFila } from './usa-drenagem-da-fila';
import { usaAlturaDoCampo, usaMiniaturaRecolhida } from './usa-forma-da-caixa';
import { usaRecusaDaPorta } from './usa-recusa-da-porta';
import { usaTecladoTouch } from './usa-teclado-touch';
import { usaTurnoDoAgente } from './usa-turno-do-agente';
import { usaVozDoComposer } from './usa-voz-do-composer';

export type ComposerProps = {
  agentSlug: string;
  agentName: string;
  motor: Motor;
  /** Repasse direto para o SeletorMotor: a Tara tem `requested` no painel,
   *  o Claude não (ver `contratoSeparaPedido` em motor.ts). */
  esforcoCobrePedido: boolean;
};

/** O `/compact` com argumentos (`/compact foca no deploy`) também é compact —
 *  o que não pode casar é um `/compactar` hipotético ou a palavra no meio da
 *  frase. */
const COMPACT_RE = /^\s*\/compact(?:\s|$)/;

export function Composer({
  agentSlug,
  agentName,
  motor,
  esforcoCobrePedido,
}: ComposerProps) {
  // O campo é PERSISTIDO por agente: recarregar a página (no iPhone, puxar a
  // tela pra baixo) não pode apagar o que ele escreveu e não mandou. Ver
  // `lib/usa-rascunho.ts`.
  const [texto, setTexto, origemDoRascunho, setOrigemDoRascunho] = usaRascunho(agentSlug);
  const textoAtualRef = useRef(texto);
  textoAtualRef.current = texto;
  const substituicaoIntegralRef = useRef(false);
  const origemDoUltimoEnvio = useRef<OrigemEnvio>('text');
  // O toggle do `/pesquisa` mora na GAVETA desde 28/09; aqui só se lê.
  const pesquisaAtiva = usaPesquisaAtiva(agentSlug);
  const { daFrota, motorEnfileiraSozinho, turnoVivo, escrevendo, parando, setInterrompido,
    gerando, interromper } = usaTurnoDoAgente(agentSlug);
  // A máquina de seis fases é a da `lib/envio.ts`, dirigida pelo eco do stream:
  // `confirmado` só existe quando o item `user` VOLTA do servidor. Antes disto o
  // componente cantava `aceito` no 200 do POST e parava ali — que é o mesmo
  // "enviado" mentiroso do painel antigo, só que mais bonito.
  const envio = usaEnvio(agentSlug);
  const faseLocal = envio.estado.fase;
  const ultimoEnviado = envio.estado.fase === 'ocioso' ? '' : envio.estado.texto;
  const idAnuncio = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const vooEmCursoRef = useRef(false);
  const quadroAnexoRef = useRef<HTMLDivElement>(null);
  const tecladoTouch = usaTecladoTouch();

  // O ANEXO tem máquina PRÓPRIA, não a de seis fases do texto. Ali a pergunta é
  // "o agente recebeu?", respondida só pelo eco no stream; aqui o `POST /file`
  // devolve `tmux_delivered` e o próprio arquivo aparece no feed — não existe
  // eco de anexo para casar. Ver o cabeçalho de `lib/usa-anexo.ts`.
  const anexo = usaAnexo(agentSlug);
  // O arquivo na mão atravessa três fases (`escolhido`, `enviando` e o `erro`
  // de upload) — por isso a pergunta não se responde por uma fase só.
  const retidoAnexo = arquivoRetido(anexo.estado);
  // HÁ GESTO PARA DESPACHAR? A foto sozinha já é um — sem `retidoAnexo` aqui,
  // anexar sem escrever legenda deixava a imagem na tela e nenhum botão que a
  // mandasse. Vale para os dois slots, e é a única pergunta que ambos fazem.
  const temConteudo = texto.trim() !== '' || retidoAnexo !== null;
  // Campo vazio e nada anexado: a caixa é UMA fileira (28/09). Com qualquer
  // caractere, inclusive quebra de linha, volta às duas. Regra no globals.css.
  const miniaturaRecolhida = usaMiniaturaRecolhida(anexo);
  const umaLinha = texto === '' && retidoAnexo === null && miniaturaRecolhida;
  // O `+` mora dentro da caixa e a gaveta fora dela (o `overflow: hidden` do
  // form recortaria o painel). A ref costura os dois: é por ela que o `Escape`
  // devolve o foco ao botão que abriu.
  const botaoAnexoRef = useRef<HTMLButtonElement>(null);

  // O COMPACT trava o composer. Quem manda `/compact` é este componente (o
  // texto sai por `envio.enviar` como qualquer mensagem), então é aqui que a
  // espera COMEÇA; quem avisa que ela TERMINOU é o feed (o resumo chega no
  // stream) — a máquina compartilhada mora em `lib/compact.ts`. Enquanto ela
  // espera, digitar é proibido: uma mensagem no meio do compact corta o
  // resumo ao meio, que foi exatamente o acidente que gerou esta peça.
  const { estado: estadoCompact, iniciar: iniciarCompact, cancelar: cancelarCompact } =
    usaCompact(agentSlug);
  const travaCompact =
    estadoCompact.fase === 'compactando' || estadoCompact.fase === 'concluindo';
  // O `/compact` saiu mas o compact ainda não deu sinal — é a janela em que
  // um envio FALHADO significa "o compact nunca começou" e a espera morre.
  const compactPendenteRef = useRef(false);

  // A FILA DA ESPERA. O texto recusado pelo compact não fica no campo: ele sai
  // das mãos, fica pendurado à vista e é despachado sozinho quando a espera
  // termina — a régua de quem sai e quando mora em `fila-de-envio.ts`.
  const [fila, setFila] = useState(FILA_VAZIA);
  const contadorFila = useRef(0);

  const anexoEmVoo = anexo.estado.fase === 'enviando';
  const { setRecusa, sinalRecusa, setSinalRecusa, avisoDaPorta } = usaRecusaDaPorta({
    texto, retidoAnexo, anexoEmVoo, gerando, motorEnfileiraSozinho, travaCompact, faseLocal,
  });

  useEffect(() => {
    if (estadoCompact.fase === 'concluindo' || estadoCompact.fase === 'sem-retorno') {
      compactPendenteRef.current = false;
      return;
    }
    // `falhou` é certeza (o POST não foi aceito): o compact não existe e a
    // barra não pode esperar por um resumo que nunca virá. `nao-confirmado`
    // é ambiguidade — o texto PODE ter entrado — então a espera continua.
    if (faseLocal === 'falhou' && compactPendenteRef.current) {
      compactPendenteRef.current = false;
      cancelarCompact();
    }
  }, [faseLocal, estadoCompact.fase, cancelarCompact]);

  usaAlturaDoCampo(textareaRef, texto);

  const fase = faseLocal;
  // Só os dois estados de insucesso perguntam ao back por quê. No caminho
  // normal ninguém faz essa pergunta, e o `/painel` não é consultado.
  const { canalBloqueado, destravaFalhou, destravar } = usaCanalEntrega(
    agentSlug,
    fase === 'nao-confirmado' || fase === 'falhou',
  );
  const aparencia = aparenciaDe(fase, agentName, {
    canalBloqueado,
    destravaFalhou,
    emFila: envio.estado.fase === 'confirmado' && envio.estado.fila === true,
  });

  const { setFalhaDaFala, gravador, faseVoz, vozAparencia, niveisVoz, avisoDaVoz, modo,
    avisoDoTetoDoStt } = usaVozDoComposer({
    agentSlug, agentName, texto, setTexto, setOrigemDoRascunho, setRecusa, textareaRef,
  });
  // O SLOT DE DESPACHO ESTÁ EM CENA? Em `travada` o gesto que fecha é o do
  // áudio, no slot de entrada — não há texto a mandar enquanto a gravação
  // espera. Fora daí, quem manda o botão existir é haver o que despachar.
  const despachoEmCena = temConteudo && modo !== 'travada';
  // O que muda a FORMA da caixa: é só nisso que a Motion mede o layout. Sem a
  // dependência ela mediria a cada render, e a onda da voz renderiza o
  // composer a 60 quadros por segundo. O despacho entra porque tirar o botão
  // de enviar anda os botões — o deslize antigo por CSS saiu em 30/09.
  const formaDaCaixa = `${texto}|${retidoAnexo !== null}|${miniaturaRecolhida}|${despachoEmCena}`;
  // O ■ SOME DURANTE A CAPTURA. Em `travada` o slot de entrada já mostra um ■
  // — encerrar a gravação e mandar o áudio — e dois quadrados brancos na mesma
  // fileira são dois recados diferentes com o mesmo desenho. Enquanto o dedo
  // está numa gravação a base da caixa é do gesto de voz, como já é dos chips,
  // que dão lugar à onda.
  const pararEmCena = gerando && !emCaptura(modo);

  /**
   * `retomada` é o "Reenviar"/"Tentar de novo" da linha de estado: ali o gesto é
   * o TEXTO que ficou pendurado, e nunca o anexo — a foto na mão não é o que
   * falhou, e mandá-la com a legenda de outra mensagem seria despachar algo que
   * o Rica não pediu.
   */
  async function enviar(
    corpo: string,
    retomada = false,
    origemRetomada: OrigemEnvio = 'text',
  ): Promise<boolean> {
    // O quadro do voo (`voaParaBolha`) separa o gesto do campo esvaziar: um
    // segundo toque nesse meio acharia o texto ainda escrito e a porta livre, e
    // a mensagem sairia duas vezes. Quem segura é esta marca, erguida antes do
    // `await` e baixada depois dele.
    if (!retomada && vooEmCursoRef.current) return false;
    const origem: OrigemEnvio = retomada
      ? origemRetomada
      : origemDoRascunho;
    // O toggle altera só o gesto que nasceu AGORA no campo. O corpo de uma
    // retomada já foi decidido quando entrou na fila ou na máquina de envio;
    // prefixá-lo aqui de novo mudaria a tentativa que o Rica está reabrindo.
    const corpoParaEnviar = prefixaPesquisa(corpo, podePesquisar(agentSlug) && pesquisaAtiva, retomada);
    // A PORTA decide, e o campo só esvazia se ela liberar. Era o contrário:
    // três `return` mudos recusavam DEPOIS de `setTexto('')` já ter rodado, e
    // em 05/08 uma mensagem do Rica morreu assim — sem requisição, sem aviso,
    // sem sobrar em lugar nenhum. Ver `porta-de-envio.ts`.
    //
    // O ANEXO PASSA POR AQUI, e é o que fecha o último buraco: antes ele subia
    // pela gaveta, sem porta nenhuma, então foto durante o `/compact` cortava o
    // resumo ao meio — exatamente o que a porta impede para o texto.
    const anexar = retidoAnexo !== null && !retomada;
    const efeito = preparaEnvio({
      texto: corpoParaEnviar,
      temAnexo: anexar,
      // Só trava o gesto que LEVA o arquivo. Reenviar um texto pendurado
      // enquanto uma foto sobe não duplica nada e não tem por que esperar.
      anexoEmVoo: anexar && anexoEmVoo,
      turnoEmVoo: gerando,
      motorEnfileiraSozinho,
      compactando: travaCompact,
      faseEnvio: faseLocal,
      // Quem decide se o campo pode esvaziar é a porta, e para decidir ela
      // precisa saber de onde veio o corpo: numa retomada ele vem da máquina,
      // e o campo guarda a mensagem NOVA que o Rica escreveu esperando.
      retomada,
    });
    setRecusa(
      efeito.aviso !== null && efeito.motivo !== null
        ? { motivo: efeito.motivo, aviso: efeito.aviso }
        : null,
    );
    // A recusa com recado é um toque que não saiu. O aviso da faixa pode ficar
    // atrás do teclado no iPhone — quem sente é o botão, sacudindo. Só o toque
    // DIRETO (`!retomada`): o despacho da fila já mostra o recuo no bloco, e o
    // "Reenviar" é o usuário pedindo de novo — nenhum dos dois é gesto mudo.
    if (!retomada && !efeito.despacha && efeito.aviso !== null) {
      setSinalRecusa(true);
    }
    // A FILA. O único caminho em que o campo esvazia sem despacho — e não é
    // descarte: o texto sai do campo e aparece inteiro no bloco logo acima,
    // com o controle de trazê-lo de volta. O despacho é do efeito abaixo,
    // quando a espera terminar.
    if (efeito.enfileira) {
      contadorFila.current += 1;
      const item = { id: `fila-${contadorFila.current}`, texto: corpoParaEnviar, origem };
      setFila((atual) => enfileira(atual, item));
      if (efeito.limpaCampo) {
        setTexto('');
        setOrigemDoRascunho('text');
      }
      return false;
    }
    if (!efeito.despacha) return false;
    // A marca de "eu mandei parar" morre AQUI, no gesto que inequivocamente
    // abre um turno novo — e não num efeito que observa `trabalhando` cair.
    // Aquela versão tinha corrida: a fase pisca entre dois polls, a marca era
    // apagada no vale e o ■ ressuscitava sobre um agente já parado.
    setInterrompido(false);
    // UM GESTO, UMA ENTREGA: o arquivo sobe com o texto como legenda, no mesmo
    // multipart. Não existe mensagem de texto separada — duas requisições dariam
    // duas entregas ao tmux, e o agente veria a legenda antes ou depois do
    // arquivo sem ordem garantida.
    if (anexar) {
      // O VOO DO ANEXO (28/09): a miniatura decola do composer e pousa na bolha
      // otimista do feed, que mostra o arquivo LOCAL com "enviando…" até o
      // upload voltar. A legenda sai do campo no mesmo quadro — ela está na
      // bolha. Se o upload falhar, a bolha sai, o arquivo volta para a
      // miniatura com o motivo (`usa-anexo.ts`) e a legenda volta para o campo,
      // em cima do que foi escrito depois: nada evapora, nas duas metades. Se
      // ele não CONFIRMAR (`tmux_delivered: false`, rede caindo depois do
      // upload), é o `nao-confirmado` do texto: a bolha fica, o aviso âmbar
      // fala, e nem arquivo nem legenda voltam — reenviar duplicaria.
      //
      // A marca do voo segura o segundo toque no quadro entre o gesto e o
      // callback da View Transition; dali em diante a fase é `enviando` e quem
      // segura é a porta (`anexo-em-voo`) e a trava muda do `usa-anexo.ts`.
      vooEmCursoRef.current = true;
      const retido = retidoAnexo;
      let idAnexo: string | null = null;
      let entrega: Promise<boolean> = Promise.resolve(false);
      await voaParaBolha(
        retido.especie === 'document' ? null : quadroAnexoRef.current,
        () => {
          setTexto('');
          setOrigemDoRascunho('text');
          // Documento não tem bolha visual: sobe como sempre subiu, sem voo e
          // com a miniatura na caixa até a entrega.
          if (retido.especie === 'image' || retido.especie === 'video') {
            const id = registraAnexoPendente(agentSlug, {
              url: URL.createObjectURL(retido.arquivo),
              especie: retido.especie,
              legenda: corpoParaEnviar,
              nome: retido.arquivo.name,
            });
            idAnexo = id;
            entrega = anexo.enviar(
              corpoParaEnviar,
              (resposta) => confirmaAnexoPendente(agentSlug, id, resposta),
              (resposta) =>
                resposta
                  ? confirmaAnexoPendente(agentSlug, id, resposta)
                  : naoConfirmaAnexoPendente(agentSlug, id),
            );
            return id;
          }
          entrega = anexo.enviar(corpoParaEnviar);
          return null;
        },
        'anexo',
      );
      vooEmCursoRef.current = false;
      if (!(await entrega)) {
        if (idAnexo !== null) descartaAnexoPendente(agentSlug, idAnexo);
        const atual = textoAtualRef.current;
        setTexto(devolveLegenda(corpo, atual));
        if (corpo.trim()) {
          setOrigemDoRascunho((vigente) =>
            atual.trim() === '' ? origem : vigente === 'stt' || origem === 'stt' ? 'stt' : 'text',
          );
        }
        // A entrega falhou DEPOIS do POST (recusa do tmux, 4xx/5xx, rede). A
        // porta não cobre este caso — ela só vê o gesto ANTES de subir —, então
        // quem responde ao toque é este sinal, a mesma resposta física da
        // recusa de porta. O motivo fica na miniatura, acima do teclado.
        setSinalRecusa(true);
      }
      return true;
    }
    // `/compact` é mensagem comum pro back, mas pra ESTA tela é também o
    // gatilho da espera: inicia a máquina ANTES do POST voltar, porque a
    // barra precisa nascer com o clique, não com o 200.
    if (COMPACT_RE.test(corpoParaEnviar)) {
      compactPendenteRef.current = true;
      iniciarCompact();
    }
    // Esvazia no instante em que a tentativa é ACEITA, não quando ela é
    // entregue: esperar o POST voltar deixaria o texto no campo durante toda a
    // viagem de rede, e um segundo Enter ali duplica a mensagem. Daqui em
    // diante quem guarda o texto é a máquina (`estado.texto`), que precisa
    // dele para casar o eco e para oferecer novo envio se o eco não vier.
    // O VOO (28/09): esvaziar o campo e pintar a bolha acontecem no mesmo
    // quadro, dentro da View Transition, e o texto voa de um para o outro. Só
    // voa quando o texto SAIU do campo — numa retomada o campo guarda outra
    // mensagem, e ela não é a que está indo. Ver `lib/voo-do-envio.ts`.
    vooEmCursoRef.current = true;
    const idEcoPendente = await voaParaBolha(efeito.limpaCampo ? textareaRef.current : null, () => {
      if (efeito.limpaCampo) {
        setTexto('');
        setOrigemDoRascunho('text');
      }
      setFalhaDaFala(null);
      // O feed pinta esta bolha no GESTO, nos dois motores. Até 15/08 só a Tara
      // tinha isto, com a justificativa de que *"no Claude Code o eco volta pelo
      // stream em milissegundos"* — premissa nunca medida. Medida naquele dia no
      // `:3008`, com o agente ocioso: **18,9 s** entre o Enter e a bolha, contra
      // 0,1 s do campo esvaziando. Dezoito segundos de tela muda são o "engoliu a
      // mensagem" que o Rica reporta desde sempre, e são quase o dobro dos 10 s
      // que a NN/g dá como limite de atenção.
      //
      // A mesma pendência conserta o alarme: `PRAZO_ECO_MS` são 12 s calibrados
      // sobre um pior caso de 1,434 s, então ele estourava ANTES do eco real e
      // toda mensagem para agente ocioso terminava em "não consegui confirmar se
      // entrou". Ver `lib/eco-pendente.ts` e o ramo do CC em
      // `app/agente/[slug]/feed-da-conversa.tsx`.
      return registraEcoPendente(
        agentSlug,
        origem === 'stt' ? `${MARCA_VOZ}${corpoParaEnviar}` : corpoParaEnviar,
        PRAZO_CC_MS,
        origem === 'stt' ? corpoParaEnviar : undefined,
      );
    });
    vooEmCursoRef.current = false;
    // Se o POST rejeitar com erro HTTP real (fase `falhou`), a máquina
    // acabou de provar que o texto não saiu — desfaz a bolha otimista em vez
    // de deixá-la contradizendo a faixa de erro por até 3 min (achado [2] da
    // auditoria, 09/08).
    origemDoUltimoEnvio.current = origem;
    await envio.enviar(
      corpoParaEnviar,
      idEcoPendente ? () => descartaEcoPendente(agentSlug, idEcoPendente) : undefined,
      origem,
    );
    return true;
  }

  usaDrenagemDaFila({ fila, setFila, estadoCompact, faseLocal, enviar });

  /** Tira da fila e devolve ao campo — cancelar e editar são o mesmo gesto, e
   *  nada que saia da fila evapora. O que já estava escrito fica embaixo: o
   *  campo é do Rica, e sobrescrevê-lo seria o descarte pela porta dos fundos. */
  function editarDaFila(id: string) {
    const { estado, item } = retira(fila, id);
    if (!item) return;
    setFila(estado);
    setTexto((atual) => (atual.trim() ? `${item.texto}\n${atual}` : item.texto));
    setOrigemDoRascunho((atual) => (atual === 'stt' || item.origem === 'stt' ? 'stt' : 'text'));
    textareaRef.current?.focus();
  }

  function aoSubmeter(e: FormEvent) {
    e.preventDefault();
    enviar(texto);
  }

  function acionar(acao: AcaoEnvio) {
    // Destravar não reenvia nada: abre o canal e devolve a faixa ao estado
    // genérico, onde o botão de mandar de novo volta a existir. Juntar os dois
    // gestos num toque mandaria o texto por um canal cuja abertura ainda não
    // foi confirmada — que é o defeito, não o conserto.
    if (acao === 'destravar') {
      void destravar();
      return;
    }
    if (acao === 'copiar') {
      const moderno =
        typeof navigator !== 'undefined' && navigator.clipboard
          ? navigator.clipboard.writeText.bind(navigator.clipboard)
          : undefined;
      void copyText(ultimoEnviado, { writeText: moderno, fallbackCopy });
      return;
    }
    // `nao-confirmado` tem caminho próprio na máquina — ela sabe que a tentativa
    // anterior pode ter sido entregue e conta o eco ambíguo em vez de confirmar
    // o reenvio com o eco do primeiro. `falhou` é reenvio comum.
    if (fase === 'nao-confirmado') {
      void envio.reenviar();
      return;
    }
    void enviar(ultimoEnviado, true, origemDoUltimoEnvio.current);
  }

  return (
    // `user`: com movimento reduzido no aparelho, a Motion não anima layout.
    <MotionConfig reducedMotion="user">
      {/* A BORDA PROGRESSIVA — o feed se dissolve da cabeça do mascote ao fim
          da tela, num efeito só (substitui o rodapé de vidro). Irmã ANTERIOR
          da coluna, que é `relative`: entre posicionados sem z-index vale a
          ordem do DOM, então as camadas pintam atrás de tudo que o composer
          desenha e na frente do feed. As cinco filhas anônimas são a escada de
          desfoque (raios dobrando), a nomeada é a tinta que escurece a névoa —
          desenho, números e porquês no globals.css. */}
      <div aria-hidden className="ck-borda-progressiva">
        <div />
        <div />
        <div />
        <div />
        <div />
        <div className="ck-borda-tinta" />
      </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ck-space-1)', position: 'relative' }}>
      {/* A BOLINHA — a presença do agente, no alto de tudo que o composer
          empilha. Ela não repete o "Pensando há 12 s" da linha viva: aquilo é
          texto no feed, isto é alguém do outro lado. Presença e nada mais: o ■
          que morava colado nela desceu para a base da caixa em 21/08. */}
      {/* Sobe e desce com a caixa: a coluna é ancorada embaixo, então quando a
          caixa cresce a bolinha é empurrada — e anda em vez de pular. */}
      <motion.div
        layout="position"
        layoutDependency={formaDaCaixa}
        transition={{ layout: TROCA_DE_FILEIRA }}
      >
        <BolinhaAgente
          status={daFrota?.status}
          turnoVivo={turnoVivo}
          escrevendo={escrevendo}
          ouvindo={texto.trim() !== ''}
        />
      </motion.div>
      {/* A espera do `/compact` mora ACIMA da caixa e empurra tudo pra baixo —
          faixa fina da largura da coluna, nunca overlay nem modal. */}
      <BarraCompact estado={estadoCompact} onDispensar={cancelarCompact} />
      {/* O "trocar mesmo?" do Claude Code, se aparecer apesar do chip esperar o
          ocioso e o back responder sozinho — ver `barra-pergunta-motor.tsx`. */}
      <BarraPerguntaMotor agentSlug={agentSlug} />
      {/* A FILA DA ESPERA — entre o indicador de trabalho e a caixa, nunca
          dentro dela: o campo é o que está sendo escrito agora, a fila é o que
          já saiu das mãos. */}
      <BlocoDaFila
        estado={fila}
        aoEditar={editarDaFila}
        aoForcar={() => setFila(soltaPausa(fila))}
      />
      <LinhaDaVoz
        avisoDaVoz={avisoDaVoz}
        setFalhaDaFala={setFalhaDaFala}
        gravador={gravador}
        vozAparencia={vozAparencia}
        faseVoz={faseVoz}
        avisoDoTetoDoStt={avisoDoTetoDoStt}
      />
      <CaixaDoComposer
        agentSlug={agentSlug}
        pesquisaAtiva={pesquisaAtiva}
        formaDaCaixa={formaDaCaixa}
        umaLinha={umaLinha}
        aparencia={aparencia}
        anexo={anexo}
        miniaturaRecolhida={miniaturaRecolhida}
        textareaRef={textareaRef}
        quadroAnexoRef={quadroAnexoRef}
        botaoAnexoRef={botaoAnexoRef}
        aoSubmeter={aoSubmeter}
      >
        <CampoDoComposer
          agentSlug={agentSlug} agentName={agentName} texto={texto} setTexto={setTexto}
          setOrigemDoRascunho={setOrigemDoRascunho} textareaRef={textareaRef}
          substituicaoIntegralRef={substituicaoIntegralRef} formaDaCaixa={formaDaCaixa}
          modo={modo} anexo={anexo} tecladoTouch={tecladoTouch} retidoAnexo={retidoAnexo}
          enviar={enviar} travaCompact={travaCompact}
        />
        <BaseDaCaixa
          agentSlug={agentSlug} agentName={agentName} motor={motor}
          esforcoCobrePedido={esforcoCobrePedido} formaDaCaixa={formaDaCaixa} modo={modo}
          gravador={gravador} faseVoz={faseVoz} vozAparencia={vozAparencia}
          niveisVoz={niveisVoz} anexo={anexo} botaoAnexoRef={botaoAnexoRef}
          travaCompact={travaCompact} temConteudo={temConteudo} despachoEmCena={despachoEmCena}
          sinalRecusa={sinalRecusa} setSinalRecusa={setSinalRecusa} pararEmCena={pararEmCena}
          parando={parando} interromper={interromper}
        />
      </CaixaDoComposer>
      <AvisosDoComposer
        anexo={anexo}
        avisoDaPorta={avisoDaPorta}
        aparencia={aparencia}
        idAnuncio={idAnuncio}
        acionar={acionar}
      />
    </div>
    </MotionConfig>
  );
}
