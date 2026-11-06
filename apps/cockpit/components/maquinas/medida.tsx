/**
 * As células numéricas da tela Abertos: a Medida (CPU, RAM, tempo parado) e a
 * Atividade, que troca o traço por um girador âmbar quando o item está em uso.
 *
 * Dono: Daniel (pele).
 */
import { atividade } from '@/lib/maquinas';

const NUMERO = { fontSize: 'var(--ck-text-sm)', textAlign: 'right', whiteSpace: 'nowrap' } as const;

/** Uma coluna numérica. O rótulo só existe para leitor de tela: quem enxerga lê o cabeçalho. */
export function Medida({ rotulo, valor, cor, classe = '' }: { rotulo: string; valor: string; cor: string; classe?: string }) {
  return (
    <span className={`ck-tabular ${classe}`} style={{ ...NUMERO, color: cor }}>
      <span className="sr-only">{rotulo}: </span>
      {valor === '—' ? (
        <>
          <span aria-hidden="true">—</span>
          <span className="sr-only">sem dado</span>
        </>
      ) : (
        valor
      )}
    </span>
  );
}

/**
 * A coluna Atividade. Em uso: girador âmbar do tamanho do texto (parado, vira ponto, com
 * movimento reduzido); parado: o tempo; o painel ainda não viu: traço.
 */
export function CelulaDaAtividade({ parado_s, observadoDesde, agora }: { parado_s: number | null; observadoDesde: number; agora: number }) {
  const a = atividade(parado_s, observadoDesde, agora);
  if (a.estado !== 'em-uso') {
    return <Medida rotulo="Atividade" classe="ck-abertos-atividade" valor={a.estado === 'parado' ? a.texto : '—'} cor="var(--ck-text-secondary)" />;
  }
  return (
    <span className="flex justify-end">
      <span role="img" aria-label="Atividade: em uso" title="em uso" className="ck-abertos-girador" />
    </span>
  );
}
