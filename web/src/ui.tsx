import {Button as ShadcnButton} from "./components/ui/button";
import {Badge as ShadcnBadge} from "./components/ui/badge";
import {Card as ShadcnCard} from "./components/ui/card";
import {Dialog as DialogRoot,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from "./components/ui/dialog";
/** Componentes visuais básicos, todos sobre os tokens de styles.css. */
import type { ButtonHTMLAttributes, ComponentChildren, HTMLAttributes } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { CircleCheck, CircleX, Info, LoaderCircle, TriangleAlert, X } from "lucide-preact";
import { dismiss, useToasts } from "./lib/toast";

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

export type Tone = "ok" | "warn" | "bad" | "accent" | "";

// --- botões -----------------------------------------------------------
// Toda ação com cara de botão passa por buttonClass: <button> (Button), <a> (LinkButton)
// e <label> de arquivo (FileButton) ficam idênticos e seguem o tema.

export type ButtonVariant = "default" | "primary" | "danger" | "danger-solid" | "ghost";
export type ButtonSize = "sm" | "md";
const BUTTON: Record<ButtonVariant, string> = {
  default: "btn-hud border border-line bg-surface/70 text-fg hover:border-accent/60 hover:text-accent",
  primary: "btn-brand border border-transparent hover:brightness-110",
  danger: "btn-hud border border-line bg-surface/70 text-bad hover:border-bad/60 hover:bg-bad-soft",
  "danger-solid": "border border-transparent bg-bad text-bad-fg shadow-card hover:brightness-110",
  ghost: "border border-transparent text-muted hover:bg-surface-2 hover:text-fg",
};

export function buttonClass({ variant = "default", size = "md" }: { variant?: ButtonVariant; size?: ButtonSize } = {}, ...extra: (string | false | null | undefined)[]) {
  return cx(
    "inline-flex cursor-pointer select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition",
    "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
    size === "sm" ? "h-7 px-2.5 text-[12.5px]" : "h-9 px-3.5 text-[13.5px]",
    BUTTON[variant],
    ...extra,
  );
}

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size" | "loading" | "type" | "icon"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ComponentChildren;
  type?: "button" | "submit";
};

export function Button({ variant, size, loading, icon, class: klass, children, disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <ShadcnButton type={type} disabled={disabled || loading} className={buttonClass({ variant, size }, klass as string)} {...rest}>
      {loading ? <LoaderCircle class="size-4 animate-spin" /> : icon}
      {children}
    </ShadcnButton>
  );
}

/** Link com aparência de botão (navegação, não ação). */
export function LinkButton({ href, target, rel, title, variant, size, icon, class: klass, children }: { href: string; target?: string; rel?: string; title?: string; variant?: ButtonVariant; size?: ButtonSize; icon?: ComponentChildren; class?: string; children: ComponentChildren }) {
  return <a href={href} target={target} rel={rel} title={title} class={buttonClass({ variant, size }, klass)}>{icon}{children}</a>;
}

/** Botão que abre o seletor de arquivo; o input fica dentro do <label> para manter teclado e leitor de tela. */
export function FileButton({ accept, onFile, variant, size, icon, disabled, children, class: klass }: { accept: string; onFile: (file: File) => void; variant?: ButtonVariant; size?: ButtonSize; icon?: ComponentChildren; disabled?: boolean; children: ComponentChildren; class?: string }) {
  return (
    <label class={buttonClass({ variant, size }, "focus-within:ring-2 focus-within:ring-accent", klass)} aria-disabled={disabled || undefined}>
      {icon}
      {children}
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        class="sr-only"
        onChange={(e) => {
          const input = e.currentTarget;
          const file = input.files?.[0];
          input.value = "";
          if (file) onFile(file);
        }}
      />
    </label>
  );
}

