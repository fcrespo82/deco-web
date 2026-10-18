/** Componentes visuais básicos, todos sobre os tokens de styles.css. */
import type { ButtonHTMLAttributes, ComponentChildren, HTMLAttributes } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { CircleCheck, CircleX, Info, LoaderCircle, TriangleAlert, X } from "lucide-preact";
import { dismiss, useToasts } from "./lib/toast";

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

export type Tone = "ok" | "warn" | "bad" | "accent" | "";

// --- botões -----------------------------------------------------------

type ButtonVariant = "default" | "primary" | "danger" | "danger-solid" | "ghost";
const BUTTON: Record<ButtonVariant, string> = {
  default: "border border-line bg-surface text-fg shadow-card hover:bg-surface-2",
  primary: "border border-transparent bg-accent text-accent-fg shadow-card hover:brightness-110",
  danger: "border border-line bg-surface text-bad shadow-card hover:bg-bad-soft",
  "danger-solid": "border border-transparent bg-bad text-white shadow-card hover:brightness-110",
  ghost: "border border-transparent text-muted hover:bg-surface-2 hover:text-fg",
};

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size" | "loading" | "type" | "icon"> & {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  loading?: boolean;
  icon?: ComponentChildren;
  type?: "button" | "submit";
};

export function Button({ variant = "default", size = "md", loading, icon, class: klass, children, disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      class={cx(
        "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition",
        "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
        size === "sm" ? "h-7 px-2.5 text-[12.5px]" : "h-9 px-3.5 text-[13.5px]",
        BUTTON[variant],
        klass as string,
      )}
      {...rest}
    >
      {loading ? <LoaderCircle class="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ label, children, class: klass, ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      class={cx(
        "inline-flex size-9 items-center justify-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg active:scale-95 disabled:opacity-50",
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
    <span title={title} class={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-px text-[12px] font-medium", BADGE[tone], klass)}>
      {children}
    </span>
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
  return (
    <div class={cx("min-w-0 rounded-xl border border-line bg-surface p-4 shadow-card", klass as string)} {...rest}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, actions, class: klass }: { children: ComponentChildren; actions?: ComponentChildren; class?: string }) {
  return (
    <div class={cx("mb-3 mt-8 flex flex-wrap items-center gap-x-3 gap-y-2 first:mt-0", klass)}>
      <h2 class="flex-1 text-[15px] font-semibold tracking-tight">{children}</h2>
      {actions && <div class="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function TableCard({ children }: { children: ComponentChildren }) {
  return <div class="md:overflow-hidden md:rounded-xl md:border md:border-line md:bg-surface md:shadow-card">{children}</div>;
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

/** Chips de filtro com contagem. */
export function FilterChips<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} class="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 scrollbar-none sm:mx-0 sm:flex-wrap sm:px-0">
      {options.map((o) => (
        <button
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          class={cx(
            "shrink-0 rounded-full border px-3 py-1 text-[13px] font-medium transition",
            o.value === value ? "border-transparent bg-fg text-bg" : "border-line bg-surface text-muted hover:text-fg",
          )}
        >
          {o.label}
          {o.count !== undefined && <span class="ml-1.5 opacity-60">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

// --- diálogo --------------------------------------------------------------

/** Diálogo nativo (<dialog>): foco preso, Esc fecha; folha de baixo no celular. */
export function Dialog({ title, subtitle, onClose, children, footer }: { title: ComponentChildren; subtitle?: ComponentChildren; onClose: () => void; children: ComponentChildren; footer?: ComponentChildren }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    if (!dialog.open) dialog.showModal();
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    dialog.addEventListener("cancel", onCancel);
    return () => dialog.removeEventListener("cancel", onCancel);
  }, [onClose]);

  return (
    <dialog ref={ref} class="sheet" aria-labelledby="dialog-title" onClick={(e) => e.target === ref.current && onClose()}>
      <div class="flex max-h-[inherit] flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-pop sm:rounded-2xl">
        <header class="flex items-start gap-3 border-b border-line px-5 py-4">
          <div class="min-w-0 flex-1">
            <h3 id="dialog-title" class="text-[16px] font-semibold tracking-tight [overflow-wrap:anywhere]">
              {title}
            </h3>
            {subtitle && <div class="mt-0.5 text-[12.5px] text-muted">{subtitle}</div>}
          </div>
          <IconButton label="Fechar" onClick={onClose} class="-mr-2 -mt-1">
            <X class="size-4" />
          </IconButton>
        </header>
        <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer class="flex flex-wrap items-center gap-2 border-t border-line bg-surface-2/40 px-5 py-3 pb-safe">{footer}</footer>}
      </div>
    </dialog>
  );
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
          <button type="button" class="-m-1 rounded p-1 text-muted hover:text-fg" aria-label="Fechar aviso" onClick={() => dismiss(t.id)}>
            <X class="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
