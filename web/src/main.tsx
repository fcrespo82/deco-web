import { render } from "preact";
import type { ComponentType } from "preact";
import { useEffect, useState } from "preact/hooks";
import {
  Bell,
  Boxes,
  Clock,
  DatabaseBackup,
  Ellipsis,
  LayoutDashboard,
  Lock,
  LogOut,
  MonitorSmartphone,
  Moon,
  Network,
  Palette,
  Sun,
  SunMoon,
} from "lucide-preact";
import { api, ApiError } from "./api";
import { useRoute, useTheme } from "./hooks";
import { connectLive, disconnectLive } from "./lib/live";
import { Alerts } from "./pages/Alerts";
import { Appearance } from "./pages/Appearance";
import { Backup } from "./pages/Backup";
import { Clients } from "./pages/Clients";
import { History } from "./pages/History";
import { Inventory } from "./pages/Inventory";
import { IpPlan } from "./pages/IpPlan";
import { Overview } from "./pages/Overview";
import { Reservations } from "./pages/Reservations";
import { ModeBadge, RefreshButton, StatusBanners, StatusPill } from "./StatusBar";
import { Button, cx, Dialog, IconButton, Toaster } from "./ui";
import "./styles.css";

interface Route {
  path: string;
  label: string;
  short?: string;
  icon: ComponentType<{ class?: string }>;
  page: ComponentType;
  /** Aparece nas abas de baixo no celular (o resto fica em "Mais"). */
  tab?: boolean;
}

const ROUTES: Route[] = [
  { path: "", label: "Visão geral", short: "Início", icon: LayoutDashboard, page: Overview, tab: true },
  { path: "clientes", label: "Clientes", icon: MonitorSmartphone, page: Clients, tab: true },
  { path: "reservas", label: "Reservas", icon: Lock, page: Reservations, tab: true },
  { path: "ips", label: "Plano de IPs", short: "IPs", icon: Network, page: IpPlan, tab: true },
  { path: "inventario", label: "Inventário", icon: Boxes, page: Inventory },
  { path: "historico", label: "Histórico", icon: Clock, page: History },
  { path: "alertas", label: "Alertas", icon: Bell, page: Alerts },
  { path: "backup", label: "Backup", icon: DatabaseBackup, page: Backup },
  { path: "aparencia", label: "Aparência", icon: Palette, page: Appearance },
];

const THEME_LABEL = { auto: "Tema: automático", light: "Tema: claro", dark: "Tema: escuro" } as const;
const THEME_ICON = { auto: SunMoon, light: Sun, dark: Moon } as const;

function Logo({ class: klass }: { class?: string }) {
  return <img src="/favicon.svg" alt="" class={cx("size-7 rounded-lg", klass)} />;
}

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: Event) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha no login.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div class="flex min-h-dvh items-center justify-center bg-[radial-gradient(ellipse_at_top,var(--accent-soft),transparent_60%)] px-4">
      <form onSubmit={submit} class="w-full max-w-sm animate-slide-up rounded-2xl border border-line bg-surface p-6 shadow-pop">
        <div class="mb-6 flex items-center gap-3">
          <Logo class="size-10" />
          <div>
            <h1 class="text-[17px] font-semibold tracking-tight">Deco Dashboard</h1>
            <p class="text-[13px] text-muted">Entre para gerenciar a rede</p>
          </div>
        </div>
        <input
          type="password"
          class="field"
          placeholder="Senha da interface"
          aria-label="Senha da interface"
          autocomplete="current-password"
          value={password}
          onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
          autofocus
        />
        {error && <p class="mt-2 text-[13px] text-bad">{error}</p>}
        <Button type="submit" variant="primary" class="mt-4 w-full" loading={busy} disabled={!password}>
          Entrar
        </Button>
      </form>
    </div>
  );
}

function NavLink({ route, current, onNavigate }: { route: Route; current: boolean; onNavigate?: () => void }) {
  const Icon = route.icon;
  return (
    <a
      href={`#/${route.path}`}
      aria-current={current ? "page" : undefined}
      onClick={onNavigate}
      class={cx(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition",
        current ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-fg",
      )}
    >
      <Icon class="size-[18px] shrink-0" />
      {route.label}
    </a>
  );
}

function ThemeButton({ theme, cycle, withLabel }: { theme: keyof typeof THEME_LABEL; cycle: () => void; withLabel?: boolean }) {
  const Icon = THEME_ICON[theme];
  if (withLabel) {
    return (
      <button type="button" onClick={cycle} class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium text-muted transition hover:bg-surface-2 hover:text-fg">
        <Icon class="size-[18px]" />
        {THEME_LABEL[theme]}
      </button>
    );
  }
  return (
    <IconButton label={THEME_LABEL[theme]} onClick={cycle}>
      <Icon class="size-[18px]" />
    </IconButton>
  );
}

