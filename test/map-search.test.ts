import {it,expect} from "vitest";
import {mapMatches} from "../web/src/lib/map-search.js";
it("busca por palavras ignorando acentos e caixa",()=>{expect(mapMatches("ESCRITORIO nas","NAS principal","Escritório")).toBe(true);expect(mapMatches("office","Bedroom","X50")).toBe(false);expect(mapMatches("68.5","NAS","192.168.68.5")).toBe(true);expect(mapMatches("",null)).toBe(true);});
