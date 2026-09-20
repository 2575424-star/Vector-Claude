const tabs=['overview','photos','files','costs','route','history','publication','avito','telegram'];
export function carHash(id,tab='overview'){return 'car/'+encodeURIComponent(id)+(tabs.includes(tab)&&tab!=='overview'?'?tab='+tab:'');}
export function readCarHash(hash){if(!hash.startsWith('#car/'))return {id:null,tab:'overview'};const [raw,query='']=hash.slice(5).split('?');let id;try{id=decodeURIComponent(raw);}catch{return {id:null,tab:'overview'};}const tab=new URLSearchParams(query).get('tab');return {id,tab:tabs.includes(tab)?tab:'overview'};}
