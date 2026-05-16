'use client';

import { Command } from 'cmdk';

/**
 * Slash command palette — DS-62 (JP-11 Fase 3 F3-1).
 *
 * cmdk inline (não Dialog): renderização condicional, foco fica no textarea,
 * navegação por teclado vem do ChatInput (intercepta Arrow/Enter/Esc). cmdk
 * cuida só de visual selecionado, ARIA e ordem de items.
 */

export type SlashCommand = {
  value: string;
  label: string;
  desc: string;
};

export const SLASH_COMMANDS: SlashCommand[] = [
  { value: 'clear', label: '/clear', desc: 'limpa o pane' },
  { value: 'restart', label: '/restart', desc: 'reinicia o agente' },
  { value: 'help', label: '/help', desc: 'mostra ajuda' },
  { value: 'status', label: '/status', desc: 'pede status do agente' },
  { value: 'skill', label: '/skill <nome>', desc: 'invoca skill' },
];

export function filterSlashCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase();
  if (!q) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((c) => c.value.toLowerCase().startsWith(q));
}

/**
 * Detecta contexto de slash command na posição do caret.
 * Retorna `null` se não está num slash trigger; senão retorna
 * `{ sliceStart, query }` onde sliceStart é o índice do `/` no texto.
 *
 * Trigger: `/` precedido por início-de-string OU whitespace, e sem whitespace
 * entre o `/` e o caret.
 */
export function detectSlashContext(
  text: string,
  caret: number,
): { sliceStart: number; query: string } | null {
  if (caret < 1) return null;
  const before = text.slice(0, caret);
  const match = before.match(/(?:^|\s)(\/\S*)$/);
  if (!match) return null;
  const slashFragment = match[1];
  const sliceStart = before.length - slashFragment.length;
  return { sliceStart, query: slashFragment.slice(1) };
}

/**
 * Calcula o novo texto + posição do caret após inserir `cmd` no slash context
 * identificado por `sliceStart..caret`.
 */
export function applySlashSelection(
  text: string,
  caret: number,
  sliceStart: number,
  cmd: SlashCommand,
): { text: string; caret: number } {
  const before = text.slice(0, sliceStart);
  const after = text.slice(caret);
  const insert = `/${cmd.value} `;
  return { text: before + insert + after, caret: sliceStart + insert.length };
}

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
