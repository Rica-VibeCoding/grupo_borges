'use client';

// O aprendizado aberto: o arquivo inteiro e a poda. Carregado só no toque
// (`next/dynamic` em `no-da-linha.tsx`). Confirmar é em linha, como na tela
// Abertos: o aviso diz o que acontece e o botão repete ação + objeto.
// O POST só sai depois do toque em "Apagar memória"/"Arquivar skill".

import { useEffect, useState } from 'react';

import { Botao } from '@/components/aprendizado/botao';
import {
  fetchConteudo,
  mensagemDeErro,
  nomeDoAgente,
  podaPermitida,
  postPoda,
  tituloLegivel,
  type NoAprendizado,
  type Poda,
} from '@/lib/aprendizado';

export function DetalheDoNo({
  no,
  aoPodar,
  aoFechar,
}: {
  no: NoAprendizado;
  aoPodar: (poda: Poda) => void;
  aoFechar: () => void;
}) {
  const [texto, setTexto] = useState<string | null>(null);
  const [falhaAoAbrir, setFalhaAoAbrir] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  // Voltou do Cancelar: o foco volta ao botão que abriu a confirmação.
  const [cancelou, setCancelou] = useState(false);
  const [emVoo, setEmVoo] = useState(false);
  const [falhaAoPodar, setFalhaAoPodar] = useState<string | null>(null);
  const poda = podaPermitida(no.tipo);
  const agente = nomeDoAgente(no.agente);

  useEffect(() => {
    let vivo = true;
    fetchConteudo(no.id)
      .then((c) => vivo && setTexto(c.texto))
      .catch((erro) => vivo && setFalhaAoAbrir(mensagemDeErro(erro, 'abrir')));
    return () => {
      vivo = false;
    };
  }, [no.id]);

  async function podar() {
    if (emVoo || !poda) return;
    setEmVoo(true);
    setFalhaAoPodar(null);
    try {
      const r = await postPoda(no);
      aoPodar({
        no_id: no.id,
        operacao_id: r.operacao_id,
        tipo: no.tipo === 'skill' ? 'skill' : 'memoria',
        titulo: no.titulo,
        agente: no.agente,
        em: Math.floor(Date.now() / 1000),
        estado: no.tipo === 'skill' ? 'pedido' : 'apagada',
      });
    } catch (erro) {
      setFalhaAoPodar(mensagemDeErro(erro, 'podar', no.tipo === 'skill' ? 'skill' : 'memoria'));
      setEmVoo(false);
    }
  }

  return (
    <div className="flex flex-col" style={{ gap: 'var(--ck-space-3)', paddingTop: 'var(--ck-space-1)' }}>
      <pre
        className="whitespace-pre-wrap break-words"
        style={{
          padding: 'var(--ck-space-3)',
          borderRadius: 'var(--ck-radius-frame)',
          background: 'var(--ck-surface-canvas)',
          fontFamily: 'var(--ck-font-mono)',
          fontSize: 'var(--ck-text-sm)',
          color: falhaAoAbrir ? 'var(--ck-state-fail)' : 'var(--ck-text-primary)',
        }}
      >
        {falhaAoAbrir ?? (texto === null ? 'Abrindo o arquivo…' : texto || 'Arquivo vazio.')}
      </pre>
      <p className="break-all" style={{ fontFamily: 'var(--ck-font-mono)', fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}>
        {no.caminho}
      </p>

      {confirmando && poda ? (
        <div
          role="group"
          aria-label={poda === 'apagar' ? 'Confirmar apagar memória' : 'Confirmar arquivar skill'}
          className="flex flex-col"
          style={{
            gap: 'var(--ck-space-3)',
            padding: 'var(--ck-space-3)',
            borderRadius: 'var(--ck-radius-frame)',
            border: '1px solid var(--ck-state-fail)',
          }}
        >
          <p className="text-pretty" style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-primary)' }}>
            {poda === 'apagar'
              ? `Apagar a memória “${tituloLegivel(no)}” de ${agente}? Ela sai do índice e vai para o arquivo dele. Dá para desfazer depois.`
              : `Pedir à Faxina para arquivar a skill “${no.titulo}” de ${agente}? Ela move em até 1 min e dá para desfazer depois disso.`}
          </p>
          {falhaAoPodar ? (
            <p role="alert" className="text-pretty" style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-state-fail)' }}>
              {falhaAoPodar}
            </p>
          ) : null}
          <div className="flex flex-wrap" style={{ gap: 'var(--ck-space-2)' }}>
            <Botao
              rotulo={poda === 'apagar' ? 'Apagar memória' : 'Arquivar skill'}
              perigo
              focar
              ocupado={emVoo}
              onClick={() => void podar()}
            />
            <Botao
              rotulo="Cancelar"
              contorno
              onClick={() => {
                setConfirmando(false);
                setCancelou(true);
              }}
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center" style={{ gap: 'var(--ck-space-2)' }}>
          <Botao rotulo="Fechar" onClick={aoFechar} />
          {poda ? (
            <Botao
              rotulo={poda === 'apagar' ? 'Apagar…' : 'Arquivar…'}
              contorno
              focar={cancelou}
              onClick={() => setConfirmando(true)}
            />
          ) : null}
          {poda === null ? (
            <p style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}>
              Memória compartilhada é só leitura por aqui.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
