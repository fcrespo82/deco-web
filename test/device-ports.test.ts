import {describe,it,expect} from "vitest";
import {configureDevicePorts} from "../web/src/lib/device-ports.js";
import type {PhysicalTopology} from "../src/switches/topology.js";
const config:PhysicalTopology={nodes:[{id:"infra:nas",name:"NAS",kind:"device",portCount:2}],links:[{source:"infra:nas",target:"client:a",sourcePort:"1",targetPort:"LAN",kind:"wired"},{source:"infra:switch",target:"infra:nas",sourcePort:"8",targetPort:"2",kind:"wired"}]};
describe("editor compartilhado de portas",()=>{
 it("renomeia as duas pontas dos cabos sem alterar o original",()=>{const before=JSON.stringify(config);const next=configureDevicePorts(config,"infra:nas",["eth0","eth1"],["1","2"]);expect(next.links[0]!.sourcePort).toBe("eth0");expect(next.links[1]!.targetPort).toBe("eth1");expect(next.portNames!["infra:nas"]).toEqual(["eth0","eth1"]);expect(next.nodes[0]!.portCount).toBe(2);expect(JSON.stringify(config)).toBe(before);});
 it("mantém o cabo ao remover uma porta e marca a ponta como desconhecida",()=>{const next=configureDevicePorts(config,"infra:nas",["eth0"],["1","2"]);expect(next.links).toHaveLength(2);expect(next.links[1]!.targetPort).toBe("");expect(next.portCounts!["infra:nas"]).toBe(1);});
 it("recusa nomes repetidos ou maiores que o limite",()=>{expect(()=>configureDevicePorts(config,"infra:nas",["eth0","eth0"],[])).toThrow();expect(()=>configureDevicePorts(config,"infra:nas",["x".repeat(33)],[])).toThrow();});
});
