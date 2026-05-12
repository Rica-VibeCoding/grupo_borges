import { AgentModal } from '../../components/agent-modal';
import { CockpitHeader } from '../../components/cockpit-header';
import { Footer } from '../../components/footer';
import { SseBanner } from '../../components/sse-banner';
import { ToastStack } from '../../components/toast-stack';
import { CockpitLiveV2 } from '../../components/v2/cockpit-live-v2';
import { KpiStripThin } from '../../components/v2/kpi-strip-thin';
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
.v2-sidebar .agent-card[data-activity-state="thinking"] {
  border-color: rgba(0, 240, 255, 0.45);
  box-shadow: 0 0 0 1px rgba(0, 240, 255, 0.08), 0 0 18px rgba(0, 240, 255, 0.16);
  animation: card-breathe 4.2s ease-in-out infinite;
}
.v2-sidebar .agent-card[data-activity-state="thinking"] .rail {
  background: var(--accent);
  box-shadow: 0 0 9px rgba(0, 240, 255, 0.55);
}
.v2-sidebar .agent-card[data-activity-state="thinking"] .status-bar {
  color: var(--accent);
  border-color: var(--accent-border);
  background: var(--accent-subtle);
}
.v2-sidebar .agent-card[data-activity-state="thinking"] .status-bar .sdot {
  background: var(--accent);
  box-shadow: 0 0 7px var(--accent);
  animation: dot-pulse 1.6s ease-in-out infinite;
}
.v2-sidebar .agent-card[data-activity-state="tool"] {
  border-color: rgba(255, 107, 53, 0.42);
  box-shadow: 0 0 0 1px rgba(255, 107, 53, 0.06), 0 0 18px rgba(255, 107, 53, 0.16);
  animation: tool-breathe 2.4s ease-in-out infinite;
}
.v2-sidebar .agent-card[data-activity-state="tool"] .rail {
  background: var(--status-blocked);
  box-shadow: 0 0 9px rgba(255, 107, 53, 0.52);
}
.v2-sidebar .agent-card[data-activity-state="tool"] .status-bar {
  color: var(--status-blocked);
  border-color: rgba(255, 107, 53, 0.34);
  background: rgba(255, 107, 53, 0.08);
}
.v2-sidebar .agent-card[data-activity-state="tool"] .status-bar .sdot {
  background: var(--status-blocked);
  box-shadow: 0 0 7px var(--status-blocked);
  animation: dot-pulse 1.1s ease-in-out infinite;
}
.v2-sidebar .agent-card[data-activity-state="subagent"] {
  border-color: rgba(0, 240, 255, 0.22);
  box-shadow: var(--glow-card);
  animation: none;
}
.v2-sidebar .agent-card[data-activity-state="subagent"] .rail {
  background: var(--accent-secondary);
  box-shadow: 0 0 6px rgba(0, 184, 212, 0.34);
}
.v2-sidebar .agent-card[data-activity-state="subagent"] .status-bar {
  color: var(--accent);
  border-color: var(--accent-border);
  background: var(--accent-subtle);
  animation: status-chip-pulse 1.8s ease-in-out infinite;
}
.v2-sidebar .agent-card[data-activity-state="subagent"] .status-bar .sdot {
  background: var(--accent);
  box-shadow: 0 0 6px var(--accent);
}
.v2-sidebar .agent-card[data-activity-state="blocked"] {
  border-color: rgba(255, 107, 53, 0.36);
  box-shadow: 0 0 12px rgba(255, 107, 53, 0.10);
  animation: none;
}
.v2-sidebar .agent-card[data-activity-state="blocked"] .rail {
  background: var(--status-blocked);
  box-shadow: 0 0 7px rgba(255, 107, 53, 0.38);
}
.v2-sidebar .agent-card[data-activity-state="blocked"] .status-bar {
  color: var(--status-blocked);
  border-color: rgba(255, 107, 53, 0.34);
  background: rgba(255, 107, 53, 0.06);
}
.v2-sidebar .agent-card[data-activity-state="blocked"] .status-bar .sdot {
  background: var(--status-blocked);
  animation: none;
}
.v2-sidebar .agent-card[data-activity-state="idle"] {
  border-color: var(--border);
  box-shadow: var(--glow-card);
  animation: none;
}
.v2-sidebar .agent-card[data-activity-state="idle"] .rail {
  background: var(--status-idle);
  box-shadow: none;
  opacity: 0.35;
}
.v2-sidebar .agent-card[data-activity-state="idle"] .status-bar {
  color: var(--muted);
  border-color: var(--border);
  background: transparent;
}
.v2-sidebar .agent-card[data-activity-state="idle"] .status-bar .sdot {
  background: var(--status-idle);
  box-shadow: none;
  animation: none;
  opacity: 0.7;
}
.v2-sidebar .agent-card[data-activity-state="done"] {
  border-color: rgba(100, 255, 218, 0.30);
  box-shadow: 0 0 8px rgba(100, 255, 218, 0.08);
  animation: none;
}
.v2-sidebar .agent-card[data-activity-state="done"] .rail {
  background: var(--status-done);
  box-shadow: 0 0 6px rgba(100, 255, 218, 0.34);
}
.v2-sidebar .agent-card[data-activity-state="done"] .status-bar {
  color: var(--status-done);
  border-color: rgba(100, 255, 218, 0.30);
  background: rgba(100, 255, 218, 0.05);
}
.v2-sidebar .agent-card[data-activity-state="done"] .status-bar .sdot {
  background: var(--status-done);
  box-shadow: none;
  animation: none;
}
.v2-sidebar .agent-card[data-activity-state="offline"] {
  opacity: 0.46;
  border-color: var(--border-subtle);
  box-shadow: none;
  animation: none;
}
.v2-sidebar .agent-card[data-activity-state="offline"] .rail {
  background: var(--status-offline);
  box-shadow: none;
}
.v2-sidebar .agent-card[data-activity-state="offline"] .status-bar {
  color: var(--status-offline);
  border-color: var(--border-subtle);
  background: transparent;
}
.v2-sidebar .agent-card[data-activity-state="offline"] .status-bar .sdot {
  background: var(--status-offline);
  box-shadow: none;
  animation: none;
}
@keyframes tool-breathe {
  0%, 100% { box-shadow: 0 0 0 1px rgba(255, 107, 53, 0.06), 0 0 12px rgba(255, 107, 53, 0.10); }
  50% { box-shadow: 0 0 0 1px rgba(255, 107, 53, 0.13), 0 0 24px rgba(255, 107, 53, 0.22); }
}
@keyframes status-chip-pulse {
  0%, 100% { box-shadow: none; }
  50% { box-shadow: 0 0 10px rgba(0, 240, 255, 0.30); }
}
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
@media (prefers-reduced-motion: reduce) {
  .v2-sidebar .agent-card,
  .v2-sidebar .agent-card .status-bar,
  .v2-sidebar .agent-card .status-bar .sdot {
    animation: none !important;
  }
}
.kpi-thin { display:flex; align-items:center; gap:14px; padding:10px 18px; background:var(--panel); border:1px solid var(--border); font-family:'JetBrains Mono',monospace; font-size:11px; color:var(--text); letter-spacing:0.08em; min-height:40px; }
.kpi-thin .kt-dot { width:9px; height:9px; border-radius:50%; flex:none; }
.kpi-thin[data-state="ok"] .kt-dot { background:var(--status-done); box-shadow:0 0 7px var(--status-done); }
.kpi-thin[data-state="atencao"] .kt-dot { background:var(--status-blocked); box-shadow:0 0 7px var(--status-blocked); animation:dot-pulse 1.6s ease-in-out infinite; }
.kpi-thin[data-state="falha"] .kt-dot { background:var(--health-down); box-shadow:0 0 9px var(--health-down); animation:dot-blink 1.1s steps(2) infinite; }
.kpi-thin .kt-main { font-weight:700; text-transform:uppercase; letter-spacing:0.18em; font-size:11px; }
.kpi-thin[data-state="ok"] .kt-main { color:var(--status-done); }
.kpi-thin[data-state="atencao"] .kt-main { color:var(--status-blocked); }
.kpi-thin[data-state="falha"] .kt-main { color:var(--health-down); }
.kpi-thin .kt-sep { color:var(--muted); opacity:0.45; }
.kpi-thin .kt-meta { color:var(--text); }
.kpi-thin .kt-hb { margin-left:auto; color:var(--muted); opacity:0.7; font-size:10px; letter-spacing:0.12em; }
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
              <KpiStripThin />
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
