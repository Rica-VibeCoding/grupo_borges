"use client"

import * as React from "react"
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

// Podado e estendido do template shadcn em 03/08, mesma receita do avatar.tsx:
//
// - PODADO: as classes de cor do template (`bg-border`, `ring-ring/50` no
//   viewport) referenciam tokens que o tema do globals.css não define. A cor do
//   polegar mora no globals.css (`--ck-scrollbar-thumb`), pendurada no
//   `data-slot` — regra 1 do projeto: cor só na pele.
// - ESTENDIDO: `viewportRef`/`viewportProps`. O `@tanstack/react-virtual`
//   precisa apontar `getScrollElement` para o VIEWPORT (é ele quem rola, não a
//   raiz), e o feed precisa pendurar `onScroll`, `data-gate-messages` e
//   `overflowAnchor: none` lá. O template não expõe o viewport; sem isso o
//   componente seria inútil justamente no único lugar onde entra.

function ScrollArea({
  className,
  children,
  viewportRef,
  viewportProps,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  viewportRef?: React.Ref<HTMLDivElement>
  viewportProps?: React.ComponentProps<typeof ScrollAreaPrimitive.Viewport>
}) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        ref={viewportRef}
        className={cn("size-full outline-none", viewportProps?.className)}
        {...viewportProps}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "flex touch-none p-px transition-colors select-none",
        // Mais fino que os 10px do template (w-2.5): a referência do Rica é um
        // fio à direita da tela. `p-px` deixa a área de toque com 10px enquanto
        // o polegar visível fica com 8px.
        orientation === "vertical" && "h-full w-2",
        orientation === "horizontal" && "h-2 flex-col",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export { ScrollArea, ScrollBar }
