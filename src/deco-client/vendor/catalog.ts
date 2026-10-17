// Vendored from https://github.com/fullo/deco-mcp @ 94b0463 (MIT, (c) Francesco Fullone). See THIRD_PARTY_NOTICES.md.
/**
 * Catalogue of Deco endpoints, each tagged with how much damage it can do.
 *
 * The risk tag is what gates the generic `deco_call` tool and the write-mode
 * flags: an agent with read access can enumerate the network freely, but
 * cannot reboot a node or drop the Wi-Fi without the operator opting in.
 */

export type Risk =
  /** Reads state. Safe to call at any time. */
  | "read"
  /** Changes configuration, reversible, no loss of connectivity. */
  | "write"
  /** Interrupts the network or destroys configuration. */
  | "dangerous";

export interface CatalogEntry {
  endpoint: string;
  form: string;
  operations: Record<string, Risk>;
  summary: string;
}

/**
 * Only forms listed here can be reached. Anything absent is refused rather
 * than passed through, so a confused agent cannot wander into `/admin/firmware`
 * or the cloud-account endpoints.
 */
export const CATALOG: CatalogEntry[] = [
  // --- mesh nodes ---
  {
    endpoint: "admin/device",
    form: "device_list",
    operations: { read: "read" },
    summary: "The Deco units in the mesh, with role, signal and firmware.",
  },
  {
    endpoint: "admin/device",
    form: "system",
    operations: { reboot: "dangerous" },
    summary: "Reboot one or more Deco units.",
  },
  {
    endpoint: "admin/device",
    form: "speedtest",
    operations: { read: "read", write: "write", stop: "write" },
    summary: "WAN speed test: read the last result, start a run, or stop one.",
  },

  // --- clients ---
  {
    endpoint: "admin/client",
    form: "client_list",
    operations: { read: "read" },
    summary: "Connected clients, per node or across the whole mesh.",
  },
  {
    endpoint: "admin/client",
    form: "traffic_stat",
    // The wire operation is "list", not "read" - "read" is rejected.
    operations: { list: "read" },
    summary: "Per-client traffic counters.",
  },
  {
    endpoint: "admin/client",
    form: "black_list",
    // Enumeration is "list" on the wire. add/remove are documented but this
    // firmware rejects them for a MAC it does not already know as a client.
    operations: { list: "read", add: "write", remove: "write" },
    summary: "Blocked clients.",
  },
  {
    endpoint: "admin/client",
    form: "addr_reservation",
    operations: {
      getlist: "read",
      add: "write",
      modify: "write",
      remove: "write",
    },
    summary: "Static DHCP address reservations.",
  },
  {
    endpoint: "admin/client",
    form: "client",
    operations: { read: "read", write: "write" },
    summary: "Details and nickname of a single client.",
  },
  {
    endpoint: "admin/client",
    form: "client_access",
    operations: { read: "read" },
    summary:
      "Per-client signal bars (signal_level_2g/5g, 0-3) and band. The only per-client signal M9 Plus 1.9.1 exposes; hostnames read UNKNOWN, so join names from client_list.",
  },

  // --- network ---
  {
    endpoint: "admin/network",
    form: "performance",
    operations: { read: "read" },
    summary: "CPU and memory load of the mesh nodes.",
  },
  {
    endpoint: "admin/network",
    form: "internet",
    operations: { read: "read" },
    summary: "Internet connectivity status.",
  },
  {
    endpoint: "admin/network",
    form: "wan_ipv4",
    operations: { read: "read" },
    summary: "IPv4 WAN configuration and link state.",
  },
  {
    endpoint: "admin/network",
    form: "lan_ipv4",
    operations: { read: "read" },
    summary: "LAN address and subnet mask of the gateway node.",
  },
  {
    endpoint: "admin/network",
    form: "dhcp_dial",
    operations: { read: "read" },
    summary: "WAN-side DHCP client mode (whether the WAN IP is leased).",
  },
  {
    endpoint: "admin/network",
    form: "ipv6",
    operations: { read: "read" },
    summary: "IPv6 configuration. Not used standalone on M9 Plus 1.9.1 - IPv6 status is included in the internet form instead.",
  },

  // --- wireless ---
  {
    endpoint: "admin/wireless",
    form: "wlan",
    operations: { read: "read", write: "dangerous" },
    summary: "SSIDs, bands and security. Writing one drops every client.",
  },
  {
    endpoint: "admin/wireless",
    form: "bridge",
    operations: { read: "read" },
    summary: "Node placement grade and PLC support (location: good/fair/poor).",
  },
  {
    endpoint: "admin/wireless",
    form: "bandwidth_enhance",
    operations: { read: "read" },
    summary: "160 MHz channel width (HT160) enable flag.",
  },
  {
    endpoint: "admin/wireless",
    form: "beamforming",
    // Write unverified (toggling a radio could disrupt Wi-Fi); read-only until
    // confirmed. deco_capabilities shows it served for read on this firmware.
    operations: { read: "read" },
    summary: "Beamforming on/off (read-only here; write unverified).",
  },
  {
    endpoint: "admin/wireless",
    form: "ieee80211r",
    // Write unverified; read-only until confirmed.
    operations: { read: "read" },
    summary: "802.11r fast roaming on/off (read-only here; write unverified).",
  },
  {
    endpoint: "admin/wireless",
    form: "operation_mode",
    operations: { read: "read" },
    summary: "Radio operation mode (AP/router role of the radios).",
  },
  {
    endpoint: "admin/network",
    form: "vlan",
    operations: { read: "read" },
    summary: "VLAN enable flag.",
  },
  {
    endpoint: "admin/network",
    form: "igmp_setting",
    operations: { read: "read" },
    summary: "IGMP snooping (multicast/IPTV) setting.",
  },
  {
    endpoint: "admin/network",
    form: "mac_clone",
    operations: { read: "read" },
    summary: "WAN MAC clone enable flag.",
  },
  {
    endpoint: "admin/wireless",
    form: "power",
    operations: { read: "read", write: "write" },
    // On M9 Plus 1.9.1 the read returns {support_dfs}, not a power level.
    summary: "DFS support flag (this firmware returns support_dfs, not a TX power level).",
  },
  {
    endpoint: "admin/wireless",
    form: "wifi_schedule",
    operations: { read: "read", write: "write" },
    // Not served on M9 Plus 1.9.1 (read returns error_code 1) - app-only here.
    // Kept for Deco models that serve the app form set; deco_capabilities shows
    // which unit serves it.
    summary: "Scheduled Wi-Fi on/off windows (app-only on M9 Plus 1.9.1).",
  },

  // --- dhcp ---

  // --- system ---
  {
    endpoint: "admin/device",
    form: "mode",
    operations: { read: "read" },
    summary: "Work mode and system mode (Router or Access Point).",
  },
  {
    endpoint: "admin/network",
    form: "wan_mode",
    operations: { read: "read" },
    summary: "WAN connection mode.",
  },
  {
    endpoint: "admin/device",
    form: "timesetting",
    operations: { read: "read" },
    summary: "Timezone and NTP configuration.",
  },

  // --- ui / component flags ---
  {
    endpoint: "admin/component_control",
    form: "switch_list",
    operations: { read: "read" },
    summary:
      "Web-UI component flags. On M9 Plus 1.9.1 reports show_performance - whether the performance/insights page is exposed in the UI.",
  },
];

