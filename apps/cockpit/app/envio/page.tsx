/**
 * Vitrine das seis fases do envio — rota de trabalho, não de produto.
 *
 * Existe pelo mesmo motivo da `/gramatica`: o motor real (`lib/envio.ts`, da
 * Tara) ainda não está plugado, e forçar cada fase aqui é a única forma de ver
 * as seis lado a lado sem esperar que uma janela de rede real produza cada
 * uma. Pavan pediu exatamente isto: "desenhe os seis estados numa vitrine com
 * estado forçado, exatamente como você fez na /gramatica".
 *
 * O QUE ESTA PÁGINA PROVA — olhe as duas primeiras linhas lado a lado, é o
 * ponto inteiro da peça: `aceito` e `confirmado` são hoje indistinguíveis no
 * cockpit (o defeito de texto pendurado sem aviso), e aqui eles têm que
 * parecer coisas diferentes SEM que você leia uma palavra — pelo fio que se
 * move, pela luz que acende, pelo filete que muda de cor.
 */
import { Composer } from '@/components/shell/composer';
import { leMotor } from '@/components/shell/motor';
import type { FaseEnvio } from '@/components/shell/aparencia-envio';

const AGENTE_DE_MENTIRA = { slug: 'daniel', name: 'Daniel' };

const MOTOR = leMotor({ modeloSessao: 'claude-opus-5', esforco: 'xhigh', podeDivergir: false });

const FASES: Array<{ fase: FaseEnvio; titulo: string; nota: string }> = [
  {
    fase: 'ocioso',
    titulo: 'Ocioso',
    nota: 'Nada em trânsito. É o estado de repouso — sem fio, sem frase.',
  },
  {
    fase: 'enviando',
    titulo: 'Enviando',
    nota: 'POST em voo. Fio percorrendo, sem frase — geralmente dura menos que o tempo de ler uma palavra.',
  },
  {
    fase: 'aceito',
    titulo: 'Aceito',
    nota:
      'O 200 voltou: colou no tmux. NÃO é sucesso — é espera. Mesmo fio de "enviando", ' +
      'e é aqui que mora o defeito de hoje: o cockpit atual chama isto de "enviado".',
  },
  {
    fase: 'confirmado',
    titulo: 'Confirmado',
    nota:
      'O eco voltou no stream — Daniel recebeu de verdade. Único estado que canta sucesso, ' +
      'e canta calado: sem frase, só o fio sumindo e a superfície acendendo.',
  },
  {
    fase: 'pendurado',
    titulo: 'Pendurado',
    nota:
      'O prazo estourou sem eco. Não é erro — é diagnóstico: o texto pode estar parado no ' +
      'campo do Daniel. O fio para NA METADE do trajeto, e reenviar é decisão sua, nunca automática.',
  },
  {
    fase: 'falhou',
    titulo: 'Falhou',
    nota: '409 ou rede. A mensagem não saiu daqui — perde o fio de luz, a mesma metáfora da falha na linha de ferramenta.',
  },
];

function Secao({
  titulo,
  nota,
  children,
}: {
  titulo: string;
  nota: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col" style={{ gap: 'var(--ck-space-2)' }}>
      <div className="flex flex-col" style={{ gap: '2px', padding: '0 var(--ck-space-3)' }}>
        <span
          style={{
            fontSize: 'var(--ck-text-xs)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--ck-track-overline)',
            color: 'var(--ck-text-secondary)',
          }}
        >
          {titulo}
        </span>
        <span style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}>{nota}</span>
      </div>
      <div style={{ padding: '0 var(--ck-space-4)' }}>{children}</div>
    </section>
  );
}

export default function EnvioPage() {
  return (
    <div
      className="flex min-h-dvh flex-col"
      style={{
        gap: 'var(--ck-space-6)',
        background: 'var(--ck-surface-canvas)',
        padding: 'calc(var(--ck-space-5) + var(--ck-safe-top)) 0 var(--ck-space-8)',
      }}
    >
      <header className="flex flex-col" style={{ gap: '2px', padding: '0 var(--ck-space-3)' }}>
        <h1
          style={{
            margin: 0,
            fontSize: 'var(--ck-text-hero)',
            lineHeight: 'var(--ck-leading-hero)',
            letterSpacing: 'var(--ck-track-hero)',
            color: 'var(--ck-text-primary)',
          }}
        >
          Seis fases, um envio
        </h1>
        <p style={{ margin: 0, fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}>
          Aceito × confirmado é o par que importa — compare as duas primeiras linhas.
        </p>
      </header>

      {FASES.map(({ fase, titulo, nota }) => (
        <Secao key={fase} titulo={titulo} nota={nota}>
          <Composer
            agentSlug={AGENTE_DE_MENTIRA.slug}
            agentName={AGENTE_DE_MENTIRA.name}
            motor={MOTOR}
            esforcoValor="xhigh"
            esforcoPermitido={['low', 'medium', 'high', 'xhigh', 'max']}
            faseForcada={fase}
          />
        </Secao>
      ))}
    </div>
  );
}
