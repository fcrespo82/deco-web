/** Aritmética de IPv4 e leitura de faixas escritas pelo usuário. Puro. */

export function ipToInt(ip: string): number {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) throw new Error(`IP inválido: ${ip}`);
  return parts.reduce((acc, p) => {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) throw new Error(`IP inválido: ${ip}`);
    return acc * 256 + Number(p);
  }, 0);
}

export function intToIp(n: number): string {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

export interface Subnet {
  /** Endereço de rede (ex.: 192.168.68.0) como inteiro. */
  base: number;
  prefix: number;
  size: number;
}

export function maskToPrefix(mask: string): number {
  const n = ipToInt(mask);
  const bits = n.toString(2).padStart(32, "0");
  if (!/^1*0*$/.test(bits)) throw new Error(`Máscara inválida: ${mask}`);
  return bits.indexOf("0") === -1 ? 32 : bits.indexOf("0");
}

export function subnetOf(ip: string, mask: string): Subnet {
  const prefix = maskToPrefix(mask);
  const size = 2 ** (32 - prefix);
  const base = Math.floor(ipToInt(ip) / size) * size;
  return { base, prefix, size };
}

export function inSubnet(ip: number, s: Subnet): boolean {
  return ip >= s.base && ip < s.base + s.size;
}

/**
 * Lê uma faixa relativa à sub-rede. Aceita:
 *   192.168.68.8/29   .8/29   8/29        → bloco CIDR (alinhado)
 *   192.168.68.20-192.168.68.39   .20-.39   20-39
 *   .100+   100+                        → até o último utilizável
 *   .50     50                          → um único endereço
 * Endereços curtos são o último octeto (sub-rede /24 ou maior).
 */
export function parseRangeSpec(spec: string, subnet: Subnet): { start: number; end: number } {
  const text = spec.trim().replace(/\s+/g, "");
  const prefix24 = Math.floor(subnet.base / 256) * 256;
  const addr = (part: string): number => {
    const p = part.replace(/^\./, "");
    if (/^\d{1,3}$/.test(p)) {
      if (Number(p) > 255) throw new Error(`Octeto inválido: ${part}`);
      return prefix24 + Number(p);
    }
    return ipToInt(p);
  };
  const lastUsable = subnet.base + subnet.size - 2;

  let start: number;
  let end: number;
  const cidr = /^(.+)\/(\d{1,2})$/.exec(text);
  const span = /^(.+)-(.+)$/.exec(text);
  if (cidr) {
    const bits = Number(cidr[2]);
    if (bits < subnet.prefix || bits > 32) throw new Error(`Prefixo /${bits} fora da sub-rede /${subnet.prefix}`);
    const size = 2 ** (32 - bits);
    start = addr(cidr[1]!);
    if (start % size !== 0) {
      throw new Error(`${intToIp(start)}/${bits} não é um bloco alinhado (use ${intToIp(start - (start % size))}/${bits})`);
    }
    end = start + size - 1;
  } else if (text.endsWith("+")) {
    start = addr(text.slice(0, -1));
    end = lastUsable;
  } else if (span) {
    start = addr(span[1]!);
    end = addr(span[2]!);
  } else {
    start = end = addr(text);
  }

  if (end < start) throw new Error("O fim da faixa é menor que o início");
  if (!inSubnet(start, subnet) || !inSubnet(end, subnet)) {
    throw new Error(`Faixa fora da rede ${intToIp(subnet.base)}/${subnet.prefix}`);
  }
  return { start, end };
}

/** Texto curto para exibir uma faixa: ".8/29", ".20–.39", ".50". */
export function formatRange(start: number, end: number): string {
  const size = end - start + 1;
  const octet = (n: number) => `.${n & 255}`;
  if (size === 1) return octet(start);
  if ((size & (size - 1)) === 0 && start % size === 0 && size > 1) {
    return `${octet(start)}/${32 - Math.log2(size)}`;
  }
  return `${octet(start)}–${octet(end)}`;
}
