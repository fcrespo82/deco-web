/** Presentation mode never mutates topology, equipment or saved positions. */
export function mapInteractionPolicy({ambient=false,readOnly=false}={}){
 return {navigate:!ambient,edit:!ambient&&!readOnly};
}
