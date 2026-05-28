'use client';

// AskUserCard — UI da feature `ask-user` MCP. Substitui o card nativo do CC
// (`AskUserQuestion`) que não bloqueia a sessão. O MCP server bloqueia o CC
// esperando POST /api/ask_user/answer/{request_id}; este componente é a UI
// dessa resposta.
//
// Visual: card escuro próprio (NÃO um OneLineChip — perguntas precisam de
// área respirável, opções clicáveis grandes e textarea). Reusa tokens de
// cor e a animação `one-line-chip-breathing` via `data-tone="active"`
// aplicada manualmente. Borda esquerda laranja piscando enquanto pending.
//
// Multi-pergunta: navega 1 por vez (contador "1/3"). Single-select avança
// no clique; multi-select expõe checkboxes + botão "Enviar" só na última.
// Opção "Outro" no fim de cada lista abre um textarea inline.
//
// Estado pós-submit (`answered`): mostra resumo "respondido com: X" sem
// removere o card — Rica quer ver a decisão no histórico do chat.

import { memo, useCallback, useMemo, useState } from 'react';
import type { AskUserEntry, AskUserQuestion } from '../lib/messages-types';

export type AskUserCardProps = {
  entry: AskUserEntry;
  onSubmit: (answers: string[]) => Promise<void>;
  /** Permite o caller dispensar o card (visual only por agora — não envia
   *  cancelamento pro backend; o CC continua bloqueado até timeout). */
  onDismiss?: () => void;
};

const FREEFORM_LABEL = 'Outro';

function isMulti(q: AskUserQuestion): boolean {
  return Boolean(q.multiSelect);
}

