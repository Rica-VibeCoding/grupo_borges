import { AgentModal } from '../components/agent-modal';
import { CockpitHeader } from '../components/cockpit-header';
import { CockpitLive } from '../components/cockpit-live';
import { Footer } from '../components/footer';
import { KpiStrip } from '../components/kpi-strip';
import { SseBanner } from '../components/sse-banner';
import { ToastStack } from '../components/toast-stack';
import { fetchEvents, fetchFleet, fetchTasks } from '../lib/api';
import { EMPTY_EVENTS, EMPTY_FLEET, EMPTY_TASKS } from '../lib/cockpit-mock';
import { FleetProvider } from '../lib/fleet-context';
import { SelectedAgentProvider } from '../lib/selected-agent-context';
import { ToastProvider } from '../lib/toast-context';

import { cockpitCss } from '../lib/cockpit-css';

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

export default async function Page() {
  const initial = await loadInitial();
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: cockpitCss }} />
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
              <CockpitLive />
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
