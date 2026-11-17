/**
 * O que o dedo não faz no quadro: digitar, as teclas Enter/Tab/Apagar e trocar
 * de aba. Só aparece no controle. O campo é um input de verdade (16px), então o
 * teclado do iPhone abre; "Digitar" manda o texto ao campo que o Rica tocou no
 * quadro, sem Enter — o Enter é botão próprio, para o Submit não sair sem querer.
 *
 * Dono: Daniel (pele).
 */
'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { fetchAbas, type Aba, type Entrada } from '@/lib/tela-agente';

const TECLAS = [
  { tecla: 'Enter', rotulo: 'Enter' },
  { tecla: 'Tab', rotulo: 'Tab' },
  { tecla: 'Backspace', rotulo: 'Apagar' },
] as const;

export function TecladoDaTela({
  sessao,
  abaAtual,
  enviar,
}: {
  sessao: string | null;
  abaAtual: string | null;
  enviar: (entrada: Entrada) => Promise<boolean>;
}) {
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [abas, setAbas] = useState<Aba[]>([]);
  const [focado, setFocado] = useState<'campo' | 'abas' | null>(null);
  const campo = useRef<HTMLInputElement>(null);
  const idDoCampo = useId();
  const idDasAbas = useId();

  // A lista de abas é lida ao assumir e a cada troca de aba vista no quadro.
  useEffect(() => {
    if (!sessao) return;
    let vivo = true;
    fetchAbas(sessao)
      .then((lista) => vivo && setAbas(lista))
      .catch(() => vivo && setAbas([]));
    return () => {
      vivo = false;
    };
  }, [sessao, abaAtual]);

  async function digita(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;
    // Vazio não manda nada: o foco vai ao campo, que é o próximo passo.
    if (!texto) return campo.current?.focus();
    setEnviando(true);
    if (await enviar({ tipo: 'texto', texto })) setTexto('');
    setEnviando(false);
  }

  return (
    <div className="flex flex-col" style={{ gap: 'var(--ck-space-3)' }}>
      <form onSubmit={digita} className="flex flex-col" style={{ gap: 'var(--ck-space-2)' }}>
        <label htmlFor={idDoCampo} className="text-pretty" style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}>
          Toque num campo da tela e escreva aqui o que vai nele
        </label>
        <div className="flex items-center" style={{ gap: 'var(--ck-space-2)' }}>
          <input
            ref={campo}
            id={idDoCampo}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            maxLength={4096}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="send"
            onFocus={() => setFocado('campo')}
            onBlur={() => setFocado(null)}
            className="min-w-0 flex-1"
            style={{
              minHeight: 'var(--ck-touch-min)',
              padding: '0 var(--ck-space-4)',
              borderRadius: 'var(--ck-radius-pill)',
              background: 'var(--ck-surface-composer)',
              // Foco sem anel (estética §9.17): a própria borda clareia.
              border: `1px solid ${focado === 'campo' ? 'var(--ck-text-secondary)' : 'var(--ck-edge-functional)'}`,
              color: 'var(--ck-text-primary)',
              fontSize: 'var(--ck-text-md)',
            }}
          />
          <Tecla tipo="submit" ocupada={enviando}>
            Digitar
          </Tecla>
        </div>
      </form>

      <div className="flex flex-wrap items-center" style={{ gap: 'var(--ck-space-2)' }}>
        {TECLAS.map((t) => (
          <Tecla key={t.tecla} aoTocar={() => void enviar({ tipo: 'tecla', tecla: t.tecla })} rotuloAcessivel={`Apertar ${t.rotulo}`}>
            {t.rotulo}
          </Tecla>
        ))}
      </div>

      {abas.length > 1 ? (
        <div className="flex items-center" style={{ gap: 'var(--ck-space-3)' }}>
          <label htmlFor={idDasAbas} className="shrink-0" style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}>
            Aba
          </label>
          <select
            id={idDasAbas}
            value={abaAtual ?? ''}
            onChange={(e) => void enviar({ tipo: 'aba', aba: e.target.value })}
            onFocus={() => setFocado('abas')}
            onBlur={() => setFocado(null)}
            className="min-w-0 flex-1 truncate"
            style={{
              minHeight: 'var(--ck-touch-min)',
              padding: '0 var(--ck-space-3)',
              borderRadius: 'var(--ck-radius-frame)',
              background: 'var(--ck-surface-composer)',
              border: `1px solid ${focado === 'abas' ? 'var(--ck-text-secondary)' : 'var(--ck-edge-functional)'}`,
              color: 'var(--ck-text-primary)',
              fontSize: 'var(--ck-text-md)',
            }}
          >
            {abas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.titulo || a.url}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}

function Tecla({
  children,
  aoTocar,
  rotuloAcessivel,
  tipo = 'button',
  ocupada = false,
}: {
  children: ReactNode;
  aoTocar?: () => void;
  rotuloAcessivel?: string;
  tipo?: 'button' | 'submit';
  ocupada?: boolean;
}) {
  return (
    <button
      type={tipo}
      onClick={aoTocar}
      disabled={ocupada}
      aria-label={rotuloAcessivel}
      aria-busy={ocupada || undefined}
      className="ck-veil ck-foco-fio flex shrink-0 items-center justify-center"
      style={{
        minHeight: 'var(--ck-touch-min)',
        minWidth: '4.5rem',
        padding: '0 var(--ck-space-4)',
        borderRadius: 'var(--ck-radius-pill)',
        background: 'var(--ck-surface-composer)',
        border: '1px solid var(--ck-edge-functional)',
        color: 'var(--ck-text-primary)',
        fontSize: 'var(--ck-text-sm)',
        fontWeight: 500,
      }}
    >
      {children}
    </button>
  );
}
