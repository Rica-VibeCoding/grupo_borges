'use client';

import { useEffect, useState } from 'react';
import { fetchTaskSubsessions } from './api';
import type { SubagentEntry } from './cockpit-types';

export function useTaskSubsessions(
  taskId: string | null,
  agentSlug: string | null,
): SubagentEntry[] {
  const [subsessions, setSubsessions] = useState<SubagentEntry[]>([]);

  useEffect(() => {
    if (!taskId || !agentSlug) {
      setSubsessions([]);
      return;
    }

    const slug = agentSlug;
    const tid = taskId;
    let cancelled = false;
    let fetching = false;
    let lastJson = '';

    function poll() {
      if (fetching) return;
      fetching = true;
      fetchTaskSubsessions(slug, tid)
        .then((data) => {
          fetching = false;
          if (cancelled) return;
          const next = JSON.stringify(data);
          if (next !== lastJson) {
            lastJson = next;
            setSubsessions(data);
          }
        })
        .catch(() => { fetching = false; });
    }

    poll();
    const id = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [taskId, agentSlug]);

  return subsessions;
}
