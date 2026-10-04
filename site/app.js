const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const revealObserver=new IntersectionObserver(entries=>{
  for(const entry of entries)if(entry.isIntersecting){entry.target.classList.add('visible');revealObserver.unobserve(entry.target);}
},{threshold:.12});
document.querySelectorAll('.reveal').forEach(el=>revealObserver.observe(el));

document.querySelectorAll('a[href^="#"]').forEach(a=>a.addEventListener('click',e=>{
  const id=a.getAttribute('href'),el=id&&id!=='#'?document.querySelector(id):null;
  if(el){e.preventDefault();el.scrollIntoView({behavior:reduce?'auto':'smooth'});}
}));

document.querySelectorAll('.copy-btn').forEach(btn=>btn.addEventListener('click',async()=>{
  const original=btn.textContent;
  try{await navigator.clipboard.writeText(btn.dataset.copy||'');btn.textContent='COPIED ✓';}
  catch{btn.textContent='SELECT + COPY';}
  setTimeout(()=>btn.textContent=original,1300);
}));

const glow=document.querySelector('.cursor-glow');
if(!reduce&&glow){
  window.addEventListener('pointermove',e=>{glow.style.left=e.clientX+'px';glow.style.top=e.clientY+'px';},{passive:true});
}

const prompt='Review checkout security and fix the highest-risk issue.';
const promptEl=document.getElementById('typedPrompt');
const stream=document.getElementById('terminalStream');
const wait=ms=>new Promise(r=>setTimeout(r,ms));

const steps=[
  {html:'<span class="thought">✦ Reasoning… mapping the checkout → payment → entitlement flow</span>',delay:420},
  {html:'<span class="ok">✓</span> <span class="cyan">⌕ inspect_repo_url</span> · github.com/example/project <span class="time">0.3s</span>',delay:340},
  {html:'<span class="ok">✓</span> <span class="cyan">⌕ search_files</span> · grant-access webhook checkout <span class="time">0.1s</span>',delay:310},
  {html:'<span class="ok">✓</span> <span class="cyan">◈ agents</span> · explorer + reviewer <span class="muted">running in parallel</span>',delay:430},
  {html:'<span class="ok">✓</span> <span class="cyan">✎ replace_in_file</span> · src/access.ts <span class="time">0.1s</span>',delay:300},
  {html:'<div class="diffbox"><div class="minus">- const access = query.token;</div><div class="plus">+ const access = await verifyToken(query.token);</div></div>',delay:460},
  {html:'<span class="ok">✓</span> <span class="cyan">›_ npm test</span> <span class="muted">42 passed</span> <span class="time">3.2s</span>',delay:360},
  {html:'<span class="answer">● Fixed the access path, verified tests, checkpoint ready. <span class="ok">Undo available.</span></span>',delay:760}
];

async function typePrompt(){
  if(reduce){promptEl.textContent=prompt;return;}
  promptEl.textContent='';
  for(const ch of prompt){promptEl.textContent+=ch;await wait(24+Math.random()*22);}
}
async function runTerminal(){
  if(!promptEl||!stream)return;
  stream.innerHTML='';
  await typePrompt();await wait(reduce?0:450);
  for(const step of steps){
    const row=document.createElement('div');row.className='line';row.innerHTML=step.html;stream.appendChild(row);
    if(reduce){row.style.opacity=1;row.style.transform='none';}
    await wait(reduce?0:step.delay);
  }
  if(!reduce){await wait(2600);stream.style.opacity='.25';await wait(250);stream.innerHTML='';stream.style.opacity='1';await runTerminal();}
}
const terminal=document.querySelector('.terminal-wrap');
let terminalStarted=false;
new IntersectionObserver(entries=>{
  if(entries.some(e=>e.isIntersecting)&&!terminalStarted){terminalStarted=true;runTerminal();}
},{threshold:.25}).observe(terminal);
