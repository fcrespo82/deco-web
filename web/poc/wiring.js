export function logicalPort(id){if(!id)return null;if(id.startsWith('radio:')||id.startsWith('wifi:'))return 'wifi';if(id.startsWith('ethernet:'))return id.slice('ethernet:'.length);const p=id.split(':')[0];return /^\d+$/.test(p)?p:null;}
export function wiringError(links,source,sp,target,tp,exclude){
 if(!source||!target||!sp||!tp)return 'Escolha duas portas.';
 if(source===target)return 'Escolha equipamentos diferentes.';
 if((sp==='wifi')!==(tp==='wifi'))return 'Conecte Ethernet a Ethernet ou Wi-Fi a Wi-Fi.';
 if(links.some(l=>l.id!==exclude&&((l.source===source&&l.sp===sp&&l.target===target&&l.tp===tp)||(l.target===source&&l.tp===sp&&l.source===target&&l.sp===tp))))return 'Esta ligação já existe.';
 if(sp!=='wifi'&&links.some(l=>l.id!==exclude&&((l.source===source&&l.sp===sp)||(l.target===source&&l.tp===sp)||(l.source===target&&l.sp===tp)||(l.target===target&&l.tp===tp))))return 'Uma das portas Ethernet já está ocupada.';
 return null;
}
