export const SECTION_ALIASES:Record<string,{section:string;tab:string}>={
 topologia:{section:"infraestrutura",tab:"topologia"},
 clientes:{section:"dispositivos",tab:"presenca"},inventario:{section:"dispositivos",tab:"cadastro"},historico:{section:"dispositivos",tab:"historico"},
 ips:{section:"enderecamento",tab:"plano"},reservas:{section:"enderecamento",tab:"reservas"},switches:{section:"infraestrutura",tab:"switches"},
};
export function sectionLocation(hash:string){const [path="",query=""]=hash.replace(/^#\/?/,"").split("?");return SECTION_ALIASES[path]??{section:path,tab:new URLSearchParams(query).get("aba")??""};}
