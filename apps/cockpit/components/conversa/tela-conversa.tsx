'use client';

import Link from 'next/link';

import type { Estado } from '@/lib/conversa/tipos';

import { OndaConversa } from './onda-conversa';
import { useModoConversa } from './use-modo-conversa';

type Leitura = { titulo: string; detalhe: string };

function leituraDoEstado(
  estado: Estado,
  falaDetectada: boolean,
  abrindoMicrofone: boolean,
): Leitura {
  if (abrindoMicrofone) {
    return { titulo: 'Liberando o microfone', detalhe: 'Autorize o acesso para começar.' };
  }
  switch (estado) {
    case 'parado':
      return { titulo: 'Conversa por voz', detalhe: 'Um toque inicia. Depois, é só falar.' };
    case 'ouvindo':
      return falaDetectada
        ? { titulo: 'Estou ouvindo você', detalhe: 'Pode continuar. Eu percebo quando a frase terminar.' }
        : { titulo: 'Pode falar', detalhe: 'O microfone está aberto.' };
    case 'transcrevendo':
      return { titulo: 'Entendendo sua fala', detalhe: 'A conversa continua sozinha.' };
    case 'esperandoZe':
      return { titulo: 'O agente está pensando', detalhe: 'A resposta vai tocar assim que chegar.' };
    case 'falando':
      return { titulo: 'O agente está respondendo', detalhe: 'Quando ele terminar, volto a ouvir você.' };
    case 'erro':
      return { titulo: 'A conversa parou', detalhe: 'Confira o aviso e toque para retomar.' };
  }
}

