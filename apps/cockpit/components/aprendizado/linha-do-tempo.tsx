'use client';

// A linha do tempo: dias do mais novo ao mais antigo, paginação pelo offset da
// API e as podas feitas daqui. A poda é guardada no aparelho (localStorage) para
// o Desfazer sobreviver ao nó sair da lista e à página recarregar — o contrato
// pede isso: "guardar o operacao_id … inclusive depois que o nó sair da lista".

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { NoDaLinha } from '@/components/aprendizado/no-da-linha';
import { PodasRecentes } from '@/components/aprendizado/podas-recentes';
import {
  agruparPorDia,
  CHAVE_DAS_PODAS,
  fetchAprendizado,
  lerPodas,
  rotuloDoDia,
  type Filtros,
  type ListaAprendizado,
  type Poda,
} from '@/lib/aprendizado';

export function LinhaDoTempo({ inicial, filtros, agora }: { inicial: ListaAprendizado; filtros: Filtros; agora: number }) {
  const [itens, setItens] = useState(inicial.itens);
  const [proximo, setProximo] = useState(inicial.proximo_offset);
  const [carregando, setCarregando] = useState(false);
  const [falhaAoCarregar, setFalhaAoCarregar] = useState(false);
  const [podas, setPodas] = useState<Poda[]>([]);
  // O aviso da poda nasce já com texto, e leitor de tela não anuncia região
  // nova: quem anuncia é esta, que existe desde o começo.
  const [anuncio, setAnuncio] = useState('');

  // `router.refresh()` (memória restaurada fora da tela) traz uma primeira
  // página nova do servidor: ela substitui a lista, voltando ao topo.
  useEffect(() => {
    setItens(inicial.itens);
    setProximo(inicial.proximo_offset);
  }, [inicial]);

  // Depois da hidratação: o servidor não conhece o localStorage.
  useEffect(() => {
    setPodas(lerPodas(localStorage.getItem(CHAVE_DAS_PODAS), Math.floor(Date.now() / 1000)));
  }, []);

  function guardar(proximas: Poda[]) {
    setPodas(proximas);
    try {
      localStorage.setItem(CHAVE_DAS_PODAS, JSON.stringify(proximas));
    } catch {
      /* aparelho sem espaço ou modo privado: o Desfazer vale só nesta visita */
    }
  }

  const registrar = (poda: Poda) => {
    guardar([poda, ...podas.filter((p) => p.no_id !== poda.no_id)]);
    setAnuncio(poda.tipo === 'skill' ? 'Arquivamento pedido à Faxina.' : 'Memória apagada.');
  };
  const esquecer = (noId: string) => {
    const era = podas.find((p) => p.no_id === noId);
    guardar(podas.filter((p) => p.no_id !== noId));
    if (era?.estado === 'apagada') setAnuncio('Memória restaurada.');
  };
  const mudar = (poda: Poda) => {
    guardar(podas.map((p) => (p.no_id === poda.no_id ? poda : p)));
    if (poda.estado === 'volta_pedida') setAnuncio('Volta pedida à Faxina.');
  };

  async function carregarMais() {
    if (proximo === null || carregando) return;
    setCarregando(true);
    setFalhaAoCarregar(false);
    try {
      const pagina = await fetchAprendizado(filtros, proximo);
      // O inventário anda entre uma página e outra: o que já está na tela não repete.
      setItens((atuais) => {
        const vistos = new Set(atuais.map((n) => n.id));
        return [...atuais, ...pagina.itens.filter((n) => !vistos.has(n.id))];
      });
      setProximo(pagina.proximo_offset);
    } catch {
      setFalhaAoCarregar(true);
    } finally {
      setCarregando(false);
    }
  }

  const naTela = new Set(itens.map((n) => n.id));
  const foraDaTela = podas.filter((p) => !naTela.has(p.no_id));
  const dias = agruparPorDia(itens);
  const restantes = Math.max(0, inicial.total - itens.length);

  return (
    <div className="flex flex-col" style={{ gap: 'var(--ck-space-4)' }}>
      <p aria-live="polite" className="sr-only">
        {anuncio}
      </p>

      {foraDaTela.length > 0 ? <PodasRecentes podas={foraDaTela} aoMudar={mudar} aoEsquecer={esquecer} /> : null}

      {itens.length === 0 ? (
        <div className="flex flex-col items-start" style={{ gap: 'var(--ck-space-2)', padding: '0 var(--ck-space-3)' }}>
          <p className="text-pretty" style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}>
            {filtros.agente || filtros.tipo
              ? 'Nada aprendido com este filtro.'
              : 'A frota ainda não tem memória nem skill registrada.'}
          </p>
          {filtros.agente || filtros.tipo ? (
            <Link
              href="/aprendizado"
              prefetch={false}
              className="ck-link ck-foco-fio inline-flex items-center"
              style={{ minHeight: 'var(--ck-touch-min)', borderRadius: 'var(--ck-radius-frame)', fontSize: 'var(--ck-text-sm)', color: 'var(--ck-link)' }}
            >
              Ver tudo
            </Link>
          ) : null}
        </div>
      ) : null}

      {dias.map((dia) => (
        <section key={dia.chave} aria-label={rotuloDoDia(dia.data, agora)} className="flex flex-col">
          <h2
            className="sticky z-10"
            style={{
              // No app instalado o topo da rolagem fica sob a barra do iPhone.
              top: 'var(--ck-safe-top)',
              padding: 'var(--ck-space-2) var(--ck-space-3)',
              background: 'var(--ck-surface-nav)',
              fontSize: 'var(--ck-text-sm)',
              color: 'var(--ck-text-primary)',
            }}
          >
            {rotuloDoDia(dia.data, agora)}
            <span className="ck-tabular" style={{ marginLeft: 'var(--ck-space-2)', color: 'var(--ck-text-secondary)' }}>
              {dia.itens.length}
            </span>
          </h2>
          <ol className="flex flex-col">
            {dia.itens.map((no, i) => (
              <NoDaLinha
                key={no.id}
                no={no}
                ultimoDoDia={i === dia.itens.length - 1}
                poda={podas.find((p) => p.no_id === no.id) ?? null}
                aoPodar={registrar}
                aoMudar={mudar}
                aoEsquecer={esquecer}
              />
            ))}
          </ol>
        </section>
      ))}

      {proximo !== null ? (
        <div className="flex flex-col items-center" style={{ gap: 'var(--ck-space-2)' }}>
          <button
            type="button"
            onClick={() => void carregarMais()}
            disabled={carregando}
            aria-busy={carregando}
            className="ck-aperta ck-foco-fio ck-tabular"
            style={{
              minHeight: 'var(--ck-touch-min)',
              padding: '0 var(--ck-space-5)',
              borderRadius: 'var(--ck-radius-pill)',
              fontSize: 'var(--ck-text-sm)',
              border: '1px solid var(--ck-edge-functional)',
              color: 'var(--ck-text-primary)',
              opacity: carregando ? 0.6 : 1,
            }}
          >
            Mostrar mais antigos ({restantes})
          </button>
          {falhaAoCarregar ? (
            <p role="alert" style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-state-fail)' }}>
              Não consegui trazer a próxima página. Toque de novo para tentar.
            </p>
          ) : null}
        </div>
      ) : itens.length > 0 ? (
        <p style={{ textAlign: 'center', fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}>
          Isso é tudo.
        </p>
      ) : null}
    </div>
  );
}
