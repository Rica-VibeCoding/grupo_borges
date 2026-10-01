'use client';

/**
 * Os ajustes da tela de voz, como cartão da gaveta. Só aparecem quando a
 * gaveta abre pela conversa (`mostraConversaNoPainel`): a gaveta é a única
 * casa deles. Fone e texto são interruptores. O visual é UMA escolha só
 * (`opcao` + `variacao`), por isso são duas pílulas encadeadas: Visual escolhe
 * a opção e Estilo mostra só as variações dela — cada linha sempre tem uma
 * marcada. Trocar o Visual volta na última variação usada naquela opção.
 */
import { useRef } from 'react';

import { useDetalheDaConversa } from '../conversa/contexto-configuracao-conversa';
import { CATALOGO, trocaOpcao, type Opcao } from '../conversa/preferencia-visual';
import { CHAVE_FONE, CHAVE_TEXTO } from '../conversa/preferencias-da-conversa';
import { useChaveDaConversa, useVisualConversa } from '../conversa/use-preferencias-conversa';
import { Cartao, Interruptor, Segmentado } from './pecas';

const OPCOES = CATALOGO.map((item) => ({ id: item.opcao, nome: item.curto }));

function LinhaDeChave({ nome, ligada, muda }: { nome: string; ligada: boolean; muda: (ligada: boolean) => void }) {
  return (
    <div className="flex items-center justify-between" style={{ gap: 'var(--ck-space-2)' }}>
      <span style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-primary)' }}>{nome}</span>
      <Interruptor ligado={ligada} rotulo="" descricao={nome} aoAlternar={() => muda(!ligada)} />
    </div>
  );
}

export function CartaoDaConversa() {
  const [visual, escolheVisual] = useVisualConversa();
  const [fone, mudaFone] = useChaveDaConversa(CHAVE_FONE);
  const [texto, mudaTexto] = useChaveDaConversa(CHAVE_TEXTO);
  const detalheTecnico = useDetalheDaConversa();
  const lembradas = useRef<Partial<Record<Opcao, string>>>({});
  const variacoes = CATALOGO.find((item) => item.opcao === visual.opcao)?.variacoes ?? CATALOGO[0].variacoes;

  const escolheOpcao = (opcao: Opcao) => {
    lembradas.current[visual.opcao] = visual.variacao;
    if (opcao !== visual.opcao) escolheVisual(trocaOpcao(opcao, lembradas.current));
  };

  return (
    <Cartao titulo="Conversa">
      <div className="flex flex-col">
        <LinhaDeChave nome="Estou de fone" ligada={fone} muda={mudaFone} />
        <LinhaDeChave nome="Mostrar texto" ligada={texto} muda={mudaTexto} />
      </div>
      <Segmentado nome="Visual" itens={OPCOES} marcado={(id) => visual.opcao === id} escolhe={escolheOpcao} />
      <Segmentado
        nome="Estilo"
        itens={variacoes}
        marcado={(id) => visual.variacao === id}
        escolhe={(id) => escolheVisual({ opcao: visual.opcao, variacao: id })}
      />
      {detalheTecnico ? (
        <p style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-tertiary)' }}>{detalheTecnico}</p>
      ) : null}
    </Cartao>
  );
}
