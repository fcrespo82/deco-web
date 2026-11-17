import {describe,it,expect} from "vitest";
import {sectionLocation} from "../web/src/lib/section-routes.js";
describe("navegação unificada",()=>{
 it.each([
 ["#/clientes","dispositivos","presenca"],["#/inventario","dispositivos","cadastro"],["#/historico","dispositivos","historico"],
 ["#/topologia","infraestrutura","topologia"],["#/ips","enderecamento","plano"],["#/reservas","enderecamento","reservas"],["#/switches","infraestrutura","switches"],
 ])("mantém compatibilidade com %s",(hash,section,tab)=>expect(sectionLocation(hash)).toEqual({section,tab}));
 it("seleciona a aba pela URL canônica",()=>expect(sectionLocation("#/dispositivos?aba=cadastro")).toEqual({section:"dispositivos",tab:"cadastro"}));
 it("mantém as demais telas fora dos agrupamentos",()=>expect(sectionLocation("#/configuracoes?secao=aparencia")).toEqual({section:"configuracoes",tab:""}));
});
