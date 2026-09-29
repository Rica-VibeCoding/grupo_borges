'use client';

import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';

import styles from './configuracao-da-conversa.module.css';
import { ControlesDaConversa, type ControlesDaConversaProps } from './controles-da-conversa';
import { usePublicaDetalheDaConversa } from './contexto-configuracao-conversa';

type Props = ControlesDaConversaProps & {
  /** Quem abre é a tela: o arrasto para cima e este botão. */
  aberta: boolean;
  mudaAberta: (aberta: boolean) => void;
  ativa?: boolean;
};

/**
 * Tudo que se ajusta na conversa mora aqui, fora da tela: o fone, o texto, a
 * foto do agente (Atividade ao vivo ou Eclipse) e o visual. Arrastar para cima abre a folha; o botão continua existindo para teclado e
 * leitor de tela, fora da vista até ganhar foco. Cada troca vale na hora e fica
 * guardada no aparelho.
 */
export function ConfiguracaoDaConversa({ aberta, mudaAberta, ativa = false, ...controles }: Props) {
  usePublicaDetalheDaConversa(ativa, controles.detalheTecnico);
  return (
    <Drawer open={aberta} onOpenChange={mudaAberta}>
      <DrawerTrigger asChild>
        <button type="button" className={styles.gatilho} aria-label="Configurações da conversa">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M20 7h-9M14 17H5" />
            <circle cx="17" cy="17" r="3" />
            <circle cx="7" cy="7" r="3" />
          </svg>
        </button>
      </DrawerTrigger>
      <DrawerContent className={styles.folha}>
        <DrawerHeader>
          <DrawerTitle>Configurações</DrawerTitle>
          <DrawerDescription>Ficam guardadas neste aparelho.</DrawerDescription>
        </DrawerHeader>
        <ControlesDaConversa {...controles} />
      </DrawerContent>
    </Drawer>
  );
}