export interface ResolvedOperation extends CatalogEntry {
  operation: string;
  risk: Risk;
}

/** Look up a form/operation pair, or explain why it is not reachable. */
export function resolve(
  endpoint: string,
  form: string,
  operation: string,
): ResolvedOperation | { error: string } {
  const entry = CATALOG.find((e) => e.endpoint === endpoint && e.form === form);
  if (!entry) {
    return {
      error:
        `${endpoint}?form=${form} is not in the catalogue. ` +
        `Reachable forms: ${CATALOG.map((e) => `${e.endpoint}?form=${e.form}`).join(", ")}`,
    };
  }
  const risk = entry.operations[operation];
  if (!risk) {
    return {
      error:
        `Operation "${operation}" is not defined for ${endpoint}?form=${form}. ` +
        `Available: ${Object.keys(entry.operations).join(", ")}`,
    };
  }
  return { ...entry, operation, risk };
}

/** Operations that only read state; everything else changes the router. */
const READ_ONLY_OPERATIONS = new Set(["read", "list", "getlist", "get"]);

/**
 * Whether a wire operation mutates router state. Reads (read/list/getlist/get)
 * are idempotent and safe to retry; anything else (add/remove/write/reboot/stop/
 * modify/...) may have already been applied server-side when a response is lost,
 * so it must not be blindly retried. Pure and total, so the retry policy is
 * unit-testable independently of the live client.
 */
export function isMutatingOperation(op: string): boolean {
  return !READ_ONLY_OPERATIONS.has(op.toLowerCase());
}

export interface GateDecision {
  allowed: boolean;
  /** Why it was blocked, for the caller to turn into a message. */
  reason?: "read-only" | "dangerous-blocked";
}

/**
 * Decide whether an operation of a given risk may run under the current
 * permissions. Pure and total, so the security boundary is unit-testable
 * independently of the live client.
 */
export function gate(
  risk: Risk,
  perms: { allowWrite: boolean; allowDangerous: boolean },
): GateDecision {
  if (risk === "read") return { allowed: true };
  if (!perms.allowWrite) return { allowed: false, reason: "read-only" };
  if (risk === "dangerous" && !perms.allowDangerous) {
    return { allowed: false, reason: "dangerous-blocked" };
  }
  return { allowed: true };
}
