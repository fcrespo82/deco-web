/**
 * GET /metrics no formato texto do Prometheus (0.0.4).
 *
 * Sai inteiro do cache do poller: um scrape nunca abre sessão no Deco, então
 * o intervalo de scrape pode ser qualquer um. Os valores mudam no ritmo do
 * POLL_INTERVAL. Sem snapshot, só as métricas do próprio painel aparecem.
 */
import type { Band, Snapshot } from "../deco-client/types.js";
import type { PollerCache } from "../core/poller.js";

interface Sample {
  labels?: Record<string, string>;
  value: number;
}

interface Family {
  name: string;
  help: string;
  type: "gauge" | "counter";
  samples: Sample[];
}

const escape = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");

function render(families: Family[]): string {
  const out: string[] = [];
  for (const f of families) {
    out.push(`# HELP ${f.name} ${f.help}`, `# TYPE ${f.name} ${f.type}`);
    for (const s of f.samples) {
      const labels = Object.entries(s.labels ?? {});
      const l = labels.length ? `{${labels.map(([k, v]) => `${k}="${escape(v)}"`).join(",")}}` : "";
      out.push(`${f.name}${l} ${Number.isFinite(s.value) ? s.value : "NaN"}`);
    }
  }
  return out.join("\n") + "\n";
}

const BANDS: Band[] = ["wired", "2.4GHz", "5GHz", "6GHz"];
const seconds = (iso: string | null | undefined) => (iso ? Date.parse(iso) / 1000 : NaN);

export interface MetricsInput {
  cache: PollerCache;
  now: Date;
  pollIntervalMs: number;
  /** Apelido do inventário por MAC, preferido ao nome do Deco. */
  aliasOf?: (mac: string) => string | null | undefined;
}

export function buildMetrics({ cache, now, pollIntervalMs, aliasOf }: MetricsInput): string {
  const snap: Snapshot | null = cache.snapshot;
  const fetched = seconds(cache.fetchedAt);
  const families: Family[] = [
    {
      name: "deco_up",
      help: "1 se o último poll do Deco deu certo e o snapshot tem menos de 3 intervalos de poll.",
      type: "gauge",
      samples: [
        {
          value:
            snap && !cache.lastError && Number.isFinite(fetched) && now.getTime() / 1000 - fetched < (3 * pollIntervalMs) / 1000 ? 1 : 0,
        },
      ],
    },
    {
      name: "deco_last_success_timestamp_seconds",
      help: "Hora do último snapshot obtido com sucesso (unix).",
      type: "gauge",
      samples: [{ value: fetched }],
    },
    {
      name: "deco_breaker_state",
      help: "Estado do circuit breaker de acesso ao Deco (1 no estado atual).",
      type: "gauge",
      samples: (["closed", "open", "locked"] as const).map((state) => ({ labels: { state }, value: cache.breaker === state ? 1 : 0 })),
    },
    {
      name: "deco_poll_paused",
      help: "1 enquanto as leituras estão suspensas (gateway reiniciando).",
      type: "gauge",
      samples: [{ value: cache.pausedUntil && Date.parse(cache.pausedUntil) > now.getTime() ? 1 : 0 }],
    },
  ];
  if (!snap) return render(families);

  const online = snap.clients;
  const byNode = new Map<string, number>();
  for (const c of online) if (c.nodeMac) byNode.set(c.nodeMac, (byNode.get(c.nodeMac) ?? 0) + 1);
  const networks = [...new Set(online.map((c) => c.network))].sort();
  const name = (mac: string, fallback: string) => aliasOf?.(mac) || fallback;

  families.push(
    {
      name: "deco_node_up",
      help: "1 se o nó do mesh está online.",
      type: "gauge",
      samples: snap.nodes.map((n) => ({
        labels: { mac: n.mac, name: n.name, model: n.model, role: n.role === "master" ? "gateway" : "satellite" },
        value: n.online ? 1 : 0,
      })),
    },
    {
      name: "deco_node_info",
      help: "Firmware e IP de cada nó (valor sempre 1).",
      type: "gauge",
      samples: snap.nodes.map((n) => ({ labels: { mac: n.mac, firmware: n.firmware, ip: n.ip ?? "" }, value: 1 })),
    },
    {
      name: "deco_node_clients",
      help: "Clientes conectados ao nó (atualizado na leitura detalhada).",
      type: "gauge",
      samples: snap.nodes.map((n) => ({ labels: { mac: n.mac, name: n.name }, value: byNode.get(n.mac) ?? 0 })),
    },
    {
      name: "deco_node_uplink_signal",
      help: "Barras de sinal (0–3) do uplink sem fio do satélite, por banda.",
      type: "gauge",
      samples: snap.nodes.flatMap((n) =>
        (["2.4GHz", "5GHz"] as const)
          .filter((b) => n.signal[b] !== null)
          .map((b) => ({ labels: { mac: n.mac, name: n.name, band: b }, value: n.signal[b]! })),
      ),
    },
    {
      name: "deco_clients",
      help: "Clientes online por banda.",
      type: "gauge",
      samples: BANDS.map((band) => ({ labels: { band }, value: online.filter((c) => c.band === band).length })),
    },
    {
      name: "deco_clients_by_network",
      help: "Clientes online por rede lógica (main, guest, iot).",
      type: "gauge",
      samples: networks.map((network) => ({ labels: { network }, value: online.filter((c) => c.network === network).length })),
    },
    {
      name: "deco_client_up_bytes_per_second",
      help: "Taxa instantânea de upload do cliente, no momento da leitura (o Deco não tem contador acumulado).",
      type: "gauge",
      samples: online.map((c) => ({ labels: { mac: c.mac, name: name(c.mac, c.name) }, value: c.upKBps * 1024 })),
    },
    {
      name: "deco_client_down_bytes_per_second",
      help: "Taxa instantânea de download do cliente, no momento da leitura.",
      type: "gauge",
      samples: online.map((c) => ({ labels: { mac: c.mac, name: name(c.mac, c.name) }, value: c.downKBps * 1024 })),
    },
    {
      name: "deco_reservations",
      help: "Reservas de DHCP no Deco.",
      type: "gauge",
      samples: [{ value: snap.reservations.length }],
    },
  );
  if (snap.reservationMax !== null) {
    families.push({ name: "deco_reservations_max", help: "Limite de reservas do firmware.", type: "gauge", samples: [{ value: snap.reservationMax }] });
  }
  if (snap.internet) {
    families.push({
      name: "deco_internet_up",
      help: "1 se o Deco informa a internet online.",
      type: "gauge",
      samples: [
        { labels: { family: "ipv4" }, value: snap.internet.ipv4Online ? 1 : 0 },
        { labels: { family: "ipv6" }, value: snap.internet.ipv6Online ? 1 : 0 },
      ],
    });
  }
  if (snap.performance) {
    families.push(
      { name: "deco_cpu_ratio", help: "Uso de CPU do gateway (0–1).", type: "gauge", samples: [{ value: snap.performance.cpu }] },
      { name: "deco_memory_ratio", help: "Uso de memória do gateway (0–1).", type: "gauge", samples: [{ value: snap.performance.memory }] },
    );
  }
  if (snap.wifi) {
    families.push({
      name: "deco_wifi_enabled",
      help: "1 se a rede Wi-Fi está ativa.",
      type: "gauge",
      samples: snap.wifi.map((w) => ({ labels: { network: w.kind, band: w.band, ssid: w.ssid }, value: w.enabled ? 1 : 0 })),
    });
  }
  return render(families);
}