export const AskUserCard = memo(function AskUserCard({
  entry,
  onSubmit,
  onDismiss,
}: AskUserCardProps) {
  const { questions, status } = entry;
  const total = questions.length;
  const isPending = status === 'pending';

  // Índice da pergunta atual (multi-pergunta). Reset a cada novo entry — o
  // React desmonta quando request_id muda (key no parent).
  const [idx, setIdx] = useState(0);
  // Respostas acumuladas por índice — string única por pergunta (multiSelect
  // junta com ", ").
  const [answers, setAnswers] = useState<string[]>(() => Array(total).fill(''));
  // Multi-select: set de labels selecionados na pergunta atual.
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());
  // "Outro" expandido + texto livre da pergunta atual.
  const [freeformOpen, setFreeformOpen] = useState(false);
  const [freeformText, setFreeformText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = questions[idx];
  const isLast = idx === total - 1;
  const multi = current ? isMulti(current) : false;

  const resetQuestionState = useCallback(() => {
    setMultiSelected(new Set());
    setFreeformOpen(false);
    setFreeformText('');
  }, []);

  const buildCurrentAnswer = useCallback((): string => {
    if (multi) {
      const parts: string[] = [];
      for (const label of multiSelected) parts.push(label);
      if (freeformOpen && freeformText.trim()) parts.push(freeformText.trim());
      return parts.join(', ');
    }
    // Single: a resposta é setada direto pelo handleOptionClick (sem botão).
    // Aqui cobre o caso de só "Outro" preenchido + clicar Enviar.
    if (freeformOpen && freeformText.trim()) return freeformText.trim();
    return answers[idx] ?? '';
  }, [multi, multiSelected, freeformOpen, freeformText, answers, idx]);

  const finalize = useCallback(
    async (allAnswers: string[]) => {
      if (submitting) return;
      setSubmitting(true);
      setError(null);
      try {
        await onSubmit(allAnswers);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setSubmitting(false);
      }
      // Sucesso: o backend reemite o entry como `answered`; o pai re-renderiza
      // e isso desmonta o card de submitting. Não setamos `submitting=false`
      // pra evitar flicker no caminho feliz.
    },
    [onSubmit, submitting],
  );

  const commitAndAdvance = useCallback(
    (answerForCurrent: string) => {
      const nextAnswers = [...answers];
      nextAnswers[idx] = answerForCurrent;
      setAnswers(nextAnswers);
      if (isLast) {
        void finalize(nextAnswers);
        return;
      }
      setIdx(idx + 1);
      resetQuestionState();
    },
    [answers, idx, isLast, finalize, resetQuestionState],
  );

  const handleOptionClick = useCallback(
    (label: string) => {
      if (!isPending || submitting) return;
      if (multi) {
        const next = new Set(multiSelected);
        if (next.has(label)) next.delete(label);
        else next.add(label);
        setMultiSelected(next);
        return;
      }
      // Single: avança no clique.
      commitAndAdvance(label);
    },
    [isPending, submitting, multi, multiSelected, commitAndAdvance],
  );

  const handleFreeformToggle = useCallback(() => {
    if (!isPending || submitting) return;
    setFreeformOpen((prev) => !prev);
  }, [isPending, submitting]);

  const handleSubmitClick = useCallback(() => {
    if (!isPending || submitting) return;
    const ans = buildCurrentAnswer();
    if (!ans) {
      setError('Selecione uma opção ou preencha "Outro".');
      return;
    }
    commitAndAdvance(ans);
  }, [isPending, submitting, buildCurrentAnswer, commitAndAdvance]);

  const handleBack = useCallback(() => {
    if (!isPending || submitting || idx === 0) return;
    setIdx(idx - 1);
    resetQuestionState();
  }, [isPending, submitting, idx, resetQuestionState]);

  // Estado answered/timeout: mostra resumo das respostas; sem interações.
  const answeredSummary = useMemo(() => {
    if (status !== 'answered') return null;
    const out = entry.answers ?? [];
    return out.map((a, i) => ({
      question: questions[i]?.question ?? `pergunta ${i + 1}`,
      answer: a,
    }));
  }, [status, entry.answers, questions]);

  if (!current && status === 'pending') {
    // Defensivo: questions vazio. Nada a renderizar útil.
    return null;
  }

  const dataTone = isPending ? 'active' : status === 'timeout' ? 'stalled' : 'completed';

  return (
    <div className="ask-user-card" data-tone={dataTone} data-status={status}>
      <div className="ask-user-card-head">
        {total > 1 && (
          <span className="ask-user-card-counter mono">
            {idx + 1}/{total}
          </span>
        )}
        {current?.header && (
          <span className="ask-user-card-header">{current.header}</span>
        )}
        <div className="ask-user-card-head-spacer" />
        {onDismiss && isPending && (
          <button
            type="button"
            className="ask-user-card-dismiss"
            onClick={onDismiss}
            aria-label="Dispensar"
          >
            ×
          </button>
        )}
      </div>

      {status === 'answered' && answeredSummary && (
        <div className="ask-user-card-answered">
          {answeredSummary.map((row, i) => (
            <div key={i} className="ask-user-card-answered-row">
              <span className="ask-user-card-answered-q">{row.question}</span>
              <span className="ask-user-card-answered-a mono">{row.answer || '—'}</span>
            </div>
          ))}
        </div>
      )}

      {status === 'timeout' && (
        <div className="ask-user-card-timeout">
          Tempo esgotado — agente seguiu sem resposta.
        </div>
      )}

      {isPending && current && (
        <>
          <div className="ask-user-card-question">{current.question}</div>

          <div className="ask-user-card-options" role={multi ? 'group' : 'radiogroup'}>
            {current.options.map((opt, i) => {
              const selected = multi && multiSelected.has(opt.label);
              return (
                <button
                  type="button"
                  key={`${opt.label}:${i}`}
                  className="ask-user-card-option"
                  data-selected={selected ? '1' : '0'}
                  onClick={() => handleOptionClick(opt.label)}
                  disabled={submitting}
                  role={multi ? 'checkbox' : 'radio'}
                  aria-checked={multi ? selected : undefined}
                >
                  {multi && (
                    <span className="ask-user-card-check" aria-hidden="true">
                      {selected ? '☑' : '☐'}
                    </span>
                  )}
                  <span className="ask-user-card-option-body">
                    <span className="ask-user-card-option-label">{opt.label}</span>
                    {opt.description && (
                      <span className="ask-user-card-option-desc">{opt.description}</span>
                    )}
                  </span>
                </button>
              );
            })}

            <button
              type="button"
              className="ask-user-card-option ask-user-card-option-freeform"
              data-selected={freeformOpen ? '1' : '0'}
              onClick={handleFreeformToggle}
              disabled={submitting}
            >
              <span className="ask-user-card-option-body">
                <span className="ask-user-card-option-label">{FREEFORM_LABEL}</span>
                <span className="ask-user-card-option-desc">resposta livre</span>
              </span>
            </button>

            {freeformOpen && (
              <textarea
                className="ask-user-card-freeform"
                value={freeformText}
                onChange={(e) => setFreeformText(e.target.value)}
                placeholder="Sua resposta…"
                rows={3}
                disabled={submitting}
                autoFocus
              />
            )}
          </div>

          {error && <div className="ask-user-card-error">{error}</div>}

          <div className="ask-user-card-actions">
            {idx > 0 && (
              <button
                type="button"
                className="ask-user-card-btn ask-user-card-btn-ghost"
                onClick={handleBack}
                disabled={submitting}
              >
                ← Voltar
              </button>
            )}
            <div className="ask-user-card-actions-spacer" />
            {(multi || freeformOpen) && (
              <button
                type="button"
                className="ask-user-card-btn ask-user-card-btn-primary"
                onClick={handleSubmitClick}
                disabled={submitting}
              >
                {submitting ? 'Enviando…' : isLast ? 'Enviar' : 'Próxima →'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
});
