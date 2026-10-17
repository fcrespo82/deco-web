/** Entrada inválida do usuário; a API responde 400 com a mensagem. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Registro inexistente; a API responde 404. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

const MAC_RE = /^[0-9A-F]{2}(-[0-9A-F]{2}){5}$/;

/** Normaliza para o formato do firmware (AA-BB-CC-DD-EE-FF) e valida. */
export function requireMac(value: unknown): string {
  const mac = typeof value === "string" ? value.trim().toUpperCase().replace(/[:.]/g, "-") : "";
  if (!MAC_RE.test(mac)) throw new ValidationError(`MAC inválido: ${String(value)}`);
  return mac;
}

export function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new ValidationError(`${field} deve ser texto`);
  const text = value.trim();
  if (text.length > max) throw new ValidationError(`${field}: máximo de ${max} caracteres`);
  return text || null;
}

export function requireText(value: unknown, field: string, max: number): string {
  const text = optionalText(value, field, max);
  if (!text) throw new ValidationError(`${field} é obrigatório`);
  return text;
}

export function stringList(value: unknown, field: string, maxItems: number, maxLen: number): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError(`${field} deve ser uma lista`);
  const out = [
    ...new Set(
      value.map((v) => {
        if (typeof v !== "string") throw new ValidationError(`${field}: itens devem ser texto`);
        const t = v.trim();
        if (t.length > maxLen) throw new ValidationError(`${field}: item com mais de ${maxLen} caracteres`);
        return t;
      }),
    ),
  ].filter(Boolean);
  if (out.length > maxItems) throw new ValidationError(`${field}: máximo de ${maxItems} itens`);
  return out;
}
