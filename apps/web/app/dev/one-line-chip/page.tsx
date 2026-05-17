'use client';

// Rota dev /dev/one-line-chip — preview visual das 14 fixtures do
// OneLineChip (DS-70/JP-17). Não linkada do app, só pra Pavan/Rica
// validarem visual antes da integração com classifyMessage (JP-16 Tara).

import { OneLineChip } from '../../../components/one-line-chip';
import { ONE_LINE_CHIP_FIXTURES } from '../../../lib/__fixtures__/one-line-chip.fixtures';

export default function OneLineChipPreviewPage() {
  return (
    <main style={{ padding: '32px', maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>
        OneLineChip preview
      </h1>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24 }}>
        DS-70/JP-17/DS-71 — fixtures cobrindo todos os kinds × tones ×
        expansível/não. Click no chip pra expandir. Foco com Tab.
        Tone <code>active</code> tem breathing animation (opacidade 1→0.85→1
        em 1.8s).
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {ONE_LINE_CHIP_FIXTURES.map((fx) => (
          <div key={fx.name}>
            <div
              style={{
                fontSize: 10,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--muted)',
                marginBottom: 4,
              }}
            >
              {fx.name}
            </div>
            <OneLineChip
              icon={fx.icon}
              label={fx.label}
              summary={fx.summary}
              trailing={fx.trailing}
              timestamp={fx.timestamp}
              expandBody={fx.expandBody}
              kind={fx.kind}
              tone={fx.tone}
            />
          </div>
        ))}
      </div>
    </main>
  );
}
