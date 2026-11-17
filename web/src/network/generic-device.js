// Orthographic rear panels, rasterized to transparent PNG in the browser.
// Jack centers are shared by the drawing and the JointJS physical anchors.
export function genericKind(n){
 if(n.deviceType)return n.deviceType;
 const name=n.name+' '+n.kind;
 if(/switch|patch.?panel/i.test(name))return 'switch';
 if(/Deco/i.test(name))return 'deco';
 if(/celular|smartphone|phone/i.test(name))return 'phone';
 if(/tablet|ipad/i.test(name))return 'tablet';
 if(/notebook|laptop/i.test(name))return 'laptop';
 if(/roteador|router/i.test(name))return 'router';
 if(/TV|televis/i.test(name))return 'tv';
 if(/servidor|desktop|computador/i.test(name))return 'desktop';
 return 'network';
}
export function genericGeometry(n){
 const type=genericKind(n),panel=type==='switch',deco=type==='deco';
 /** @type {Record<string,{x:number,y:number,side:'top'|'bottom'|'left'|'right'}>} */
 const pins={};
 const columns=Math.min(8,Math.max(1,n.ports)),rows=Math.ceil(n.ports/columns);
 for(let i=0;i<n.ports;i++){
  const row=Math.floor(i/columns),count=Math.min(columns,n.ports-row*columns),column=i%columns;
  const x=deco?330:295+(column-(count-1)/2)*Math.min(60,440/Math.max(1,count-1));
  const y=deco?270+i*Math.min(65,180/Math.max(1,n.ports-1)):panel?310+row*65:type==='router'?380:type==='laptop'?410:365+row*65;
  pins[String(i+1)]={x:x/590,y:y/590,side:deco?'right':'bottom'};
 }
 const tv=type==='tv',tower=type==='desktop';
 const panelHeight=Math.max(120,120+Math.max(0,(rows-1)*65));
 const special={phone:{x:180,y:30,width:230,height:520},tablet:{x:140,y:40,width:310,height:500},laptop:{x:40,y:95,width:510,height:370},router:{x:40,y:90,width:510,height:385}};
 const bounds=special[type]??(panel?{x:3,y:250,width:584,height:panelHeight+20}:deco?{x:170,y:80,width:250,height:430}:tv?{x:45,y:120,width:500,height:382}:tower?{x:165,y:65,width:260,height:445}:{x:55,y:275,width:480,height:155});
 const drawPins=structuredClone(pins);
 for(const pin of Object.values(pins)){pin.x=(pin.x*590-bounds.x)/bounds.width;pin.y=(pin.y*590-bounds.y)/bounds.height;}
 return {type,panel,deco,pins,drawPins,bounds};
}
export function genericDevice(n){
 const {type,panel,deco,pins,drawPins,bounds}=genericGeometry(n),canvas=document.createElement('canvas');canvas.width=590;canvas.height=Math.max(590,bounds.y+bounds.height+5);const c=canvas.getContext('2d');
 const rect=(x,y,w,h,fill,stroke='#94a3b8')=>{c.fillStyle=fill;c.fillRect(x,y,w,h);c.strokeStyle=stroke;c.lineWidth=2;c.strokeRect(x,y,w,h);};
 const circle=(x,y,r,fill)=>{c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fillStyle=fill;c.fill();};
 const rows=Math.ceil(n.ports/8),tv=type==='tv',tower=type==='desktop';
 if(panel){
  const h=Math.max(120,55+65+Math.max(0,(rows-1)*65));rect(22,260,546,h,'#253244');rect(8,275,14,h-30,'#475569');rect(568,275,14,h-30,'#475569');
  for(const x of [15,575])for(const y of [286,260+h-25])circle(x,y,3,'#111827');
  rect(40,276,510,7,'#475569','#475569');
 }else if(deco){
  // Rear view: a straight cylindrical silhouette with the RJ45 stack visible.
  c.fillStyle='#dbe1e8';c.beginPath();c.roundRect(180,90,230,410,35);c.fill();c.strokeStyle='#94a3b8';c.stroke();
  rect(292,233,76,210,'#a8b2c0','#a8b2c0');circle(330,467,12,'#111827');
 }else if(type==='phone'||type==='tablet'){
  const phone=type==='phone',x=phone?190:150,y=phone?40:50,w=phone?210:290,h=phone?500:480;
  c.fillStyle='#475569';c.beginPath();c.roundRect(x,y,w,h,phone?30:23);c.fill();c.strokeStyle='#aab6c8';c.stroke();
  rect(x+8,y+35,3,h-70,'#64748b','#64748b');
  c.fillStyle='#273245';c.beginPath();c.roundRect(x+17,y+17,phone?75:48,phone?85:48,12);c.fill();
  circle(x+34,y+34,12,'#101827');circle(x+34,y+34,5,'#334e78');
  if(phone){circle(x+65,y+68,12,'#101827');circle(x+65,y+68,5,'#334e78');circle(x+65,y+34,5,'#fef3c7');}
  rect(x+w-3,y+110,6,phone?58:40,'#94a3b8','#94a3b8');
  circle(x+w/2,y+h*.55,13,'#64748b');
 }else if(type==='laptop'){
  // Rear orthographic elevation: thin lid, hinge, base, and actual rear jack.
  rect(65,105,460,285,'#475569');rect(80,120,430,255,'#56657b','#64748b');circle(295,245,19,'#94a3b8');
  rect(52,390,486,45,'#253244');rect(65,435,460,8,'#64748b');
  rect(70,397,80,5,'#94a3b8','#94a3b8');rect(445,397,70,5,'#94a3b8','#94a3b8');
 }else if(type==='router'){
  // Straight rear view, two antennas; no perspective or annotations.
  for(const x of [75,505]){c.fillStyle='#475569';c.beginPath();c.roundRect(x-9,100,18,265,9);c.fill();c.strokeStyle='#94a3b8';c.stroke();}
  rect(55,325,480,135,'#253244');rect(80,340,430,6,'#475569','#475569');circle(95,400,11,'#101827');circle(130,400,6,'#94a3b8');
 }else if(tv){
  rect(55,130,480,295,'#253244');rect(90,160,410,50,'#334155','#334155');
  rect(245,425,100,55,'#334155');rect(180,480,230,12,'#475569');
  rect(200,330,190,65,'#182232','#64748b');
 }else if(tower){
  rect(175,75,240,425,'#253244');rect(192,95,206,185,'#334155');
  for(let i=0;i<7;i++)rect(205,111+i*21,180,5,'#64748b','#64748b');
  rect(220,323,150,80,'#182232','#64748b');
  rect(210,430,170,12,'#475569');rect(210,455,170,12,'#475569');
 }else{
  rect(65,285,460,135,'#dbe1e8');rect(90,300,410,12,'#b4becb','#b4becb');
  circle(100,370,12,'#111827');
 }
 for(const pin of Object.values(drawPins)){
  const x=pin.x*590,y=pin.y*590;
  rect(x-23,y-21,46,42,'#cbd5e1','#64748b');rect(x-19,y-17,38,29,'#101827','#101827');
  rect(x-10,y+12,20,6,'#101827','#101827');
  for(let i=0;i<8;i++)rect(x-14+i*4,y-15,2,10,'#d4b255','#d4b255');
 }
 const output=document.createElement('canvas');output.width=bounds.width;output.height=bounds.height;output.getContext('2d').drawImage(canvas,bounds.x,bounds.y,bounds.width,bounds.height,0,0,bounds.width,bounds.height);
 return {src:output.toDataURL('image/png'),imageWidth:bounds.width,imageHeight:bounds.height,deviceType:type,kind:'Dispositivo genérico · '+type+' · PNG transparente',pins};
}
