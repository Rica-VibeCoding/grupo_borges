import { AgentModal } from '../../components/agent-modal';
import { CockpitHeader } from '../../components/cockpit-header';
import { Footer } from '../../components/footer';
import { KpiStrip } from '../../components/kpi-strip';
import { SseBanner } from '../../components/sse-banner';
import { ToastStack } from '../../components/toast-stack';
import { CockpitLiveV2 } from '../../components/v2/cockpit-live-v2';
import { fetchEvents, fetchFleet, fetchTasks } from '../../lib/api';
import { cockpitCss } from '../../lib/cockpit-css';
import { EMPTY_EVENTS, EMPTY_FLEET, EMPTY_TASKS } from '../../lib/cockpit-mock';
import { FleetProvider } from '../../lib/fleet-context';
import { SelectedAgentProvider } from '../../lib/selected-agent-context';
import { ToastProvider } from '../../lib/toast-context';

const v2Css = `
.v2-shell {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
.v2-sidebar {
  display: flex;
  flex-direction: column;
  gap: 10px;
  position: sticky;
  top: 20px;
  max-height: calc(100vh - 60px);
  overflow-y: auto;
  padding-right: 4px;
}
.v2-sidebar::-webkit-scrollbar { width: 4px; }
.v2-sidebar::-webkit-scrollbar-thumb { background: var(--accent-border); }
.v2-main {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
/* Cards na sidebar viram linha empilhada */
.v2-sidebar .grid {
  grid-template-columns: 1fr;
  gap: 8px;
}
/* Card horizontal compacto */
.v2-sidebar .agent-card {
  min-height: 0;
  grid-template-columns: 3px 1fr;
}
.v2-sidebar .agent-card .card-body {
  padding: 9px 11px 10px;
  gap: 7px;
}
.v2-sidebar .agent-card .card-head { gap: 9px; align-items: center; }
.v2-sidebar .agent-card .avatar { width: 30px; height: 30px; font-size: 11px; }
.v2-sidebar .agent-card .avatar::before,
.v2-sidebar .agent-card .avatar::after {
  display: none;
}
.v2-sidebar .agent-card .head-text { gap: 1px; }
.v2-sidebar .agent-card .agent-name { font-size: 12px; }
.v2-sidebar .agent-card .agent-slug,
.v2-sidebar .agent-card .agent-role {
  display: none;
}
.v2-sidebar .agent-card .status-bar { font-size: 8.5px; padding: 2px 5px; gap: 5px; }
.v2-sidebar .agent-card .status-bar .sdot { width: 5px; height: 5px; }
.v2-sidebar .agent-card .meta-strip {
  font-size: 9px;
  padding: 4px 0;
  gap: 3px 8px;
}
.v2-sidebar .agent-card .meta-strip .m-key {
  color: var(--accent);
  border: 1px solid var(--accent-border);
  border-radius: 999px;
  padding: 1px 4px;
  font-size: 7.5px;
  line-height: 1.2;
}
.v2-sidebar .agent-card .pane-session {
  font-size: 10px;
  padding: 6px 8px;
  min-height: 0;
  gap: 6px;
}
.v2-sidebar .agent-card .pane-session .psb-cell { width: 5px; height: 8px; }
/* Item OFFLINE: encolhe drasticamente, esconde pane e meta */
.v2-sidebar .agent-card[data-state="offline"] {
  opacity: 0.5;
}
.v2-sidebar .agent-card[data-state="offline"] .meta-strip,
.v2-sidebar .agent-card[data-state="offline"] .pane-session {
  display: none;
}
.v2-sidebar .agent-card[data-state="offline"] .card-body { padding: 4px 8px; gap: 0; }
.v2-sidebar .agent-card[data-state="offline"] .card-head { min-height: 26px; }
.v2-sidebar .agent-card[data-state="offline"] .avatar { width: 24px; height: 24px; font-size: 9px; }
.v2-sidebar .agent-card[data-state="offline"] .avatar { filter: grayscale(0.6); opacity: 0.8; }
/* Botão de criar instância e pílula +N continuam clicáveis */
.v2-sidebar .agent-card .instance-add,
.v2-sidebar .agent-card .instance-pill {
  height: 19px;
  min-width: 19px;
  font-size: 10px;
  padding: 0 5px;
}
/* Section label compacta na sidebar */
.v2-sidebar .section-label { padding: 0 0 4px; font-size: 9px; }
.v2-sidebar .section-label .num-tag { padding: 1px 6px; }

/* Kanban respira no centro */
.v2-main .kcol-body { max-height: 460px; }
.v2-main .section-label:has(+ .activity-feed),
.v2-main .activity-feed {
  display: none;
}
.v2-main .kanban-new-task {
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 10px;
  line-height: 1;
}

/* Responsivo: laptop pequeno colapsa sidebar pra topo (fallback simples) */
@media (max-width: 1100px) {
  .v2-shell { grid-template-columns: 1fr; }
  .v2-sidebar {
    position: static;
    max-height: none;
    overflow: visible;
  }
  .v2-sidebar .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 700px) {
  .v2-sidebar .grid { grid-template-columns: 1fr; }
}
`;

async function loadInitial() {
  try {
    const [fleet, tasks, events] = await Promise.all([fetchFleet(), fetchTasks(), fetchEvents()]);
    return { fleet, tasks, events, sseStatus: 'connecting' as const };
  } catch {
    return {
      fleet: EMPTY_FLEET,
      tasks: EMPTY_TASKS,
      events: EMPTY_EVENTS,
      sseStatus: 'closed' as const,
    };
  }
}

export default async function PageV2() {
  const initial = await loadInitial();
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: cockpitCss }} />
      <style dangerouslySetInnerHTML={{ __html: v2Css }} />
      <div className="corner-mark tl" />
      <div className="corner-mark tr" />
      <div className="corner-mark bl" />
      <div className="corner-mark br" />
      <FleetProvider initial={initial}>
        <ToastProvider>
          <SelectedAgentProvider>
            <SseBanner />
            <div className="viewport">
              <CockpitHeader />
              <KpiStrip />
              <CockpitLiveV2 />
              <Footer />
            </div>
            <AgentModal />
            <ToastStack />
          </SelectedAgentProvider>
        </ToastProvider>
      </FleetProvider>
    </>
  );
}
