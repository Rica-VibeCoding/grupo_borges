'use client';

/**
 * A segunda tela do `/voltar`: o ponto escolhido no topo, inteiro, e as opções.
 * As que só mexem na conversa disparam no toque; as que desfazem arquivo
 * ficam num bloco à parte e pedem um segundo toque — é a única que não se
 * desfaz rodando o `/voltar` de novo.
 */
import { useEffect, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';

import { opcoesDoPonto, type AcaoDeVolta, type PontoDeVolta } from '../../lib/rewind';

export type TelaOpcoesVoltarProps = {
  ponto: PontoDeVolta;
  executando: AcaoDeVolta | null;
  erro: string | null;
  aoRecuar: () => void;
  aoEscolher: (acao: AcaoDeVolta) => void;
};

export function TelaOpcoesVoltar({ ponto, executando, erro, aoRecuar, aoEscolher }: TelaOpcoesVoltarProps) {
  const [armada, setArmada] = useState<AcaoDeVolta | null>(null);
  const recuoRef = useRef<HTMLButtonElement>(null);
  const ocupado = executando !== null;
  const opcoes = opcoesDoPonto(ponto);
  const daConversa = opcoes.filter((o) => !o.desfazArquivo);
  const deArquivo = opcoes.filter((o) => o.desfazArquivo);

  // O botão que ele tocou na lista sumiu com a troca de tela: sem isto o foco
  // cai na caixa e quem navega por teclado não sabe que a tela mudou.
  useEffect(() => {
    recuoRef.current?.focus({ preventScroll: true });
  }, []);

  function tocar(acao: AcaoDeVolta, desfazArquivo: boolean) {
    if (ocupado) return;
    if (desfazArquivo && armada !== acao) {
      setArmada(acao);
      return;
    }
    setArmada(null);
    aoEscolher(acao);
  }

  function botao(opcao: (typeof opcoes)[number]) {
    const esta = executando === opcao.acao;
    const pedeConfirmacao = armada === opcao.acao && !esta;
    return (
      <button
        key={opcao.acao}
        type="button"
        className="ck-veil ck-voltar-item"
        aria-disabled={ocupado}
        aria-busy={esta}
        data-apagado={ocupado && !esta}
        data-armada={pedeConfirmacao}
        onClick={() => tocar(opcao.acao, opcao.desfazArquivo)}
      >
        <span className="min-w-0 flex-1">
          {esta ? 'Voltando…' : pedeConfirmacao ? 'Toque de novo pra desfazer os arquivos' : opcao.rotulo}
        </span>
      </button>
    );
  }

  return (
    <div className="ck-voltar-tela" data-lado="opcoes">
      <div className="ck-voltar-cabeca">
        <button
          ref={recuoRef}
          type="button"
          onClick={aoRecuar}
          aria-label="Voltar pra lista"
          className="ck-veil ck-voltar-recuo"
          aria-disabled={ocupado}
          data-apagado={ocupado}
        >
          ‹
        </button>
        <Dialog.Title className="ck-voltar-titulo ck-voltar-inteiro">{ponto.texto}</Dialog.Title>
      </div>
      {erro ? (
        <p role="alert" className="ck-voltar-erro">
          {erro}
        </p>
      ) : null}
      <div className="ck-voltar-corpo ck-voltar-rola">
        <div className="ck-voltar-grupo" role="group" aria-label="Voltar a conversa">
          {daConversa.map(botao)}
        </div>
        {deArquivo.length > 0 ? (
          <div className="ck-voltar-grupo ck-voltar-arquivo" role="group" aria-label="Desfazer arquivos">
            {deArquivo.map(botao)}
          </div>
        ) : null}
      </div>
    </div>
  );
}
