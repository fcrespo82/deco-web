import {useMapFullscreen} from "../../src/lib/map-fullscreen";
import {act} from 'preact/test-utils';
import {render} from 'preact';
import {App} from './app';
declare global{interface Window{__decoPocTest:{mount:()=>void;mountFullscreen:()=>void;unmount:()=>void;mountFullscreen:()=>void;act:(callback:()=>void|Promise<void>)=>Promise<void>|void}}}
function FullscreenHarness(){const map=useMapFullscreen();return <div ref={map.ref} className={map.full?"map-fullscreen":""}><button onClick={map.toggle}>{map.full?"Sair da tela cheia":"Ver em tela cheia"}</button><div aria-label="Mapa estável">Mapa</div></div>;}
window.__decoPocTest={act,mountFullscreen(){render(<FullscreenHarness/>,document.getElementById("app")!)},mount(){render(<App/>,document.getElementById('app')!)},unmount(){render(null,document.getElementById('app')!)}};
