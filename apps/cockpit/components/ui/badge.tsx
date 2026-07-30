import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// Podado do template shadcn em 30/07 (decisão registrada no commit): os variants
// default/secondary/destructive/outline/link referenciavam tokens que o @theme
// do globals.css não define (primary, destructive, accent, ring, border) —
// inclusive um `text-white` literal, único da árvore. Mapear esses tokens criaria
// um segundo sistema de nomes de cor, que é o que o @theme inline declara evitar;
// o app inteiro estiliza cor via style com var(--ck-*) por cima do componente.
// Ficou o `ghost`, único variant com uso real (ChipEstado da tropa, que pinta
// tudo via style inline). Cor não mora aqui: quem usa, traz o token.
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:ring-[3px] [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        ghost: "",
      },
    },
    defaultVariants: {
      variant: "ghost",
    },
  }
)

function Badge({
  className,
  variant = "ghost",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
