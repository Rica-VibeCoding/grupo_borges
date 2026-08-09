import { AppShell } from '@/components/shell/app-shell';
import { TropaAoVivo } from '@/components/shell/tropa-ao-vivo';

export default function AgenteLayout({ children }: { children: React.ReactNode }) {
  const agora = Math.floor(Date.now() / 1000);

  return (
    <AppShell nav={<TropaAoVivo agora={agora} compacta />} fecharNavHref="?">
      {children}
    </AppShell>
  );
}
