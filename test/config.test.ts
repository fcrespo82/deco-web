import { describe, expect, it } from "vitest";
import { ConfigError, describeConfig, loadConfig, loadDecoPassword } from "../src/config.js";

describe("config", () => {
  it("padrões seguros: somente leitura, poll 90s", () => {
    const c = loadConfig({ DECO_HOST: "192.168.68.1" });
    expect(c).toMatchObject({ allowWrite: false, allowDangerous: false, pollIntervalMs: 90_000, mock: false });
  });

  it("recusa poll curto demais e perigosas sem escrita", () => {
    expect(() => loadConfig({ DECO_HOST: "x", POLL_INTERVAL: "10" })).toThrow(ConfigError);
    expect(() => loadConfig({ DECO_HOST: "x", DECO_ALLOW_DANGEROUS: "1" })).toThrow(ConfigError);
  });

  it("exige host, exceto no mock", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(loadConfig({ DECO_MOCK: "1" }).mock).toBe(true);
  });

  it("a senha nunca entra no Config nem no resumo", () => {
    const env = { DECO_HOST: "h", DECO_PASSWORD: "s3cr3t-xyz" };
    const c = loadConfig(env);
    expect(JSON.stringify(c)).not.toContain("s3cr3t-xyz");
    expect(describeConfig(c)).not.toContain("s3cr3t-xyz");
    expect(loadDecoPassword(env)).toBe("s3cr3t-xyz");
  });

  it("exige senha fora do mock", () => {
    expect(() => loadDecoPassword({})).toThrow(ConfigError);
  });
});
