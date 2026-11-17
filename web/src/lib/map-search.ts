export function mapMatches(query:string,...values:(string|null|undefined)[]):boolean {
 const normalize=(s:string)=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR");
 const tokens=normalize(query).trim().split(/\s+/).filter(Boolean),text=normalize(values.filter(Boolean).join(" "));
 return tokens.every(token=>text.includes(token));
}