function App() {
  const route = useRoute();
  const [theme, cycleTheme] = useTheme();
  const [auth, setAuth] = useState<{ authRequired: boolean; authenticated: boolean } | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  const checkAuth = () => api.me().then(setAuth, () => setAuth({ authRequired: true, authenticated: false }));
  useEffect(() => {
    void checkAuth();
  }, []);

  // O canal ao vivo só abre logado; se o servidor recusar, confere a sessão.
  useEffect(() => {
    if (!auth?.authenticated) return;
    connectLive(() => void checkAuth());
    return () => disconnectLive();
  }, [auth?.authenticated]);

  useEffect(() => {
    setMoreOpen(false);
    window.scrollTo({ top: 0 });
  }, [route]);

  if (!auth) return null;
  if (!auth.authenticated) return <Login onDone={checkAuth} />;

  const current = ROUTES.find((r) => r.path === route) ?? ROUTES[0]!;
  const Page = current.page;
  const logout = () => api.logout().then(checkAuth);
  const inMore = !current.tab;

  return (
    <div class="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      {/* Barra lateral (desktop) */}
      <aside class="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface lg:flex">
        <div class="flex items-center gap-2.5 px-5 py-5">
          <Logo />
          <span class="text-[15px] font-semibold tracking-tight">Deco Dashboard</span>
        </div>
        <nav class="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3" aria-label="Principal">
          {ROUTES.map((r) => (
            <NavLink route={r} current={r === current} />
          ))}
        </nav>
        <div class="grid gap-3 border-t border-line p-4">
          <ModeBadge />
          <div class="flex items-center gap-1">
            <ThemeButton theme={theme} cycle={cycleTheme} />
            {auth.authRequired && (
              <IconButton label="Sair" onClick={logout}>
                <LogOut class="size-[18px]" />
              </IconButton>
            )}
          </div>
        </div>
      </aside>

      <div class="min-w-0">
        {/* Topo */}
        <header class="sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur-md">
          <div class="mx-auto flex h-14 max-w-[1240px] items-center gap-3 px-4 lg:px-8">
            <Logo class="lg:hidden" />
            <h1 class="min-w-0 truncate text-[16px] font-semibold tracking-tight lg:text-[18px]">{current.label}</h1>
            <span class="flex-1" />
            <div class="hidden sm:block">
              <StatusPill />
            </div>
            <div class="sm:hidden">
              <StatusPill compact />
            </div>
            <div class="hidden sm:block">
              <RefreshButton />
            </div>
            <div class="sm:hidden">
              <RefreshButton icon />
            </div>
          </div>
        </header>

        <main class="mx-auto max-w-[1240px] px-4 pb-28 pt-5 lg:px-8 lg:pb-12 lg:pt-6">
          <StatusBanners />
          <div key={current.path} class="animate-fade-in">
            <Page />
          </div>
        </main>
      </div>

      {/* Abas de baixo (celular) */}
      <nav class="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/90 pb-safe backdrop-blur-md lg:hidden" aria-label="Principal">
        <div class="mx-auto grid max-w-lg grid-cols-5">
          {ROUTES.filter((r) => r.tab).map((r) => {
            const Icon = r.icon;
            const on = r === current;
            return (
              <a href={`#/${r.path}`} aria-current={on ? "page" : undefined} class={cx("flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition", on ? "text-accent" : "text-muted")}>
                <Icon class="size-5" />
                {r.short ?? r.label}
              </a>
            );
          })}
          <button type="button" onClick={() => setMoreOpen(true)} class={cx("flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", inMore ? "text-accent" : "text-muted")} aria-haspopup="dialog">
            <Ellipsis class="size-5" />
            {inMore ? current.label : "Mais"}
          </button>
        </div>
      </nav>

      {moreOpen && (
        <Dialog title="Mais" onClose={() => setMoreOpen(false)}>
          <nav class="grid gap-0.5" aria-label="Mais telas">
            {ROUTES.filter((r) => !r.tab).map((r) => (
              <NavLink route={r} current={r === current} onNavigate={() => setMoreOpen(false)} />
            ))}
          </nav>
          <div class="mt-3 grid gap-0.5 border-t border-line pt-3">
            <ThemeButton theme={theme} cycle={cycleTheme} withLabel />
            {auth.authRequired && (
              <button type="button" onClick={logout} class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium text-muted transition hover:bg-surface-2 hover:text-fg">
                <LogOut class="size-[18px]" />
                Sair
              </button>
            )}
          </div>
          <div class="mt-4 border-t border-line pt-3">
            <ModeBadge />
          </div>
        </Dialog>
      )}
      <Toaster />
    </div>
  );
}

render(<App />, document.getElementById("app")!);
