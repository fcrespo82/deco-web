import { ValidationError } from "../db/errors.js";
export interface MapPoint {x:number;y:number}
export type MapPositions = Record<string,MapPoint>;
export interface MapLayoutView {positions:MapPositions;revision:number;initialized:boolean}
export function validMapPositions(value:unknown):value is MapPositions {
  return Boolean(value&&typeof value==="object"&&!Array.isArray(value)&&Object.keys(value).length<=1000&&Object.entries(value).every(([key,p])=>key.length<=200&&p&&typeof p==="object"&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<=100000&&Math.abs(p.y)<=100000));
}
export function parseMapPositions(value:unknown):MapPositions {
  if(!validMapPositions(value))throw new ValidationError("Posições do mapa inválidas");
  const out:MapPositions={};
  for(const [id,p]of Object.entries(value)){
    if(!/^(internet|(?:mesh|client|switch|infra):[A-Za-z0-9._:-]{1,180})$/.test(id))throw new ValidationError("Identificador de nó inválido");
    out[id]={x:p.x,y:p.y};
  }
  return out;
}
