import { AgentModal } from '../components/agent-modal';
import { CockpitHeader } from '../components/cockpit-header';
import { Footer } from '../components/footer';
import { SseBanner } from '../components/sse-banner';
import { ToastStack } from '../components/toast-stack';
import { CockpitLiveV2 } from '../components/v2/cockpit-live-v2';
import { KpiStripThin } from '../components/v2/kpi-strip-thin';
import { subsessionCss } from '../components/subsession-popover';
import { fetchEvents, fetchFleet, fetchTasks } from '../lib/api';
import { cockpitCss } from '../lib/cockpit-css';
import { EMPTY_EVENTS, EMPTY_FLEET, EMPTY_TASKS } from '../lib/cockpit-mock';
import { FleetProvider } from '../lib/fleet-context';
import { SelectedAgentProvider } from '../lib/selected-agent-context';
import { SubagentActivityProvider } from '../lib/subagent-activity-context';
import { ToastProvider } from '../lib/toast-context';

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
/* V2.4 — 4 estados visuais. Glow na borda em vez de cor de fundo.
   Ocioso: cyan PARADO (cabe ignorar).
   Trabalhando: emerald pulsa devagar (~2s).
   Aguardando: amber pulsa intenso (~1s) — convida atenção.
   Offline: opacidade baixa, sem glow.
   Contraste estático=ignorável / animado=atenção é o sinal visual principal. */

.v2-sidebar .agent-card[data-activity-state="ocioso"] {
  border-color: rgba(0, 240, 255, 0.32);
  box-shadow: 0 0 0 1px rgba(0, 240, 255, 0.06), 0 0 16px rgba(0, 240, 255, 0.20);
  animation: none;
}
.v2-sidebar .agent-card[data-activity-state="ocioso"] .rail {
  background: var(--accent);
  box-shadow: 0 0 7px rgba(0, 240, 255, 0.38);
  opacity: 0.78;
}
.v2-sidebar .agent-card[data-activity-state="ocioso"] .status-bar {
  color: var(--accent);
  border-color: var(--accent-border);
  background: var(--accent-subtle);
}
.v2-sidebar .agent-card[data-activity-state="ocioso"] .status-bar .sdot {
  background: var(--accent);
  box-shadow: 0 0 5px rgba(0, 240, 255, 0.45);
  animation: none;
}

.v2-sidebar .agent-card[data-activity-state="trabalhando"] {
  border-color: rgba(16, 185, 129, 0.55);
  animation: pulse-trabalhando 2s ease-in-out infinite;
}
.v2-sidebar .agent-card[data-activity-state="trabalhando"] .rail {
  background: #10b981;
  box-shadow: 0 0 10px rgba(16, 185, 129, 0.60);
}
.v2-sidebar .agent-card[data-activity-state="trabalhando"] .status-bar {
  color: #10b981;
  border-color: rgba(16, 185, 129, 0.42);
  background: rgba(16, 185, 129, 0.10);
}
.v2-sidebar .agent-card[data-activity-state="trabalhando"] .status-bar .sdot {
  background: #10b981;
  box-shadow: 0 0 7px rgba(16, 185, 129, 0.70);
  animation: pulse-dot-trabalhando 2s ease-in-out infinite;
}

.v2-sidebar .agent-card[data-activity-state="aguardando"] {
  border-color: rgba(245, 158, 11, 0.65);
  animation: pulse-aguardando 1s ease-in-out infinite;
}
.v2-sidebar .agent-card[data-activity-state="aguardando"] .rail {
  background: #f59e0b;
  box-shadow: 0 0 12px rgba(245, 158, 11, 0.70);
}
.v2-sidebar .agent-card[data-activity-state="aguardando"] .status-bar {
  color: #f59e0b;
  border-color: rgba(245, 158, 11, 0.48);
  background: rgba(245, 158, 11, 0.12);
}
.v2-sidebar .agent-card[data-activity-state="aguardando"] .status-bar .sdot {
  background: #f59e0b;
  box-shadow: 0 0 8px rgba(245, 158, 11, 0.85);
  animation: pulse-dot-aguardando 1s ease-in-out infinite;
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

@keyframes pulse-trabalhando {
  0%, 100% { box-shadow: 0 0 0 1px rgba(16, 185, 129, 0.08), 0 0 14px rgba(16, 185, 129, 0.22); }
  50%      { box-shadow: 0 0 0 1px rgba(16, 185, 129, 0.18), 0 0 28px rgba(16, 185, 129, 0.42); }
}
@keyframes pulse-aguardando {
  0%, 100% { box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.10), 0 0 18px rgba(245, 158, 11, 0.30); }
  50%      { box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.24), 0 0 32px rgba(245, 158, 11, 0.55); }
}
@keyframes pulse-dot-trabalhando {
  0%, 100% { opacity: 0.95; }
  50%      { opacity: 0.55; }
}
@keyframes pulse-dot-aguardando {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.45; transform: scale(0.88); }
}
@media (prefers-reduced-motion: reduce) {
  .v2-sidebar .agent-card[data-activity-state="trabalhando"],
  .v2-sidebar .agent-card[data-activity-state="aguardando"],
  .v2-sidebar .agent-card[data-activity-state="trabalhando"] .status-bar .sdot,
  .v2-sidebar .agent-card[data-activity-state="aguardando"] .status-bar .sdot {
    animation: none;
  }
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
/* Pílula +N continua clicável */
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

/* JP-11 F3-2 — badge subagent active inline ao lado do nome do agente.
   Inline pra não competir com .status-bar no canto sup-direito da card. */
.agent-card .subagent-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(245, 158, 11, 0.18);
  border: 1px solid rgba(245, 158, 11, 0.55);
  color: #f59e0b;
  font-size: 9.5px;
  letter-spacing: 0.06em;
  line-height: 1;
  vertical-align: middle;
  pointer-events: none;
}
.agent-card .subagent-badge-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #f59e0b;
  box-shadow: 0 0 6px rgba(245, 158, 11, 0.85);
  animation: subagent-badge-pulse 1.4s ease-in-out infinite;
}
.agent-card .subagent-badge-num { font-weight: 600; }
@keyframes subagent-badge-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.55; transform: scale(0.8); }
}
@media (prefers-reduced-motion: reduce) {
  .agent-card .subagent-badge-dot { animation: none; }
}
`;

async function loadInitial() {
  try {
    const [fleet, tasks, events] = await Promise.all([fetchFleet(), fetchTasks(), fetchEvents()]);
    return { fleet, tasks, events, activityOverrides: {}, sseStatus: 'connecting' as const };
  } catch {
    return {
      fleet: EMPTY_FLEET,
      tasks: EMPTY_TASKS,
      events: EMPTY_EVENTS,
      activityOverrides: {},
      sseStatus: 'closed' as const,
    };
  }
}

export default async function Page() {
  const initial = await loadInitial();
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: cockpitCss }} />
      <style dangerouslySetInnerHTML={{ __html: v2Css }} />
      <style dangerouslySetInnerHTML={{ __html: subsessionCss }} />
      <div className="corner-mark tl" />
      <div className="corner-mark tr" />
      <div className="corner-mark bl" />
      <div className="corner-mark br" />
      <FleetProvider initial={initial}>
        <ToastProvider>
          <SubagentActivityProvider>
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
          </SubagentActivityProvider>
        </ToastProvider>
      </FleetProvider>
    </>
  );
}
