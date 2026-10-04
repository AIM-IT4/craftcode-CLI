const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait=ms=>new Promise(r=>setTimeout(r,ms));

const reveal=new IntersectionObserver(entries=>{
  entries.forEach(entry=>{
    if(entry.isIntersecting){entry.target.classList.add('in');reveal.unobserve(entry.target);}
  });
},{threshold:.13});
document.querySelectorAll('.motion-in').forEach(el=>reveal.observe(el));

document.querySelectorAll('a[href^="#"]').forEach(a=>a.addEventListener('click',e=>{
  const id=a.getAttribute('href'),el=id&&id!=='#'?document.querySelector(id):null;
  if(el){e.preventDefault();el.scrollIntoView({behavior:reduce?'auto':'smooth',block:'start'});}
}));

const orb=document.querySelector('.pointer-orb');
if(orb&&!reduce){
  window.addEventListener('pointermove',e=>{
    orb.animate({left:e.clientX+'px',top:e.clientY+'px'},{duration:450,fill:'forwards',easing:'ease-out'});
  },{passive:true});
}

document.querySelectorAll('[data-parallax]').forEach(el=>{
  if(reduce)return;
  window.addEventListener('scroll',()=>{
    const r=el.getBoundingClientRect(),vh=innerHeight;
    if(r.bottom<0||r.top>vh)return;
    const p=(r.top+r.height/2-vh/2)/vh;
    el.style.transform=`translateY(${Math.max(-10,Math.min(10,-p*12))}px) rotate(${p*.18}deg)`;
  },{passive:true});
});

document.querySelectorAll('[data-copy]').forEach(btn=>btn.addEventListener('click',async()=>{
  const old=btn.textContent;
  try{await navigator.clipboard.writeText(btn.dataset.copy||'');btn.textContent='COPIED ✓';}
  catch{btn.textContent='SELECT + COPY';}
  setTimeout(()=>btn.textContent=old,1200);
}));

const prompt='Review checkout security and fix the highest-risk issue.';
const promptEl=document.getElementById('terminalPrompt');
const out=document.getElementById('terminalOutput');
const flow=[...document.querySelectorAll('[data-flow]')];
const rows=[
  {stage:0,html:'<span class="thought">✦ Reasoning… mapping checkout → payment → access</span>',delay:420},
  {stage:0,html:'<span class="ok">✓</span> <span class="tool">⌕ inspect_repo_url</span> · github.com/example/project <span class="time">0.3s</span>',delay:320},
  {stage:1,html:'<span class="ok">✓</span> <span class="tool">⌕ search_files</span> · grant-access webhook checkout <span class="time">0.1s</span>',delay:300},
  {stage:1,html:'<div class="agent-fan"><span><b>EXPLORER</b><br>repo map</span><span><b>REVIEWER</b><br>security risk</span><span><b>TESTER</b><br>verification</span></div>',delay:560},
  {stage:2,html:'<span class="ok">✓</span> <span class="tool">✎ replace_in_file</span> · src/access.ts <span class="time">0.1s</span>',delay:300},
  {stage:2,html:'<div class="diff"><div class="minus">- const access = query.token;</div><div class="plus">+ const access = await verifyToken(query.token);</div></div>',delay:520},
  {stage:3,html:'<span class="ok">✓</span> <span class="tool">›_ npm test</span> · <span class="muted">42 passed</span> <span class="time">3.2s</span>',delay:380},
  {stage:4,html:'<div class="answer">● Fixed the access path, verified tests, checkpoint ready. <span class="ok">Undo available.</span></div>',delay:900}
];
function setFlow(n){flow.forEach((el,i)=>el.classList.toggle('active',i===n));}
async function typePrompt(){
  promptEl.textContent='';
  if(reduce){promptEl.textContent=prompt;return;}
  for(const ch of prompt){promptEl.textContent+=ch;await wait(18+Math.random()*24);}
}
async function playTerminal(){
  if(!promptEl||!out)return;
  out.innerHTML='';flow.forEach(x=>x.classList.remove('active'));setFlow(0);
  await typePrompt();await wait(reduce?0:420);
  for(const item of rows){
    setFlow(item.stage);
    const row=document.createElement('div');row.className='row';row.innerHTML=item.html;out.appendChild(row);
    if(reduce){row.style.opacity=1;row.style.transform='none';}
    await wait(reduce?0:item.delay);
  }
  if(!reduce){
    await wait(2600);
    out.animate([{opacity:1},{opacity:.08}],{duration:260,fill:'forwards'});
    await wait(280);
    out.style.opacity='1';
    playTerminal();
  }
}
const terminal=document.querySelector('.terminal-shell');
let started=false;
if(terminal){
  new IntersectionObserver(entries=>{
    if(entries.some(x=>x.isIntersecting)&&!started){started=true;playTerminal();}
  },{threshold:.28}).observe(terminal);
}
