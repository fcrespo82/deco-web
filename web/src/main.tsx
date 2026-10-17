import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { api, ApiError } from "./api";
import { useRoute, useTheme } from "./hooks";
import { Clients } from "./pages/Clients";
import { History } from "./pages/History";
import { Inventory } from "./pages/Inventory";
import { IpPlan } from "./pages/IpPlan";
import { Overview } from "./pages/Overview";
import "./styles.css";

const ROUTES = [
  { path: "", label: "Visão geral", page: Overview },
  { path: "clientes", label: "Clientes", page: Clients },
  { path: "inventario", label: "Inventário", page: Inventory },
  { path: "ips", label: "Plano de IPs", page: IpPlan },
  { path: "historico", label: "Histórico", page: History },
];

const THEME_LABEL = { auto: "Tema: automático", light: "Tema: claro", dark: "Tema: escuro" } as const;
const THEME_ICON = { auto: "◐", light: "☀", dark: "☾" } as const;

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
    <div class="card login">
      <h1 style="font-size:18px;margin:0 0 12px">Deco Dashboard</h1>
      <form onSubmit={submit}>
        <input
          type="password"
          placeholder="Senha da interface"
          autocomplete="current-password"
          value={password}
          onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
          autofocus
        />
        {error && <div class="error">{error}</div>}
        <button class="btn primary" disabled={busy || !password}>
          Entrar
        </button>
      </form>
    </div>
  );
}

function App() {
  const route = useRoute();
  const [theme, cycleTheme] = useTheme();
  const [auth, setAuth] = useState<{ authRequired: boolean; authenticated: boolean } | null>(null);

  const checkAuth = () => api.me().then(setAuth, () => setAuth({ authRequired: true, authenticated: false }));
  useEffect(() => {
    void checkAuth();
  }, []);
  // No celular a navegação rola na horizontal: mantém a aba ativa visível.
  useEffect(() => {
    document.querySelector('.nav a[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [route, auth?.authenticated]);

  if (!auth) return null;
  if (!auth.authenticated) return <Login onDone={checkAuth} />;

  const current = ROUTES.find((r) => r.path === route) ?? ROUTES[0]!;
  const Page = current.page;

  return (
    <>
      <header class="topbar">
        <div class="brand">
          <img src="/favicon.svg" alt="" />
          <span>Deco Dashboard</span>
        </div>
        <nav class="nav">
          {ROUTES.map((r) => (
            <a href={`#/${r.path}`} aria-current={r === current ? "page" : undefined}>
              {r.label}
            </a>
          ))}
        </nav>
        <span class="spacer" />
        <button class="btn icon" onClick={cycleTheme} title={THEME_LABEL[theme]} aria-label={THEME_LABEL[theme]}>
          {THEME_ICON[theme]}
        </button>
        {auth.authRequired && (
          <button class="btn" onClick={() => api.logout().then(checkAuth)}>
            Sair
          </button>
        )}
      </header>
      <main>
        <Page />
      </main>
    </>
  );
}

render(<App />, document.getElementById("app")!);
