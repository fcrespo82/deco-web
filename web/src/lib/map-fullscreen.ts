import {useEffect,useRef,useState} from 'preact/hooks';
/** Expand the existing DOM; fullscreening the document keeps Radix portals visible. */
export function useMapFullscreen(){
 const ref=useRef<HTMLDivElement>(null),owned=useRef(false),focus=useRef<HTMLElement|null>(null);
 const [full,setFull]=useState(false);
 const close=()=>{setFull(false);if(owned.current&&document.fullscreenElement){owned.current=false;void document.exitFullscreen().catch(()=>{});}focus.current?.focus({preventScroll:true});};
 const toggle=()=>{if(full){close();return;}focus.current=document.activeElement as HTMLElement;setFull(true);if(!document.fullscreenElement&&document.documentElement.requestFullscreen){owned.current=true;void document.documentElement.requestFullscreen().catch(()=>{owned.current=false;});}};
 useEffect(()=>{
  if(!full)return;const previous=document.body.style.overflow;document.body.style.overflow='hidden';document.body.classList.add('map-is-fullscreen');
  const change=()=>{if(owned.current&&!document.fullscreenElement){owned.current=false;setFull(false);focus.current?.focus({preventScroll:true});}};
  const key=(e:KeyboardEvent)=>{if(e.defaultPrevented||document.querySelector('[role="dialog"][data-state="open"],[role="menu"]'))return;if(e.key==='Escape'){e.preventDefault();close();return;}if(e.key!=='Tab')return;const items=[...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex="0"]')??[])].filter(el=>el.getClientRects().length>0);if(!items.length)return;const first=items[0]!,last=items.at(-1)!;if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}};
  document.addEventListener('keydown',key);document.addEventListener('fullscreenchange',change);
  return()=>{document.body.style.overflow=previous;document.body.classList.remove('map-is-fullscreen');document.removeEventListener('keydown',key);document.removeEventListener('fullscreenchange',change);};
 },[full]);
 useEffect(()=>()=>{if(owned.current&&document.fullscreenElement)void document.exitFullscreen().catch(()=>{});},[]);
 return {ref,full,toggle};
}
