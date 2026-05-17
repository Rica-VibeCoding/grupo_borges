'use client';

import { Command } from 'cmdk';
import {
  applySlashSelection,
  detectSlashContext,
  filterSlashCommands,
  getSlashCommands,
  type SlashCommand,
} from '../lib/slash-command-palette-logic';

/**
 * Slash command palette — DS-62 (JP-11 Fase 3 F3-1).
 *
 * cmdk inline (não Dialog): renderização condicional, foco fica no textarea,
 * navegação por teclado vem do ChatInput (intercepta Arrow/Enter/Esc). cmdk
 * cuida só de visual selecionado, ARIA e ordem de items.
 *
 * Helpers puros (getSlashCommands, filterSlashCommands, detectSlashContext,
 * applySlashSelection) moram em lib/slash-command-palette-logic.ts pra
 * permitir teste via node:test sem JSX. Re-exportados aqui pra manter a API
 * estável pros consumidores.
 */

export type { SlashCommand };
export {
  getSlashCommands,
  filterSlashCommands,
  detectSlashContext,
  applySlashSelection,
};

export function SlashCommandPalette({
  items,
  selectedValue,
  onActiveChange,
  onSelect,
}: {
  items: SlashCommand[];
  selectedValue: string;
  onActiveChange: (value: string) => void;
  onSelect: (cmd: SlashCommand) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="slash-palette">
        <div className="slash-palette-empty">sem comandos pra essa busca</div>
      </div>
    );
  }
  return (
    <div className="slash-palette">
      <Command
        shouldFilter={false}
        value={selectedValue}
        onValueChange={onActiveChange}
        loop
        aria-label="Comandos slash"
      >
        <Command.List id="slash-palette-listbox" role="listbox" aria-label="Comandos slash">
          {items.map((c) => (
            <Command.Item
              key={c.value}
              value={c.value}
              id={`slash-item-${c.value}`}
              onSelect={() => onSelect(c)}
              className="slash-palette-item"
            >
              <span className="slash-palette-item-label mono">{c.label}</span>
              <span className="slash-palette-item-desc">{c.desc}</span>
            </Command.Item>
          ))}
        </Command.List>
      </Command>
    </div>
  );
}
