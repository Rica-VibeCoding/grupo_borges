import Link from 'next/link';
import { ReviewsPanel } from '../../components/reviews-panel';
import { cockpitCss } from '../../lib/cockpit-css';

export const dynamic = 'force-dynamic';

const reviewsCss = `
.reviews-shell {
  max-width: 1280px;
  margin: 0 auto;
  padding: 24px;
}
.reviews-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  margin-bottom: 14px;
  text-decoration: none;
  border: 1px solid var(--border);
  padding: 6px 12px;
  transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
}
.reviews-back:hover {
  color: var(--accent);
  border-color: var(--accent-border);
  background: var(--accent-subtle);
}

.reviews-panel {
  border: 1px solid var(--border);
  background: var(--panel);
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
}

.reviews-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 14px 18px;
  border-bottom: 1px solid var(--border);
  padding-bottom: 12px;
}

.reviews-head-left { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.reviews-head-right {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px;
}

.reviews-title {
  margin: 0;
  font-size: 14px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text);
}
.reviews-sub {
  font-size: 9px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--muted);
}

.reviews-filter { display: flex; flex-direction: column; gap: 4px; min-width: 200px; }
.reviews-filter > span {
  color: var(--muted);
  font-size: 9px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}
.reviews-filter input {
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  padding: 6px 10px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
}
.reviews-filter input:focus {
  outline: none;
  border-color: var(--accent-border);
  background: var(--accent-subtle);
}

.reviews-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  font-size: 9px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  cursor: pointer;
}
.reviews-toggle input { accent-color: var(--accent); }

.reviews-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 18px;
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--muted);
  border-bottom: 1px dashed var(--border-subtle);
  padding-bottom: 10px;
}
.reviews-stats strong {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  margin-right: 4px;
  letter-spacing: 0;
}
.stat-accept strong { color: #4cd17a; }
.stat-reject strong { color: #ff795c; }
.stat-requeue strong { color: #6dd0ff; }
.stat-autonomous strong { color: #f6b73c; }

.reviews-error { color: var(--status-blocked); font-size: 11px; }
.reviews-empty { color: var(--muted); font-size: 11px; padding: 24px 0; text-align: center; }

.reviews-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.reviews-row {
  border: 1px solid var(--border);
  background: rgba(0, 0, 0, 0.10);
}
.reviews-row[data-tone="accept"] { border-left: 3px solid #4cd17a; }
.reviews-row[data-tone="reject"] { border-left: 3px solid #ff795c; }
.reviews-row[data-tone="requeue"] { border-left: 3px solid #6dd0ff; }
.reviews-row[data-mode="agent_autonomous"] {
  background: linear-gradient(90deg, rgba(246, 183, 60, 0.06) 0%, transparent 60%);
}

.reviews-row-button {
  display: grid;
  grid-template-columns: 110px 130px 110px 110px 100px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  padding: 9px 12px;
  width: 100%;
  text-align: left;
  background: transparent;
  border: 0;
  cursor: pointer;
  color: var(--text);
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  transition: background 120ms ease;
}
.reviews-row-button:hover { background: var(--accent-subtle); }
.reviews-row-button:focus-visible { outline: 1px solid var(--accent-border); outline-offset: -1px; }

.reviews-cell { min-width: 0; overflow-wrap: anywhere; }
.reviews-task { color: var(--accent); letter-spacing: 0.04em; }
.reviews-kind { font-size: 9.5px; letter-spacing: 0.18em; text-transform: uppercase; }
.reviews-kind[data-tone="accept"] { color: #4cd17a; }
.reviews-kind[data-tone="reject"] { color: #ff795c; }
.reviews-kind[data-tone="requeue"] { color: #6dd0ff; }
.reviews-reviewer { color: var(--muted); }
.reviews-mode {
  font-size: 9px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--muted);
}
.reviews-mode[data-mode="agent_autonomous"] { color: #f6b73c; }
.reviews-mode[data-mode="agent_advisory"] { color: #6dd0ff; }
.reviews-when {
  color: var(--muted);
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: lowercase;
}
.reviews-evidence {
  display: inline-flex;
  gap: 10px;
  color: var(--muted);
  font-size: 10px;
  letter-spacing: 0;
}

.reviews-row-detail {
  border-top: 1px dashed var(--border-subtle);
  padding: 12px 16px 14px;
  background: rgba(0, 0, 0, 0.18);
}
.reviews-row-detail dl {
  display: grid;
  grid-template-columns: 160px minmax(0, 1fr);
  gap: 6px 16px;
  margin: 0;
  font-size: 11px;
}
.reviews-row-detail dt {
  color: var(--muted);
  font-size: 9px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  align-self: start;
  padding-top: 2px;
}
.reviews-row-detail dd {
  margin: 0;
  color: var(--text);
  overflow-wrap: anywhere;
}
.reviews-row-detail code {
  font-size: 10.5px;
  color: var(--accent);
}
.reviews-title-text { color: var(--muted); }
.reviews-tag {
  display: inline-block;
  margin-right: 4px;
  padding: 1px 6px;
  border: 1px solid var(--border-subtle);
  font-size: 9px;
  color: var(--muted);
}
.reviews-note {
  border-left: 2px solid var(--accent-border);
  padding: 4px 10px;
  background: rgba(0, 0, 0, 0.14);
}
.reviews-payload {
  margin: 0;
  padding: 10px;
  border: 1px solid var(--border-subtle);
  background: rgba(0, 0, 0, 0.20);
  font-family: 'JetBrains Mono', monospace;
  font-size: 10.5px;
  line-height: 1.4;
  color: var(--muted);
  overflow-x: auto;
  max-height: 280px;
}

@media (max-width: 900px) {
  .reviews-row-button {
    grid-template-columns: 1fr 1fr;
    grid-auto-rows: auto;
  }
  .reviews-evidence { grid-column: 1 / -1; }
  .reviews-row-detail dl { grid-template-columns: 1fr; }
}
`;

export default function ReviewsPage() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: cockpitCss + reviewsCss }} />
      <main className="reviews-shell">
        <Link href="/" className="reviews-back">← VOLTAR AO COCKPIT</Link>
        <ReviewsPanel />
      </main>
    </>
  );
}
