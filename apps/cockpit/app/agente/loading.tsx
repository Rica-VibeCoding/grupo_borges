import { BarraDeTelas } from '@/components/shell/barra-de-telas';

export default function Loading() {
  return (
    <>
      <BarraDeTelas
        telas={[{ rotulo: 'Chat', ativa: true }]}
        abrirNavHref="?nav=aberto"
        fecharNavHref="?"
        navAberta={false}
        hrefAbrirPainel="?painel=detalhes"
        hrefFecharPainel="?"
        painelAberto={false}
      />
      <div
        className="relative min-h-0 flex-1"
        aria-busy="true"
        aria-label="Carregando conversa"
      >
        <div
          className="absolute inset-0"
          style={{ background: 'var(--ck-surface-canvas)' }}
        />
      </div>
    </>
  );
}
