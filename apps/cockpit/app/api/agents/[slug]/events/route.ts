// SSE de estado da frota de um (painel do cliente), com no-transform para o gzip do Next não segurar eventos — ver lib/repasse-sse.ts.
import { repassaSse } from '@/lib/repasse-sse.ts';

export const dynamic = 'force-dynamic';

export const GET = repassaSse;
