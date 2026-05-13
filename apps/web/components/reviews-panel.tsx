'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchReviews } from '../lib/api';
import type { ReviewEvent } from '../lib/cockpit-types';
import { formatDateTime } from '../lib/format-time';

const KIND_LABEL: Record<ReviewEvent['kind'], { label: string; tone: string }> = {
  'review.accepted': { label: 'ACEITA', tone: 'accept' },
  'review.rejected': { label: 'REJEITADA', tone: 'reject' },
  'review.requeued': { label: 'REENFILEIRADA', tone: 'requeue' },
};

function formatRelative(deltaSec: number): string {
  if (deltaSec < 60) return `${deltaSec}s atrás`;
  const m = Math.floor(deltaSec / 60);
  if (m < 60) return `${m}min atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  const d = Math.floor(h / 24);
  return `${d}d atrás`;
}

function payloadAt(payload: Record<string, unknown> | null, key: string): string | null {
  if (!payload) return null;
  const val = payload[key];
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) return `${val.length}`;
  if (typeof val === 'object') return `${Object.keys(val).length}`;
  return null;
}

export function ReviewsPanel() {
  const [events, setEvents] = useState<ReviewEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewerFilter, setReviewerFilter] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [serverNow, setServerNow] = useState<number>(() => Math.floor(Date.now() / 1000));

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchReviews(
          { reviewer: reviewerFilter || null, limit: 50 },
          signal,
        );
        setEvents(res.events);
        setServerNow(Math.floor(Date.now() / 1000));
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [reviewerFilter],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    let activeCtrl: AbortController | null = null;
    const handle = setInterval(() => {
      activeCtrl?.abort();
      activeCtrl = new AbortController();
      void load(activeCtrl.signal);
    }, 15_000);
    return () => {
      clearInterval(handle);
      activeCtrl?.abort();
    };
  }, [autoRefresh, load]);

  const filtered = useMemo(() => {
    if (!reviewerFilter) return events;
    return events.filter(
      (ev) => ev.agent_slug === reviewerFilter || ev.reviewer_assignee === reviewerFilter,
    );
  }, [events, reviewerFilter]);

  const counts = useMemo(() => {
    const c = { accept: 0, reject: 0, requeue: 0, autonomous: 0 };
    for (const ev of filtered) {
      if (ev.kind === 'review.accepted') c.accept += 1;
      if (ev.kind === 'review.rejected') c.reject += 1;
      if (ev.kind === 'review.requeued') c.requeue += 1;
      if (ev.review_mode === 'agent_autonomous') c.autonomous += 1;
    }
    return c;
  }, [filtered]);

  return (
    <div className="reviews-panel mono">
      <header className="reviews-head">
        <div className="reviews-head-left">
          <h1 className="reviews-title">REVIEWS · TRUST BUT VERIFY</h1>
          <span className="reviews-sub">audit trail das últimas decisões de revisão</span>
        </div>
        <div className="reviews-head-right">
          <label className="reviews-filter">
            <span>FILTRO</span>
            <input
              type="text"
              value={reviewerFilter}
              onChange={(e) => setReviewerFilter(e.currentTarget.value)}
              placeholder="slug do revisor (vazio = todos)"
              spellCheck={false}
            />
          </label>
          <label className="reviews-toggle">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.currentTarget.checked)}
            />
            <span>AUTO 15s</span>
          </label>
          <button
            type="button"
            className="form-submit"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? 'CARREGANDO...' : '↻ ATUALIZAR'}
          </button>
        </div>
      </header>

      <div className="reviews-stats">
        <span><strong>{filtered.length}</strong> eventos</span>
        <span className="stat-accept"><strong>{counts.accept}</strong> aceitas</span>
        <span className="stat-reject"><strong>{counts.reject}</strong> rejeitadas</span>
        <span className="stat-requeue"><strong>{counts.requeue}</strong> reenfileiradas</span>
        <span className="stat-autonomous"><strong>{counts.autonomous}</strong> autonomous</span>
      </div>

      {error && (
        <p className="reviews-error">erro: {error}</p>
      )}

      {!error && filtered.length === 0 && !loading && (
        <p className="reviews-empty">nenhum evento de review no buffer{reviewerFilter ? ` pra "${reviewerFilter}"` : ''}.</p>
      )}

      <ol className="reviews-list">
        {filtered.map((ev) => {
          const meta = KIND_LABEL[ev.kind];
          const reviewer = ev.agent_slug || (typeof ev.payload?.reviewer === 'string' ? ev.payload.reviewer : '—');
          const taskRef = ev.human_id || ev.task_id.slice(0, 8);
          const evidenceCount = payloadAt(ev.payload, 'evidence_refs');
          const criteria = payloadAt(ev.payload, 'criteria_results');
          const note = payloadAt(ev.payload, 'note');
          const isOpen = expanded === ev.id;
          return (
            <li key={ev.id} className="reviews-row" data-tone={meta.tone} data-mode={ev.review_mode ?? 'human'}>
              <button
                type="button"
                className="reviews-row-button"
                onClick={() => setExpanded((cur) => (cur === ev.id ? null : ev.id))}
                aria-expanded={isOpen}
              >
                <span className="reviews-cell reviews-task">{taskRef}</span>
                <span className="reviews-cell reviews-kind" data-tone={meta.tone}>{meta.label}</span>
                <span className="reviews-cell reviews-reviewer">{reviewer}</span>
                <span className="reviews-cell reviews-mode" data-mode={ev.review_mode ?? 'human'}>
                  {(ev.review_mode ?? 'human').replace('agent_', '')}
                </span>
                <span className="reviews-cell reviews-when">{formatRelative(Math.max(0, serverNow - ev.created_at))}</span>
                <span className="reviews-cell reviews-evidence">
                  {evidenceCount !== null && <span title="evidence_refs">📎 {evidenceCount}</span>}
                  {criteria !== null && <span title="criteria_results">⚙️ {criteria}</span>}
                </span>
              </button>

              {isOpen && (
                <div className="reviews-row-detail">
                  <dl>
                    <dt>task</dt>
                    <dd>
                      <code>{ev.task_id}</code>
                      {ev.title && <span className="reviews-title-text"> — {ev.title}</span>}
                    </dd>
                    <dt>assignee</dt>
                    <dd>{ev.assignee || '—'}</dd>
                    <dt>reviewer_assignee</dt>
                    <dd>{ev.reviewer_assignee || '— (Rica)'}</dd>
                    <dt>tags</dt>
                    <dd>
                      {ev.tags && ev.tags.length > 0
                        ? ev.tags.map((t) => <span key={t} className="reviews-tag">{t}</span>)
                        : '—'}
                    </dd>
                    <dt>data</dt>
                    <dd>{formatDateTime(ev.created_at)} ({ev.created_at})</dd>
                    {note && (<>
                      <dt>nota</dt>
                      <dd className="reviews-note">{note}</dd>
                    </>)}
                    <dt>payload completo</dt>
                    <dd>
                      <pre className="reviews-payload">{JSON.stringify(ev.payload, null, 2)}</pre>
                    </dd>
                  </dl>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
