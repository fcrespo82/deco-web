export const W=224,H=108;
export function ports(n){return [...Array.from({length:n.ports},(_,i)=>String(i+1)),...(n.radio===false?[]:['wifi']),...(n.unknownPort?['unknown']:[])];}
export function portId(id,p,side){return `${id}:${p}:${side}`;}
export function portOffset(n,p){if(p==='wifi'||p==='unknown')return W/2;const left=Math.ceil(n.ports/2),i=Number(p)-1;return i<left?24+i*54/Math.max(1,left-1):146+(i-left)*54/Math.max(1,n.ports-left-1);}
