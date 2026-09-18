import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import QRCode from 'qrcode';
import './styles.css';
import {configured,login,createRoom,joinRoom,submitSecret,watchRoom,watchReveal,watchSubmissions,beginReveal,hideReveal,savePlayers,saveTheme,saveTimerOff,leaveRoom,removePlayer,type Room,type Reveal} from './firebase';
import {capture,parseRoom,remainingMs,roomCode,winner,type Player} from './game';

const demoAdjectives=['Amber','Velvet','Silver','Golden','Neon','Quiet'];
const demoNouns=['Atlas','Comet','Falcon','Lotus','Orbit','Cedar'];
const demoNames=['Maya','Sam','Jordan','Priya'];
const mk=(id:string,name:string):Player=>({id,name,submitted:false,leaderId:id,members:[],eliminated:false});

function App(){
  const fromUrl=parseRoom(location.pathname,location.search);
  const saved=(/^[A-Z2-9]{6}$/.test(localStorage.empireRoom||'')&&(localStorage.empireRoom||'')!=='EMPIRE'&&localStorage.empireRoom)||'';
  const restored=saved&&(!fromUrl||saved===fromUrl)?saved:'';
  const[screen,setScreen]=useState<'home'|'setup'|'join'|'game'>(restored?'game':fromUrl?'join':'home');
  const[code,setCode]=useState(restored||fromUrl);
  const[name,setName]=useState(localStorage.empireName||'');
  const[category,setCategory]=useState('');
  const[duration,setDuration]=useState(30);
  const[timerOn,setTimerOn]=useState(true);
  const[secret,setSecret]=useState('');
  const[uid,setUid]=useState('');
  const[room,setRoom]=useState<Room|null>(null);
  const[error,setError]=useState('');
  const[helpOpen,setHelpOpen]=useState(false);
  const[themeDraft,setThemeDraft]=useState(category);
  const[submissions,setSubmissions]=useState<Record<string,{word:string}>>({});
  const[qr,setQr]=useState('');
  const[now,setNow]=useState(Date.now());
  const[demo]=useState(!configured);
  const[reveal,setReveal]=useState<Reveal|null>(null);
  const[revealSettled,setRevealSettled]=useState(false);
  const isHost=room?.hostId===uid;
  const fail=(e:unknown)=>setError(e instanceof Error?e.message:String(e));

  useEffect(()=>{
    if(configured)login().then(u=>setUid(u.uid)).catch(e=>setError(String(e)||'Sign in failed'));
    else{let id=localStorage.empireDemoUid||crypto.randomUUID();localStorage.empireDemoUid=id;setUid(id)}
  },[]);
  useEffect(()=>{
    if(screen!=='game'||!code||demo)return;
    return watchRoom(code,r=>{setRoom(r);if(!r)setError('Room not found')},message=>{setError(message);localStorage.removeItem('empireRoom');setScreen('join')});
  },[screen,code,demo]);
  useEffect(()=>{
    if(!isHost||!code||demo||!(room?.phase==='playing'||room?.phase==='finished'))return;
    return watchSubmissions(code,Object.keys(room?.players||{}),s=>setSubmissions(s||{}));
  },[isHost,code,demo,room?.phase]);
  useEffect(()=>{if(room?.settings?.category)setThemeDraft(room.settings.category)},[room?.settings?.category]);
  useEffect(()=>{const id=setInterval(()=>setNow(Date.now()),250);return()=>clearInterval(id)},[]);
  // Attach to the reveal list only while the room is revealing. Rules let the
  // host read it; everyone else is cancelled by the database the moment words
  // exist, so non-hosts never receive the list.
  useEffect(()=>{
    if(demo||room?.phase!=='reveal'||!code){if(room?.phase!=='reveal'){setReveal(null);setRevealSettled(false)}return}
    setRevealSettled(false);
    return watchReveal(code,v=>{setReveal(v);setRevealSettled(true)},()=>{setReveal(null);setRevealSettled(true)});
  },[room?.phase,code,demo]);
  // Host auto-hides the list when the timer runs out (or if the list is gone).
  // A reveal with endsAt=0 has no timer: it stays up until the host hides it.
  useEffect(()=>{
    if(demo||!isHost||room?.phase!=='reveal')return;
    if(!reveal&&revealSettled){hideReveal(code,uid).catch(()=>{});return}
    if(reveal&&reveal.endsAt>0&&remainingMs(reveal.endsAt,now)===0)hideReveal(code,uid).catch(()=>{});
  },[now,room?.phase,reveal,revealSettled,isHost]);
  useEffect(()=>{
    if(demo&&room?.phase==='reveal'&&reveal&&reveal.endsAt>0&&remainingMs(reveal.endsAt,now)===0){setRoom(r=>r?{...r,phase:'playing'}:r);setReveal(null)}
  },[now,room?.phase,reveal,demo]);
  useEffect(()=>{
    if(!code)return;
    const url=`${location.origin}/empire/${code}`;
    QRCode.toDataURL(url,{margin:1,width:220,color:{dark:'#18120d',light:'#fffaf3'}}).then(setQr);
  },[code]);

  function remember(){localStorage.empireName=name}
  function saveRoom(c:string){localStorage.empireRoom=c}
  async function host(){
    if(!name.trim())return setError('Add your name');
    if(!category.trim())return setError('Add a theme');
    remember();
    const c=roomCode();
    setCode(c);history.replaceState({},'',`/empire/${c}`);
    if(demo){
      const me=mk(uid,name);
      const extra=Object.fromEntries(demoNames.map((n,i)=>[`demo${i}`,{...mk(`demo${i}`,n),submitted:true}]));
      setRoom({hostId:uid,phase:'lobby',createdAt:Date.now(),settings:{category,revealSeconds:duration,timerOff:!timerOn},players:{[uid]:me,...extra}});
      saveRoom(c);setScreen('game');
    }else{
      try{await createRoom(c,uid,name,category,duration,!timerOn);saveRoom(c);setScreen('game')}catch(e){fail(e)}
    }
  }
  async function join(){
    if(!name.trim()||!code.trim())return setError('Add your name and room code');
    remember();
    const c=code.toUpperCase();
    setCode(c);history.replaceState({},'',`/empire/${c}`);
    if(demo){setError('Live rooms connect after Firebase setup. Use Host game to preview the full flow.');return}
    try{await joinRoom(c,mk(uid,name));saveRoom(c);setScreen('game')}catch(e){fail(e)}
  }
  async function submit(){
    if(!secret.trim())return;
    if(!uid||!room?.players?.[uid]){setError('Join this room before submitting a word');localStorage.removeItem('empireRoom');setScreen('join');return}
    setError('');
    try{
      if(demo)setRoom(r=>r?{...r,players:{...r.players,[uid]:{...r.players[uid],submitted:true}}}:r);
      else await submitSecret(code,uid,secret.trim());
      setSecret('');
    }catch(e){fail(e)}
  }
  async function changeTheme(next:string){
    if(!room||!isHost)return;
    try{if(demo)setRoom({...room,settings:{...room.settings,category:next}});else await saveTheme(code,uid,next)}catch(e){fail(e)}
  }
  async function toggleTimer(){
    if(!room||!isHost)return;
    const next=!room.settings?.timerOff;
    setError('');
    try{if(demo)setRoom({...room,settings:{...room.settings,timerOff:next}});else await saveTimerOff(code,uid,next)}catch(e){fail(e)}
  }
  function leave(){
    const r=room;
    localStorage.removeItem('empireRoom');setRoom(null);setCode('');history.replaceState({},'','/empire/');setScreen('home');
    if(!demo&&r?.players?.[uid])leaveRoom(code,uid).catch(()=>{});
  }
  async function kick(id:string){
    if(!room||!isHost||demo)return;
    setError('');
    try{await removePlayer(code,uid,id)}catch(e){fail(e)}
  }
  async function start(){
    if(!room)return;
    setError('');
    try{
      if(demo){
        const words=[secret||`${demoAdjectives[0]} ${demoNouns[0]}`,...Object.keys(room.players).filter(x=>x!==uid).map((_,i)=>`${demoAdjectives[i+1]} ${demoNouns[i+1]}`)];
        setRoom({...room,phase:'reveal'});setReveal({words,endsAt:room.settings?.timerOff?0:Date.now()+duration*1000});
      }else await beginReveal(code,uid);
    }catch(e){fail(e)}
  }
  function endReveal(){
    if(!room)return;
    if(demo){setRoom({...room,phase:'playing'});setReveal(null)}
    else hideReveal(code,uid).catch(e=>fail(e));
  }
  async function doCapture(a:string,b:string){
    if(!room)return;
    setError('');
    try{
      const players=capture(room.players||{},a,b);
      const win=winner(players);
      if(demo)setRoom({...room,players,phase:win?'finished':'playing'});
      else await savePlayers(code,uid,players,win?'finished':undefined);
    }catch(e){fail(e)}
  }

  const share=`${location.origin}/empire/${code}`;
  const pageProps={help:()=>setHelpOpen(true),helpOpen,closeHelp:()=>setHelpOpen(false)};

  if(screen==='home')return <Page {...pageProps}><section className="hero"><div className="crown">♜</div><p className="eyebrow">The social memory game</p><h1>Build your<br/><em>Empire.</em></h1><p className="lead">Choose a secret identity. Remember the list. Guess your friends. Rule the room.</p><div className="actions"><button onClick={()=>setScreen('setup')}>Host a game</button><button className="ghost" onClick={()=>setScreen('join')}>Join with code</button></div>{demo&&<p className="demo">Preview mode · realtime setup in progress</p>}</section></Page>;

  if(screen==='setup')return <Page {...pageProps}><Card title="Host a game" back={()=>setScreen('home')}><Field label="Your name" value={name} set={setName} placeholder="Param"/><Field label="Secret category" value={category} set={setCategory} placeholder="Cities"/><label className="timer-row">Reveal timer<button type="button" className={timerOn?'toggle on':'toggle'} aria-pressed={timerOn} onClick={()=>setTimerOn(v=>!v)}>{timerOn?'On':'Off'}</button></label>{timerOn&&<label>Reveal time <b>{duration} seconds</b><input type="range" min="15" max="60" step="5" value={duration} onChange={e=>setDuration(+e.target.value)}/></label>}<button disabled={!uid} onClick={host}>Create room</button><ErrorText text={error}/></Card></Page>;

  if(screen==='join')return <Page {...pageProps}><Card title="Join a room" back={()=>setScreen('home')}><Field label="Room code" value={code} set={v=>setCode(v.toUpperCase())} placeholder="ABC234"/><Field label="Your name" value={name} set={setName} placeholder="Your name"/><button disabled={!uid} onClick={join}>Join game</button><ErrorText text={error}/></Card></Page>;

  if(!room)return <Page {...pageProps}><div className="loader">Joining {code}…</div><ErrorText text={error}/></Page>;

  if(room.phase==='reveal'){
    if(isHost&&reveal){
      const timerLive=reveal.endsAt>0;
      const left=Math.ceil(remainingMs(reveal.endsAt,now)/1000);
      return <Page {...pageProps}><section className="reveal">{timerLive?<div className="timer">{left}</div>:<p className="timer-off">Timer off. Hide the list when you're done.</p>}<p>Only you can see this list</p><div className="word-grid">{reveal.words.map(w=><span key={w}>{w}</span>)}</div><button className="ghost" onClick={endReveal}>Hide now</button></section></Page>;
    }
    if(isHost)return <Page {...pageProps}><div className="loader">Preparing the list…</div><ErrorText text={error}/></Page>;
    return <Page {...pageProps}><section className="reveal"><p className="eyebrow">Room {code}</p><h2>The host has the list.</h2><p className="reveal-note">Only the host can see it. Sit tight.</p></section></Page>;
  }

  if(room.phase==='playing'||room.phase==='finished')return <Page {...pageProps}>
    <button className="leave-room game-leave" onClick={leave}>Leave room</button>
    <Board room={room} host={isHost} capture={doCapture} code={code} submissions={submissions} onRevealAgain={start} timerOff={Boolean(room.settings?.timerOff)} onToggleTimer={toggleTimer}/>
    <ErrorText text={error}/>
  </Page>;

  const players=Object.values(room.players||{}).filter(p=>p&&p.id&&p.name);
  const readyCount=players.filter(p=>p.submitted).length;
  const everyoneReady=players.length>0&&readyCount===players.length;
  return <Page {...pageProps}><section className="lobby">
    <button className="leave-room" onClick={leave}>Leave room</button>
    <div className="room-head"><div><p className="eyebrow">Room {code}</p><h2>EMPIRE</h2></div>{qr&&<img src={qr}/>}</div>
    <div className="share"><span>{share}</span><button className="mini" onClick={()=>navigator.clipboard.writeText(share)}>Copy link</button></div>
    <div className="lobby-grid">
      <div>
        <h3>Players <b>{players.length}</b></h3>
        {players.map(p=><div className="player" key={p.id}><i>{p.name[0]}</i><span>{p.name}{p.id===room.hostId&&<small> Host</small>}</span><em className={p.submitted?'ready':''}>{p.submitted?'Ready':'Choosing…'}</em>{isHost&&p.id!==room.hostId&&<button className="remove" onClick={()=>kick(p.id)}>Remove</button>}</div>)}
      </div>
      <div className="secret">
        <div className="theme secret-theme"><b>Theme</b>{isHost?<div className="theme-edit"><input aria-label="Room theme" value={themeDraft} onChange={e=>setThemeDraft(e.target.value)}/><button className="mini" disabled={!themeDraft.trim()||themeDraft===room.settings?.category} onClick={()=>changeTheme(themeDraft.trim())}>Save</button></div>:<span>{room.settings?.category}</span>}</div>
        <p>Choose your secret word</p>
        <small>Pick a word that fits the theme. Only the host will see who submitted it.</small>
        {room.players?.[uid]?.submitted?<><div className="sealed">✓ Word submitted</div><small>Your word is private until the reveal.</small></>:<><input value={secret} onChange={e=>setSecret(e.target.value)} placeholder=""/><button onClick={submit}>Submit my word</button></>}
      </div>
    </div>
    {isHost&&<div className="hostbar"><span>{readyCount}/{players.length} ready</span><button disabled={!everyoneReady} onClick={start}>Reveal the list</button></div>}
    {isHost&&readyCount<players.length&&<p className="hint">Everyone needs a word in before the reveal.</p>}
    <ErrorText text={error}/>
  </section></Page>;
}

function Board({room,host,capture,code,submissions,onRevealAgain,timerOff,onToggleTimer}:{room:Room;host:boolean;capture:(a:string,b:string)=>void;code:string;submissions:Record<string,{word:string}>;onRevealAgain:()=>void;timerOff:boolean;onToggleTimer:()=>void}){
  const players=room.players||{};
  const alive=Object.values(players).filter(p=>p&&p.id&&p.name&&!p.eliminated);
  const win=winner(players);
  const[a,setA]=useState(alive[0]?.id||'');
  const[b,setB]=useState(alive[1]?.id||'');
  return <section className="board">
    <p className="eyebrow">Room {code} · Game on</p>
    <h2>{win?`${win.name} rules the empire.`:'Who remembers who?'}</h2>
    <p className="muted">Guess aloud. The host records a correct capture; the losing empire moves as one.</p>
    {host&&<details className="identity-key"><summary>Host identity key</summary>{Object.entries(submissions).map(([id,s])=><div key={id}><span>{s.word}</span><b>{players[id]?.name||'Player left'}</b></div>)}</details>}
    <div className="empires">{alive.map(p=><article key={p.id}><i>{p.name[0]}</i><h3>{p.name}</h3><p>{(p.members||[]).length+1} in empire</p><div>{(p.members||[]).map(id=><span key={id}>{players[id]?.name}</span>)}</div></article>)}</div>
    {host&&!win&&alive.length>=2&&<div className="capture">
      <select value={a} onChange={e=>setA(e.target.value)}>{alive.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <span>captured</span>
      <select value={b} onChange={e=>setB(e.target.value)}>{alive.map(p=><option key={p.id} value={p.id}>{submissions[p.id]?.word||p.name}</option>)}</select>
      <button disabled={!a||!b||a===b} onClick={()=>capture(a,b)}>Record</button>
    </div>}
    {host&&!win&&<button className="ghost reveal-again" onClick={onRevealAgain}>Reveal the list again</button>}
    {host&&<button className="board-timer" onClick={onToggleTimer}>Reveal timer: {timerOff?'off':'on'}</button>}
  </section>;
}

function Page({children,help,helpOpen,closeHelp}:{children:React.ReactNode;help:()=>void;helpOpen:boolean;closeHelp:()=>void}){
  return <main>
    <header><a href="/empire/">EMPIRE</a><button className="help-button" onClick={help}>Help</button></header>
    {children}
    {helpOpen&&<div className="help-backdrop" role="dialog" aria-modal="true" aria-label="How to play"><section className="help-panel">
      <button className="help-close" onClick={closeHelp} aria-label="Close help">×</button>
      <p className="eyebrow">How to play</p>
      <h2>Build your empire.</h2>
      <ol>
        <li><b>Join and choose.</b> Enter a private word that fits the room theme.</li>
        <li><b>Reveal.</b> The host sees the full list, on a timer unless the room turns it off, and can bring it back later.</li>
        <li><b>Guess aloud.</b> On your turn, name a player and the word you think they chose.</li>
        <li><b>Capture.</b> A correct guess brings that player and their whole empire into yours.</li>
        <li><b>Win.</b> The last uncaptured leader rules the empire.</li>
      </ol>
      <p>The host keeps the game moving, checks the private identity key, and records correct captures in the app.</p>
      <button onClick={closeHelp}>Got it</button>
    </section></div>}
  </main>;
}
function Card({title,children,back}:{title:string;children:React.ReactNode;back:()=>void}){return <section className="card"><button className="back" onClick={back}>← Back</button><h2>{title}</h2>{children}</section>}
function Field({label,value,set,placeholder}:{label:string;value:string;set:(v:string)=>void;placeholder?:string}){return <label>{label}<input value={value} onChange={e=>set(e.target.value)} placeholder={placeholder}/></label>}
function ErrorText({text}:{text:string}){return text?<p className="error">{text}</p>:null}


class ErrorBoundary extends React.Component<{children:React.ReactNode},{crashed:boolean}>{
  constructor(p:{children:React.ReactNode}){super(p);this.state={crashed:false}}
  static getDerivedStateFromError(){return{crashed:true}}
  render(){
    if(this.state.crashed)return <main><section className="hero"><h1>Something glitched.</h1><div className="actions"><button onClick={()=>{localStorage.removeItem('empireRoom');location.href='/empire/'}}>Back to start</button></div></section></main>;
    return this.props.children;
  }
}
createRoot(document.getElementById('root')!).render(<ErrorBoundary><App/></ErrorBoundary>);
