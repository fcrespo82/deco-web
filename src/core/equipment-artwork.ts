import {ValidationError} from '../db/errors.js';
import {parseMapPositions} from './map-layout.js';
export interface PhotoPin{x:number;y:number;side:'top'|'bottom'|'left'|'right'}
export interface EquipmentArtwork{src:string;imageWidth:number;imageHeight:number;pins:Record<string,PhotoPin>;kind?:string;deviceType?:string;revision?:number}
export function artworkId(id:string){parseMapPositions({[id]:{x:0,y:0}});return id;}
export function parseEquipmentArtwork(input:unknown):EquipmentArtwork{
 const v=input as EquipmentArtwork;if(!v||typeof v!=='object'||typeof v.src!=='string')throw new ValidationError('Imagem inválida.');
 const src=v.src;
 const prefix='data:image/png;base64,';if(!src.startsWith(prefix)||src.length>5_600_000)throw new ValidationError('Envie um PNG de até 4 MB.');
 const encoded=src.slice(prefix.length),bytes=Buffer.from(encoded,'base64');
 if(bytes.length>4*1024*1024||bytes.length<45||bytes.toString('base64')!==encoded||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.toString('ascii',12,16)!=='IHDR'||bytes.toString('ascii',bytes.length-8,bytes.length-4)!=='IEND')throw new ValidationError('PNG inválido.');
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
 if(!width||!height||width>8192||height>8192||width*height>16_777_216||v.imageWidth!==width||v.imageHeight!==height)throw new ValidationError('Dimensões do PNG inválidas.');
 if(!v.pins||typeof v.pins!=='object'||Array.isArray(v.pins)||Object.keys(v.pins).length>128)throw new ValidationError('Calibração inválida.');
 const pins:Record<string,PhotoPin>={};for(const [id,p]of Object.entries(v.pins)){
  if(!/^[1-9]\d{0,2}$/.test(id)||Number(id)>128||!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>1||p.y<0||p.y>1||!['top','bottom','left','right'].includes(p.side))throw new ValidationError('Coordenadas da porta inválidas.');
  pins[id]={x:p.x,y:p.y,side:p.side};
 }
 if(v.deviceType!==undefined&&!['deco','router','switch','laptop','desktop','tablet','phone','tv','network'].includes(v.deviceType))throw new ValidationError('Tipo da imagem inválido.');
 return {src,imageWidth:width,imageHeight:height,pins,...(typeof v.kind==='string'?{kind:v.kind.slice(0,160)}:{}),...(v.deviceType?{deviceType:v.deviceType}:{})};
}
