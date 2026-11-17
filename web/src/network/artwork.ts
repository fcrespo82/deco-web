import type {EquipmentArtwork} from "../../../src/core/equipment-artwork";
export type {EquipmentArtwork,PhotoPin} from "../../../src/core/equipment-artwork";
export const ARTWORK_KEY='maps.physical.equipmentArtwork';
export function validArtworkRecords(value:unknown):value is Record<string,EquipmentArtwork>{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 return Object.values(value).every(v=>v&&typeof v==='object'&&typeof v.src==='string'&&v.src.startsWith('data:image/png;base64,')&&v.src.length<6_000_000&&Number.isFinite(v.imageWidth)&&v.imageWidth>0&&Number.isFinite(v.imageHeight)&&v.imageHeight>0&&v.pins&&typeof v.pins==='object'&&Object.entries(v.pins).every(([key,p])=>/^\d+$/.test(key)&&p&&typeof p==='object'&&'x'in p&&'y'in p&&'side'in p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Number(p.x)>=0&&Number(p.x)<=1&&Number(p.y)>=0&&Number(p.y)<=1&&['top','bottom','left','right'].includes(String(p.side))));
}