export function TelaConversa({ slug, nome }: { slug: string; nome: string }) {
  const modo = useModoConversa(slug);
  const preparando = modo.preparacao === 'preparando';
  const ativa = modo.conversa.estado !== 'parado' && modo.conversa.estado !== 'erro';
  const leitura = preparando
    ? { titulo: 'Preparando a conversa', detalhe: 'Baixando o detector de voz neste aparelho.' }
    : modo.preparacao === 'falhou'
      ? { titulo: 'O detector não carregou', detalhe: 'Recarregue a página para tentar novamente.' }
      : leituraDoEstado(modo.conversa.estado, modo.falaDetectada, modo.abrindoMicrofone);
  const aviso = modo.aviso ?? modo.erroPreparacao;

  return (
    <main
      className="flex flex-col"
      style={{
        minHeight: '100dvh',
        background: 'var(--ck-surface-canvas)',
        color: 'var(--ck-text-primary)',
        paddingTop: 'calc(var(--ck-space-3) + var(--ck-safe-top))',
        paddingRight: 'calc(var(--ck-space-4) + var(--ck-safe-right))',
        paddingBottom: 'calc(var(--ck-space-4) + var(--ck-safe-bottom))',
        paddingLeft: 'calc(var(--ck-space-4) + var(--ck-safe-left))',
      }}
    >
      <header className="mx-auto flex w-full max-w-xl items-center justify-between">
        <Link
          href={`/agente/${slug}`}
          className="ck-veil inline-flex items-center"
          style={{
            minHeight: 'var(--ck-touch-min)',
            padding: '0 var(--ck-space-3)',
            marginLeft: 'calc(var(--ck-space-3) * -1)',
            borderRadius: 'var(--ck-radius-chip)',
            color: 'var(--ck-text-secondary)',
            fontSize: 'var(--ck-text-sm)',
          }}
        >
          ← Voltar
        </Link>
        <span
          className="truncate"
          style={{ color: 'var(--ck-text-secondary)', fontSize: 'var(--ck-text-sm)' }}
        >
          {nome}
        </span>
      </header>

      <section className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center text-center">
        <div aria-live="polite" aria-atomic="true">
          <h1
            className="leading-hero tracking-hero"
            style={{ fontSize: 'var(--ck-text-hero)', fontWeight: 520 }}
          >
            {leitura.titulo}
          </h1>
          <p
            className="mx-auto max-w-md"
            style={{
              marginTop: 'var(--ck-space-2)',
              color: 'var(--ck-text-secondary)',
              fontSize: 'var(--ck-text-base)',
            }}
          >
            {leitura.detalhe}
          </p>
        </div>

        <div className="w-full" style={{ margin: 'var(--ck-space-6) 0' }}>
          <OndaConversa
            estado={modo.conversa.estado}
            nivel={modo.nivel}
            preparando={preparando}
          />
        </div>

        {ativa ? (
          <button
            type="button"
            onClick={modo.parar}
            className="ck-veil inline-flex items-center justify-center border"
            style={{
              minHeight: 'var(--ck-touch-min)',
              padding: '0 var(--ck-space-5)',
              borderRadius: 'var(--ck-radius-caixa)',
              borderColor: 'var(--ck-edge-functional)',
              color: 'var(--ck-text-primary)',
              fontSize: 'var(--ck-text-md)',
            }}
          >
            Encerrar conversa
          </button>
        ) : (
          <button
            type="button"
            onClick={modo.comecar}
            disabled={modo.preparacao !== 'pronto'}
            className="inline-flex items-center justify-center border disabled:cursor-wait"
            style={{
              minHeight: 'var(--ck-touch-min)',
              padding: '0 var(--ck-space-5)',
              borderRadius: 'var(--ck-radius-caixa)',
              borderColor: modo.preparacao === 'pronto'
                ? 'var(--ck-text-primary)'
                : 'var(--ck-edge-functional)',
              background: modo.preparacao === 'pronto'
                ? 'var(--ck-text-primary)'
                : 'var(--ck-surface-composer)',
              color: modo.preparacao === 'pronto'
                ? 'var(--ck-surface-canvas)'
                : 'var(--ck-text-secondary)',
              fontSize: 'var(--ck-text-md)',
              fontWeight: 600,
            }}
          >
            {preparando
              ? 'Preparando…'
              : modo.preparacao === 'falhou'
                ? 'Detector indisponível'
                : modo.conversa.estado === 'erro'
                  ? 'Tentar novamente'
                  : 'Começar conversa'}
          </button>
        )}

        {aviso ? (
          <p
            role="alert"
            className="max-w-md"
            style={{
              marginTop: 'var(--ck-space-4)',
              color: 'var(--ck-state-fail)',
              fontSize: 'var(--ck-text-sm)',
            }}
          >
            {aviso}
          </p>
        ) : null}

        {modo.ultimaTranscricao ? (
          <p
            className="max-w-md"
            style={{
              marginTop: 'var(--ck-space-4)',
              color: 'var(--ck-text-secondary)',
              fontSize: 'var(--ck-text-sm)',
            }}
          >
            Você: “{modo.ultimaTranscricao}”
          </p>
        ) : null}
      </section>

      <footer
        className="mx-auto flex w-full max-w-xl flex-wrap items-center justify-center"
        style={{ gap: 'var(--ck-space-3)', color: 'var(--ck-text-secondary)', fontSize: 'var(--ck-text-xs)' }}
      >
        {modo.tempoCargaMs !== null ? (
          <span>Detector pronto em {(modo.tempoCargaMs / 1000).toFixed(1)} s</span>
        ) : null}
        {ativa && modo.wakeLockSuportado ? (
          <span>
            {modo.wakeLockAtivo
              ? 'Tela mantida acesa'
              : modo.wakeLockFalhou
                ? 'Não consegui manter a tela acesa'
                : 'Mantendo a tela acesa…'}
          </span>
        ) : null}
        {!modo.wakeLockSuportado ? <span>Este navegador não mantém a tela acesa</span> : null}
        {modo.streamStatus === 'reconnecting' ? <span>Reconectando ao agente…</span> : null}
      </footer>
    </main>
  );
}
