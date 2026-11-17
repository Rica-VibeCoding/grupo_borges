// SSE dos quadros da tela do agente, com no-transform: sem isto o gzip do Next
// segura os quadros e o heartbeat — ver lib/repasse-sse.ts.
import { repassaSse } from '@/lib/repasse-sse.ts';

export const dynamic = 'force-dynamic';

export const GET = repassaSse;
