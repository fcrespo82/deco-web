/**
 * Destrava o circuit breaker persistido (depois de corrigir a senha do Deco).
 * Rode com o servidor parado: o processo em execução guarda o estado em memória.
 */
import { join } from "node:path";
import { INITIAL_BREAKER_STATE } from "../src/core/breaker.js";
import { Store } from "../src/db/store.js";

const dataDir = process.env.DATA_DIR?.trim() || "/data";
const store = new Store(join(dataDir, "deco-web.sqlite"));
store.setJson("breaker_state", INITIAL_BREAKER_STATE);
store.close();
console.log(`Circuit breaker destravado em ${dataDir}.`);
