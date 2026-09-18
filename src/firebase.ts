import {initializeApp} from 'firebase/app';
import {getAuth,signInAnonymously} from 'firebase/auth';
import {getDatabase,ref,set,onValue,update,get,remove,serverTimestamp} from 'firebase/database';
import type {Player,Phase} from './game';
const config={apiKey:import.meta.env.VITE_FIREBASE_API_KEY,authDomain:import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,databaseURL:import.meta.env.VITE_FIREBASE_DATABASE_URL,projectId:import.meta.env.VITE_FIREBASE_PROJECT_ID,appId:import.meta.env.VITE_FIREBASE_APP_ID};
export const configured=Boolean(config.apiKey&&config.databaseURL);
const app=configured?initializeApp(config):null;
export const auth=app?getAuth(app):null;
export const db=app?getDatabase(app):null;
export type Reveal={words:string[];endsAt:number};
export type Room={hostId:string;phase:Phase;createdAt:number;settings:{revealSeconds:number;category:string;timerOff?:boolean};players:Record<string,Player>};
export async function login(){if(!auth)throw new Error('Firebase is not configured');return (await signInAnonymously(auth)).user}
export const roomRef=(code:string)=>ref(db!,`rooms/${code}`);
export const revealRef=(code:string)=>ref(db!,`reveals/${code}`);
export function watchRoom(code:string,cb:(r:Room|null)=>void,onError?:(message:string)=>void){
  return onValue(roomRef(code),s=>cb(s.val() as Room|null),e=>onError?.(e.message));
}
// The reveal list attaches only while the room is in the reveal phase. Rules let
// anyone watch the empty node, but only the host can read it once words exist,
// so non-host clients are cancelled the moment a list is written.
export function watchReveal(code:string,cb:(r:Reveal|null)=>void,onCancel:()=>void){
  return onValue(revealRef(code),s=>cb(s.val() as Reveal|null),()=>onCancel());
}
export async function createRoom(code:string,hostId:string,hostName:string,category:string,revealSeconds:number,timerOff:boolean){
  const player:Player={id:hostId,name:hostName,submitted:false,leaderId:hostId,members:[],eliminated:false};
  await update(ref(db!),{[`rooms/${code}/hostId`]:hostId,[`rooms/${code}/phase`]:'lobby',[`rooms/${code}/createdAt`]:Date.now(),[`rooms/${code}/settings`]:{category,revealSeconds,timerOff},[`rooms/${code}/players/${hostId}`]:player});
}
export async function joinRoom(code:string,p:Player){await set(ref(db!,`rooms/${code}/players/${p.id}`),p)}
export async function submitSecret(code:string,uid:string,word:string){
  await set(ref(db!,`submissions/${code}/${uid}`),{word,submittedAt:serverTimestamp()});
  await update(ref(db!,`rooms/${code}/players/${uid}`),{submitted:true});
}
export function watchSubmissions(code:string,playerIds:string[],cb:(subs:Record<string,{word:string}>)=>void){
  const current:Record<string,{word:string}>={};
  const offs=playerIds.map(id=>onValue(ref(db!,`submissions/${code}/${id}`),s=>{if(s.exists())current[id]=s.val();else delete current[id];cb({...current})},()=>{}));
  return ()=>offs.forEach(off=>off());
}
export async function beginReveal(code:string,hostId:string){
  const room=(await get(roomRef(code))).val() as Room;
  if(room.hostId!==hostId)throw new Error('Only the host can start');
  const snaps=await Promise.all(Object.keys(room.players||{}).map(id=>get(ref(db!,`submissions/${code}/${id}`))));
  const words=snaps.filter(s=>s.exists()).map(s=>(s.val() as {word:string}).word);
  if(words.length<1)throw new Error('No words submitted yet');
  // A reveal with endsAt=0 has no timer: it stays up until the host hides it.
  const endsAt=room.settings?.timerOff?0:Date.now()+(room.settings?.revealSeconds||30)*1000;
  await set(revealRef(code),{words:words.sort(()=>Math.random()-.5),endsAt});
  await set(ref(db!,`rooms/${code}/phase`),'reveal');
}
export async function hideReveal(code:string,hostId:string){
  const snap=await get(roomRef(code));
  if(snap.val()?.hostId!==hostId)return;
  await set(ref(db!,`rooms/${code}/phase`),'playing');
  await remove(revealRef(code));
}
export async function savePlayers(code:string,hostId:string,players:Record<string,Player>,phase?:Phase){
  const snap=await get(roomRef(code));
  if(snap.val()?.hostId!==hostId)throw new Error('Only the host can update the board');
  // Write each player at its own path: the rules grant the host writes under
  // players/$uid, but not a blanket set on the whole players node.
  const paths:Record<string,Player|string>={};
  for(const p of Object.values(players))paths[`rooms/${code}/players/${p.id}`]=p;
  if(phase)paths[`rooms/${code}/phase`]=phase;
  await update(ref(db!),paths);
}
export async function saveTheme(code:string,hostId:string,category:string){
  const snap=await get(roomRef(code));
  if(snap.val()?.hostId!==hostId)throw new Error('Only the host can change the theme');
  await set(ref(db!,`rooms/${code}/settings/category`),category);
}
export async function saveTimerOff(code:string,hostId:string,off:boolean){
  const snap=await get(roomRef(code));
  if(snap.val()?.hostId!==hostId)throw new Error('Only the host can change the timer');
  await set(ref(db!,`rooms/${code}/settings/timerOff`),off);
}
export async function leaveRoom(code:string,uid:string){
  await remove(ref(db!,`rooms/${code}/players/${uid}`));
  await remove(ref(db!,`submissions/${code}/${uid}`));
}
export async function removePlayer(code:string,hostId:string,targetUid:string){
  const snap=await get(roomRef(code));
  if(snap.val()?.hostId!==hostId)throw new Error('Only the host can remove players');
  if(targetUid===hostId)throw new Error('The host cannot remove themselves');
  await remove(ref(db!,`rooms/${code}/players/${targetUid}`));
  await remove(ref(db!,`submissions/${code}/${targetUid}`));
}
