'use client';

import * as React from 'react';
import { Command as CommandPrimitive } from 'cmdk';

import { cn } from '@/lib/utils';

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn('flex h-full w-full flex-col overflow-hidden', className)}
      {...props}
    />
  );
}

function CommandList({
  className,
  style,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn('max-h-[240px] overflow-x-hidden overflow-y-auto', className)}
      style={{ scrollbarColor: 'var(--ck-scrollbar-thumb) transparent', ...style }}
      {...props}
    />
  );
}

function CommandEmpty({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn('px-[var(--ck-space-3)] py-[var(--ck-space-2)] text-sm text-text-secondary', className)}
      {...props}
    />
  );
}

function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        'ck-veil flex min-h-[var(--ck-touch-min)] cursor-default select-none items-center rounded-[var(--ck-radius-chip)] px-[var(--ck-space-2)] py-[var(--ck-space-2)] outline-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-[var(--ck-overlay-selected)]',
        className,
      )}
      {...props}
    />
  );
}

export { Command, CommandEmpty, CommandItem, CommandList };
