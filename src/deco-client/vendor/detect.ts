// Vendored from https://github.com/fullo/deco-mcp @ 94b0463 (MIT, (c) Francesco Fullone). See THIRD_PARTY_NOTICES.md.
/**
 * Runtime discovery of what a specific Deco serves.
 *
 * The catalogue is a superset of forms known across Deco models and firmwares.
 * Any given unit serves only part of it — an M9 Plus on 1.9.1 serves the `web`
 * set and rejects the rest with error_code 1. Rather than hardcode that, these
 * helpers ask the device: what model are you, and which read forms answer.
 *
 * This is what makes the harness portable. On a different Deco, the catalogue
 * does not change; the capability probe reports a different served set.
 */
import type { DecoClient } from "./client.js";
import { CATALOG } from "./catalog.js";
import { DecoApiError } from "./errors.js";

export interface DeviceInfo {
  model: string;
  firmware: string;
  hardware?: string;
  role: string;
}

/** Identify the mesh from its node list: model and firmware of the gateway. */
export async function detectDevice(client: DecoClient): Promise<DeviceInfo | null> {
  const result = await client.call<{ device_list?: Record<string, unknown>[] }>({
    endpoint: "admin/device",
    form: "device_list",
    operation: "read",
  });
  const nodes = result.device_list ?? [];
  // The master/gateway node is the one that answers for the mesh.
  const master =
    nodes.find((n) => String(n.role ?? "").toLowerCase() === "master") ?? nodes[0];
  if (!master) return null;
  return {
    model: String(master.device_model ?? master.hardware_ver ?? "unknown"),
    firmware: String(master.software_ver ?? "unknown"),
    hardware: master.hardware_ver ? String(master.hardware_ver) : undefined,
    role: String(master.role ?? "unknown"),
  };
}

export interface CapabilityReport {
  device: DeviceInfo | null;
  served: string[];
  unserved: string[];
  errors: Record<string, string>;
}

/**
 * Probe every read operation in the catalogue once and record which the device
 * actually serves. Reads only — never touches a write or dangerous operation —
 * so it is safe to run against any Deco. Sequential, because the firmware does
 * not handle parallel calls on one session well.
 */
export async function probeCapabilities(client: DecoClient): Promise<CapabilityReport> {
  const device = await detectDevice(client).catch(() => null);
  const served: string[] = [];
  const unserved: string[] = [];
  const errors: Record<string, string> = {};

  for (const entry of CATALOG) {
    const readOp = Object.entries(entry.operations).find(([, risk]) => risk === "read");
    if (!readOp) continue;
    const key = `${entry.endpoint}?form=${entry.form}`;
    try {
      await client.call({
        endpoint: entry.endpoint,
        form: entry.form,
        operation: readOp[0],
        // A couple of forms want a selector; "default" is accepted where it applies.
        ...(entry.form === "client_list" ? { params: { device_mac: "default" } } : {}),
      });
      served.push(key);
    } catch (err) {
      unserved.push(key);
      // error_code 1 means "not served here"; anything else is worth surfacing.
      if (!(err instanceof DecoApiError)) {
        errors[key] = (err as Error).message.slice(0, 120);
      }
    }
  }
  return { device, served, unserved, errors };
}
