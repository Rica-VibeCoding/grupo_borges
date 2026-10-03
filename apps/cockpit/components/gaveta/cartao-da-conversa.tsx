'use client';

/**
 * Os ajustes da tela de voz, como cartão da gaveta. Só aparecem quando a
 * gaveta abre pela conversa (`mostraConversaNoPainel`): a gaveta é a única
 * casa deles. Fone e texto são interruptores. O visual é UMA escolha só
 * (`opcao` + `variacao`), por isso são duas pílulas encadeadas: Visual escolhe
 * a opção e Estilo mostra só as variações dela — cada linha sempre tem uma
 * marcada. Trocar o Visual volta na última variação usada naquela opção.
 * Resposta e Voz (03/10) valem no aparelho, como as outras: Curta fala duas frases e deixa o resto
 * no chat; a Voz lista só o que o servidor atende para este agente (MiniMax só com chave).
 */
import { useEffect, useRef, useState } from 'react';

import { useDetalheDaConversa } from '../conversa/contexto-configuracao-conversa';
import { CATALOGO, trocaOpcao, type Opcao } from '../conversa/preferencia-visual';
import { CHAVE_FONE, CHAVE_TEXTO, MOTORES, type Motor, type Resposta } from '../conversa/preferencias-da-conversa';
import { useChaveDaConversa, useMotorConversa, useRespostaConversa, useVisualConversa } from '../conversa/use-preferencias-conversa';
import { Cartao, Interruptor, Segmentado } from './pecas';

const OPCOES = CATALOGO.map((item) => ({ id: item.opcao, nome: item.curto }));
const RESPOSTAS: readonly { id: Resposta; nome: string }[] = [
  { id: 'curta', nome: 'Curta' },
  { id: 'completa', nome: 'Completa' },
];
const NOME_DO_MOTOR: Record<Motor, string> = { chirp: 'Natural', wavenet: 'Econômica', minimax: 'MiniMax' };
/** Sem resposta do servidor, as duas do Google, que toda a frota tem. */
const MOTORES_DE_SEMPRE: readonly Motor[] = ['chirp', 'wavenet'];

function useMotoresDoAgente(slug: string): readonly Motor[] {
  const [motores, setMotores] = useState(MOTORES_DE_SEMPRE);
  useEffect(() => {
    const corte = new AbortController();
    fetch(`/api/tts/motores?slug=${encodeURIComponent(slug)}`, { signal: corte.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((corpo: { motores?: string[] } | null) => {
        const validos = MOTORES.filter((motor) => corpo?.motores?.includes(motor));
        if (validos.length > 0) setMotores(validos);
      })
      .catch(() => {});
    return () => corte.abort();
  }, [slug]);
  return motores;
}

function LinhaDeChave({ nome, ligada, muda }: { nome: string; ligada: boolean; muda: (ligada: boolean) => void }) {
  return (
    <div className="flex items-center justify-between" style={{ gap: 'var(--ck-space-2)' }}>
      <span style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-primary)' }}>{nome}</span>
      <Interruptor ligado={ligada} rotulo="" descricao={nome} aoAlternar={() => muda(!ligada)} />
    </div>
  );
}

export function CartaoDaConversa({ agentSlug }: { agentSlug: string }) {
  const [visual, escolheVisual] = useVisualConversa();
  const [resposta, escolheResposta] = useRespostaConversa();
  const [motor, escolheMotor] = useMotorConversa();
  const motores = useMotoresDoAgente(agentSlug);
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
      <Segmentado nome="Resposta" itens={RESPOSTAS} marcado={(id) => resposta === id} escolhe={escolheResposta} />
      <Segmentado
        nome="Voz"
        itens={motores.map((id) => ({ id, nome: NOME_DO_MOTOR[id] }))}
        marcado={(id) => motor === id}
        escolhe={escolheMotor}
      />
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