const ICON_SIZE = { sm: "size-7 rounded-md", md: "size-9 rounded-lg" } as const;
export function IconButton({ label, size = "md", children, class: klass, ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "size"> & { label: string; size?: keyof typeof ICON_SIZE }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      class={cx(
        "inline-flex shrink-0 items-center justify-center text-muted transition hover:bg-surface-2 hover:text-fg active:scale-95 disabled:opacity-50",
        ICON_SIZE[size],
        klass as string,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Ação dentro do texto (nome que abre o editor, "digitar manualmente"). */
export function TextButton({ tone = "accent", class: klass, children, ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & { tone?: "accent" | "fg" }) {
  return (
    <button
      type="button"
      class={cx("max-w-full text-left font-medium hover:text-accent hover:underline", tone === "accent" ? "text-accent" : "text-fg", klass as string)}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Linha clicável de lista (aparelho, sugestão): ocupa a largura e destaca no hover. */
export function RowButton({ class: klass, children, ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type">) {
  return (
    <button
      type="button"
      class={cx("flex w-full min-w-0 items-center gap-3 rounded-lg px-2 py-1.5 text-left transition enabled:hover:bg-surface-2", klass as string)}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Cartão de escolha exclusiva (tema, imagem): aria-pressed indica o selecionado. */
export function ChoiceCard({ selected, class: klass, children, ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & { selected: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      class={cx(
        "rounded-xl border p-4 text-left transition hover:border-accent disabled:opacity-50",
        selected ? "border-accent bg-accent-soft ring-2 ring-accent/30" : "border-line bg-surface",
        klass as string,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// --- selos e indicadores ----------------------------------------------

const BADGE: Record<Tone, string> = {
  "": "bg-surface-2 text-muted",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  accent: "bg-accent-soft text-accent",
};

export function Badge({ tone = "", children, title, class: klass }: { tone?: Tone; children: ComponentChildren; title?: string; class?: string }) {
  return (
    <ShadcnBadge title={title} className={cx("hud-badge inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-px text-[12px] font-medium", BADGE[tone], klass)}>
      {children}
    </ShadcnBadge>
  );
}

/** Ponto de status; com `pulse`, anima (online/ao vivo). */
export function Dot({ tone, pulse, label }: { tone: "ok" | "bad" | "warn" | "off"; pulse?: boolean; label?: string }) {
  const color = { ok: "bg-ok", bad: "bg-bad", warn: "bg-warn", off: "bg-muted/50" }[tone];
  return (
    <span class="relative inline-flex size-2 shrink-0" role={label ? "img" : undefined} aria-label={label}>
      {pulse && <span class={cx("absolute inset-0 animate-ping rounded-full opacity-60", color)} />}
      <span class={cx("relative inline-flex size-2 rounded-full", color)} />
    </span>
  );
}

export const Spinner = ({ class: klass }: { class?: string }) => <LoaderCircle class={cx("size-4 animate-spin", klass)} />;

// --- blocos -------------------------------------------------------------

export function Card({ children, class: klass, ...rest }: HTMLAttributes<HTMLDivElement>) {
 return <ShadcnCard className={cx("hud-panel min-w-0 gap-0 border-line bg-surface p-4 text-fg shadow-card",klass as string)} {...rest}>{children}</ShadcnCard>;
}

export function SectionTitle({ children, actions, class: klass }: { children: ComponentChildren; actions?: ComponentChildren; class?: string }) {
  return (
    <div class={cx("mb-3 mt-8 flex flex-wrap items-center gap-x-3 gap-y-2 first:mt-0", klass)}>
      <h2 class="hud-title">{children}</h2>
      <span class="hud-title-line" aria-hidden="true" />
      {actions && <div class="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function TableCard({ children }: { children: ComponentChildren }) {
  return <div class="table-card">{children}</div>;
}

export function Empty({ children, icon }: { children: ComponentChildren; icon?: ComponentChildren }) {
  return (
    <div class="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line px-6 py-10 text-center text-muted">
      {icon && <div class="text-muted/70 [&>svg]:size-7">{icon}</div>}
      <div class="max-w-md text-[13.5px]">{children}</div>
    </div>
  );
}

const BANNER: Record<Exclude<Tone, "">, { cls: string; icon: ComponentChildren }> = {
  ok: { cls: "bg-ok-soft text-ok border-ok/20", icon: <CircleCheck class="size-4 shrink-0" /> },
  warn: { cls: "bg-warn-soft text-warn border-warn/20", icon: <TriangleAlert class="size-4 shrink-0" /> },
  bad: { cls: "bg-bad-soft text-bad border-bad/20", icon: <CircleX class="size-4 shrink-0" /> },
  accent: { cls: "bg-accent-soft text-accent border-accent/20", icon: <Info class="size-4 shrink-0" /> },
};

export function Banner({ tone = "accent", children, action, role }: { tone?: Exclude<Tone, "">; children: ComponentChildren; action?: ComponentChildren; role?: "alert" | "status" }) {
  const b = BANNER[tone];
  return (
    <div role={role} class={cx("flex flex-wrap items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13.5px]", b.cls)}>
      <span class="mt-0.5">{b.icon}</span>
      <div class="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

/** Lista chave → valor (dl). */
export function Kv({ items, class: klass }: { items: [ComponentChildren, ComponentChildren, string?][]; class?: string }) {
  return (
    <dl class={cx("grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]", klass)}>
      {items.map(([k, v, cls]) => (
        <>
          <dt class="text-muted">{k}</dt>
          <dd class={cx("m-0 min-w-0 [overflow-wrap:anywhere]", cls)}>{v}</dd>
        </>
      ))}
    </dl>
  );
}

export function Skeleton({ class: klass }: { class?: string }) {
  return <div class={cx("animate-pulse rounded-lg bg-surface-2", klass)} />;
}

/** Esqueleto de página enquanto a primeira leitura não chega. */
export function PageLoading({ error }: { error?: Error | null }) {
  if (error) return <Banner tone="bad">Erro ao carregar: {error.message}</Banner>;
  return (
    <div class="grid gap-3" aria-busy="true" aria-label="Carregando">
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map(() => (
          <Skeleton class="h-24" />
        ))}
      </div>
      <Skeleton class="h-64" />
    </div>
  );
}

// --- formulários ----------------------------------------------------------

export function Field({ label, hint, children, class: klass }: { label: ComponentChildren; hint?: ComponentChildren; children: ComponentChildren; class?: string }) {
  return (
    <label class={cx("grid gap-1.5 text-[13px] font-medium text-muted", klass)}>
      <span>
        {label} {hint && <span class="font-normal text-muted/80">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function Check({ checked, onChange, children, name, type = "checkbox", disabled }: { checked: boolean; onChange: () => void; children: ComponentChildren; name?: string; type?: "checkbox" | "radio"; disabled?: boolean }) {
  return (
    <label class={cx("flex cursor-pointer items-start gap-2.5 text-[13.5px] text-fg", disabled && "cursor-default opacity-60")}>
      {type === "radio" ? (
        <input type="radio" name={name} checked={checked} onChange={onChange} disabled={disabled} class="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />
      ) : (
        <input type="checkbox" name={name} checked={checked} onChange={onChange} disabled={disabled} class="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />
      )}
      <span class="min-w-0">{children}</span>
    </label>
  );
}

/** Botões exclusivos (período, filtro). */
export function Segmented<T extends string | number>({ options, value, onChange, label }: { options: { value: T; label: ComponentChildren }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} class="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          class={cx(
            "rounded-md px-3 py-1 text-[13px] font-medium transition",
            o.value === value ? "bg-surface text-fg shadow-card" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Chip alternável; use FilterChips para escolha exclusiva com contagem. */
export function Chip({ pressed, class: klass, children, ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & { pressed: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      class={cx(
        "shrink-0 rounded-full border px-3 py-1 text-[13px] font-medium transition",
        pressed ? "border-transparent bg-fg text-bg" : "border-line bg-surface text-muted hover:text-fg",
        klass as string,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Chips de filtro com contagem. */
export function FilterChips<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} class="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 scrollbar-none sm:mx-0 sm:flex-wrap sm:px-0">
      {options.map((o) => (
        <Chip pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count !== undefined && <span class="ml-1.5 opacity-60">{o.count}</span>}
        </Chip>
      ))}
    </div>
  );
}

// --- diálogo --------------------------------------------------------------

/** Diálogo shadcn/Radix: foco preso, Escape e clique externo fecham. */
export function Dialog({ title, subtitle, onClose, children, footer }: { title: ComponentChildren; subtitle?: ComponentChildren; onClose: () => void; children: ComponentChildren; footer?: ComponentChildren }) {
 return <DialogRoot open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden border-line bg-surface p-0 text-fg sm:max-w-2xl">
  <DialogHeader className="shrink-0 border-b border-line px-6 py-4 pr-12"><DialogTitle>{title}</DialogTitle>{subtitle?<DialogDescription>{subtitle}</DialogDescription>:<DialogDescription className="sr-only">{title}</DialogDescription>}</DialogHeader>
  <div class="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
  {footer&&<DialogFooter className="shrink-0 flex-wrap justify-start border-t border-line bg-surface-2/40 px-6 py-4">{footer}</DialogFooter>}
 </DialogContent></DialogRoot>;
}

// --- avisos -----------------------------------------------------------------

export function Toaster() {
  const toasts = useToasts();
  return (
    <div class="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6 lg:items-end lg:px-6" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          class="pointer-events-auto flex w-full max-w-sm animate-toast-in items-start gap-2.5 rounded-xl border border-line bg-surface px-3.5 py-3 text-[13.5px] shadow-pop"
        >
          {t.tone === "ok" ? (
            <CircleCheck class="mt-px size-4 shrink-0 text-ok" />
          ) : t.tone === "bad" ? (
            <CircleX class="mt-px size-4 shrink-0 text-bad" />
          ) : (
            <Info class="mt-px size-4 shrink-0 text-accent" />
          )}
          <div class="min-w-0 flex-1">
            <div class="font-medium">{t.text}</div>
            {t.detail && <div class="mt-0.5 text-[12.5px] text-muted">{t.detail}</div>}
          </div>
          <IconButton size="sm" label="Fechar aviso" class="-m-1" onClick={() => dismiss(t.id)}>
            <X class="size-3.5" />
          </IconButton>
        </div>
      ))}
    </div>
  );
}
