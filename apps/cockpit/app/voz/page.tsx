/**
 * Vitrine da captura de voz — rota de trabalho, não de produto.
 *
 * Mesmo motivo da `/envio` e da `/gramatica`: sem microfone aberto e permissão
 * concedida não há como VER estas fases, e "não dá pra conferir antes de subir"
 * é exatamente a condição em que um defeito passa. Aqui as sete aparecem juntas.
 *
 * O QUE ESTA PÁGINA PROVA. A pergunta que o despacho fez é "como se cancela, e
 * dá pra descobrir sem manual?". Compare `gravando` com `prestes a cancelar`:
 * a instrução já está escrita na tela quando o gesto começa, e a segunda linha
 * inteira muda de cor antes de soltar. Ninguém precisa saber de nada de
 * antemão, e ninguém descarta um áudio por engano — porque a tela avisa ANTES
 * do dedo levantar, não depois.
 */
import { Composer } from '@/components/shell/composer';
import { leMotor } from '@/components/shell/motor';
import type { FaseVoz } from '@/components/shell/voz';

const AGENTE_DE_MENTIRA = { slug: 'daniel', name: 'Daniel' };
const MOTOR = leMotor({ modeloSessao: 'claude-opus-5', esforco: 'xhigh', podeDivergir: false });

const FASES: Array<{ fase: FaseVoz; segundos: number; titulo: string; nota: string }> = [
  {
    fase: 'ociosa',
    segundos: 0,
    titulo: 'Parado',
    nota:
      'Campo vazio. O botão sólido é a ONDA, não a seta — sem texto não há o que enviar, ' +
      'e é a referência do Codex que resolve assim. O microfone deixou de ser um ícone de 17px ' +
      'ao lado: virou o alvo grande, que é o mínimo pro gesto mais usado do Rica.',
  },
  {
    fase: 'pedindo',
    segundos: 0,
    titulo: 'Pedindo o microfone',
    nota:
      'Só na primeira vez, enquanto o diálogo do sistema está aberto. Se o dedo soltar aqui ' +
      '(e ele solta, pra tocar em "Permitir"), a gravação não começa e o microfone fecha na hora — ' +
      'a tela pede pra segurar de novo em vez de gravar zero segundo.',
  },
  {
    fase: 'gravando',
    segundos: 7,
    titulo: 'Gravando',
    nota:
      'AS DUAS SAÍDAS ESTÃO ESCRITAS enquanto o gesto acontece — é isso que dispensa manual. ' +
      'A onda é a única prova de que o microfone capta de verdade: sem ela, "gravando" é palavra, ' +
      'e palavra não distingue microfone vivo de microfone mudo.',
  },
  {
    fase: 'cancelando',
    segundos: 9,
    titulo: 'Prestes a cancelar',
    nota:
      'O dedo passou do limiar à esquerda. Moldura, onda, duração e instrução mudam JUNTAS para ' +
      'vermelho, e a frase diz o que soltar faz. O aviso chega antes do dedo levantar — depois ' +
      'seria só uma notícia ruim.',
  },
  {
    fase: 'travada',
    segundos: 42,
    titulo: 'Travada (mãos livres)',
    nota:
      'Arrastou pra cima e soltou. O gesto acabou e a tela volta a ter botões de verdade: ' +
      'Descartar à esquerda, enviar sólido à direita. Não existe estado em que a única saída ' +
      'seja um movimento secreto.',
  },
  {
    fase: 'travada',
    segundos: 156,
    titulo: 'Travada, áudio longo',
    nota:
      'Passou de 2min30. A duração muda de cor e a linha avisa: o STT do servidor tem 30s de ' +
      'teto e áudio muito longo estoura. Avisar durante custa nada; perder cinco minutos de fala ' +
      'custa cinco minutos de fala.',
  },
  {
    fase: 'transcrevendo',
    segundos: 0,
    titulo: 'Transcrevendo',
    nota:
      'O tempo morto entre soltar e o texto existir — o STT roda NO SERVIDOR. O fio na base é o ' +
      'mesmo do envio, de propósito: é uma pergunta só ("a máquina está trabalhando?") e ela ' +
      'merece uma linguagem só, da fala até o agente receber.',
  },
  {
    fase: 'impedida',
    segundos: 0,
    titulo: 'Microfone bloqueado',
    nota:
      'Nunca um botão que não responde. Sempre duas coisas: o que aconteceu e ONDE mexer — ' +
      '"permissão negada" sozinho manda o Rica adivinhar em qual tela de ajuste do iPhone ele ' +
      'entra. O outro caso desta fase é abrir o cockpit pelo IP em vez do nome .ts.net.',
  },
];

function Secao({ titulo, nota, children }: { titulo: string; nota: string; children: React.ReactNode }) {
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

export default function VozPage() {
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
          Segure para falar
        </h1>
        <p style={{ margin: 0, fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}>
          Arraste ← para cancelar, ↑ para travar. As duas saídas aparecem durante o gesto.
        </p>
      </header>

      {FASES.map(({ fase, segundos, titulo, nota }) => (
        <Secao key={`${fase}-${segundos}`} titulo={titulo} nota={nota}>
          <Composer
            agentSlug={AGENTE_DE_MENTIRA.slug}
            agentName={AGENTE_DE_MENTIRA.name}
            motor={MOTOR}
            esforcoValor="xhigh"
            esforcoPermitido={['low', 'medium', 'high', 'xhigh', 'max']}
            vozForcada={fase}
            segundosForcados={segundos}
          />
        </Secao>
      ))}
    </div>
  );
}
