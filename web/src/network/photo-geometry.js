// Coordinates are normalized against the complete PNG, including its margins.
// A radio endpoint is never a numbered physical connector.
export const PHOTO_BOX={x:0,y:32,width:224,height:224};
export const PHOTO_HEIGHT=278;
export function photoBox(spec){const scale=Math.min(224/(spec?.imageWidth??590),224/(spec?.imageHeight??590));return {x:(224-(spec?.imageWidth??590)*scale)/2,y:32,width:(spec?.imageWidth??590)*scale,height:(spec?.imageHeight??590)*scale};}
export function photoHeight(spec){return Math.ceil(photoBox(spec).height+54);}
export function photoPoint(pin,spec){const box=photoBox(spec);return {x:box.x+pin.x*box.width,y:box.y+pin.y*box.height};}
export function radioPoint(){return {x:112,y:28};}
export function validatePin(pin,pins,spec){
 if(!Number.isFinite(pin.x)||!Number.isFinite(pin.y)||pin.x<0||pin.x>1||pin.y<0||pin.y>1)throw Error('Clique dentro da imagem.');
 if(!['top','bottom','left','right'].includes(pin.side))throw Error('Escolha uma direção de saída.');
 const p=photoPoint(pin,spec),radio=radioPoint();
 if(Math.hypot(p.x-radio.x,p.y-radio.y)<22)throw Error('Esta posição está reservada para Wi-Fi.');
 if(Object.values(pins).some(other=>{const q=photoPoint(other,spec);return Math.hypot(p.x-q.x,p.y-q.y)<6;}))throw Error('Esta posição está muito próxima de outra porta Ethernet.');
 return pin;
}
export function photoPortId(p){return p==='wifi'?'radio:wifi':`ethernet:${p}`;}
