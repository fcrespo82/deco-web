// Native pointerup precedes mouseup. JointJS commits its drag on mouseup /
// touchend, so pointer release must not discard the pending persistence state.
export function releaseMapPointer(runtime){runtime.pan=null;}
export function finishMapDrag(runtime,onSave){
 const gesture=runtime.gesture;if(!gesture)return false;runtime.gesture=null;
 const root=runtime.graph.getCell(gesture.id);if(!root)return false;
 const p=root.position();if(p.x===gesture.start.x&&p.y===gesture.start.y)return false;
 const points={};for(const id of [gesture.id,...Object.keys(gesture.followers)]){const model=runtime.graph.getCell(id);if(model)points[id]={x:model.position().x+model.size().width/2,y:model.position().y+model.size().height/2};}
 onSave(points);return true;
}
