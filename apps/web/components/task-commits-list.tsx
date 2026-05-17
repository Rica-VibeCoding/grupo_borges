'use client';

import { useEffect, useState } from 'react';

type TaskCommit = {
  sha: string;
  repo: string;
  message: string;
  author: string;
  committed_at: number;
};

type Props = {
  taskId: string;
};

const GITHUB_BASE = 'https://github.com/Rica-VibeCoding';

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function shortAuthor(author: string): string {
  // "Nome <email>" → "Nome"
  const m = author.match(/^(.*?)\s*<.+>$/);
  return (m ? m[1] : author).trim();
}

function formatCommittedAt(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function TaskCommitsList({ taskId }: Props) {
  const [commits, setCommits] = useState<TaskCommit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCommits(null);
    setError(null);
    fetch(`/api/tasks/${encodeURIComponent(taskId)}/commits`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((d) => {
        if (!cancelled) setCommits(d.commits ?? []);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  if (error) return null;
  if (commits === null) return null;
  if (commits.length === 0) return null;

  return (
    <details className="task-commits">
      <summary>
        <span className="task-commits-label">COMMITS</span>
        <span className="task-commits-count">{commits.length}</span>
      </summary>
      <ol className="task-commits-list">
        {commits.map((c) => (
          <li key={c.sha} className="task-commits-item">
            <a
              className="task-commits-sha"
              href={`${GITHUB_BASE}/${c.repo}/commit/${c.sha}`}
              target="_blank"
              rel="noreferrer"
              title={`abrir commit ${c.sha} no GitHub`}
            >
              {c.repo}/{shortSha(c.sha)}
            </a>
            <span className="task-commits-msg" title={c.message}>{c.message}</span>
            <span className="task-commits-meta">
              {shortAuthor(c.author)} · {formatCommittedAt(c.committed_at)}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}
