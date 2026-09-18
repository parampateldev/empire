export type Phase='lobby'|'reveal'|'playing'|'finished';
export type Player={id:string;name:string;submitted:boolean;leaderId:string;members:string[];eliminated:boolean};
export function roomCode(){const chars='23456789ABCDEFGHJKMNPQRSTUVWXYZ';return Array.from({length:6},()=>chars[Math.floor(Math.random()*chars.length)]).join('')}
export function capture(players:Record<string,Player>,attackerId:string,targetId:string){
  if(attackerId===targetId)throw new Error('Choose another empire');
  const next=structuredClone(players);
  const attacker=next[attackerId],target=next[targetId];
  if(!attacker||!target||attacker.eliminated||target.eliminated)throw new Error('Invalid capture');
  const claimed=[targetId,...(target.members||[])];
  attacker.members=[...new Set([...(attacker.members||[]),...claimed])];
  target.eliminated=true;target.leaderId=attackerId;
  for(const id of (target.members||[])){if(next[id]){next[id].leaderId=attackerId;next[id].eliminated=true}}
  target.members=[];return next
}
export function winner(players:Record<string,Player>){const alive=Object.values(players).filter(p=>!p.eliminated);return alive.length===1&&Object.keys(players).length>1?alive[0]:null}
export function remainingMs(revealEndsAt:number,now=Date.now()){return Math.max(0,revealEndsAt-now)}
export function parseRoom(pathname:string,search:string){
  const qs=new URLSearchParams(search).get('room')?.toUpperCase();
  if(qs)return qs;
  const last=pathname.replace(/\/+$/,'').split('/').at(-1)?.toUpperCase()||'';
  return last!=='EMPIRE'&&/^[A-Z2-9]{6}$/.test(last)?last:''
}
