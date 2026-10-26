import './style.css';
import {icon} from './icons.js';
import {bindCameraActivation, requestCamera, playCamera, describeCameraFailure, cameraEnvironment, readCameraPermission} from './camera.js';
import {encodeFrame, parseFrameHash, renderQr, DEFAULT_URL_BUDGET, FINE_URL_BUDGET} from './frame-codec.js';

const app = document.querySelector('#app');
const $ = (s) => document.querySelector(s);
const baseUrl = new URL('./', location.href).href.split('#')[0].split('?')[0];
const frameBaseUrl = import.meta.env.VITE_FRAME_BASE_URL || (['localhost','127.0.0.1'].includes(location.hostname) ? 'https://taewooopark.github.io/QameRa/' : baseUrl);
const demo = new URLSearchParams(location.search).has('demo');
const state = {isDemo:false, stream:null, track:null, caps:{}, facing:'environment', frozen:false, starting:false, cameraRequest:null, diagnostic:null, running:false, frame:null, count:0, exposure:0, zoom:1, filter:'original', fps:1, budget:DEFAULT_URL_BUDGET, timer:0, token:0, torch:false};
const video = document.createElement('video');
video.muted = true; video.autoplay = true; video.playsInline = true;
video.setAttribute('playsinline',''); video.setAttribute('muted','');
video.className = 'capture-source'; video.setAttribute('aria-hidden','true');
const source = document.createElement('canvas'); source.width=384; source.height=384;
const ctx = source.getContext('2d',{willReadFrequently:true});
let toastTimer;

function toast(message) { const el=$('#toast'); if(!el)return; el.textContent=message; el.classList.add('shown');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('shown'),3200); }
function saveData(data,name){const a=document.createElement('a');a.href=data;a.download=name;a.click();}
function status(label, kind=''){const el=$('#status');if(el){el.textContent=label;el.dataset.state=kind;}}
function stopTracks(){state.stream?.getTracks().forEach(t=>{t.onended=null;t.stop();});state.stream=null;state.track=null;video.srcObject=null;}

function cameraMarkup(){
 app.innerHTML=`<aside class="desktop-note"><div class="phone-link"><canvas id="phone-qr" aria-label="Open QameRa on your phone"></canvas><span>Open on your phone</span></div><a class="source-link" href="https://github.com/TaewoooPark/QameRa" target="_blank" rel="noreferrer">GitHub ↗</a></aside>
 <main class="camera-app">
  <span id="status" hidden></span>
  <section class="viewfinder" aria-label="Live QR viewfinder">
   <div class="frame-label"><button class="text-button" id="speed" aria-label="Change QR refresh speed">1 fps</button><button class="text-button reveal-button" id="open-frame" aria-label="Reveal current image" disabled>${icon('eye')}</button></div>
   <div class="qr-wrap"><canvas id="qr" aria-label="QR code containing the current camera image"></canvas><span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>
    <div class="permission-card" id="permission-card"><div class="permission-symbol">${icon('camera')}</div><p id="permission-text">Tap to allow your camera.</p><button class="primary-button" id="start">Open camera ${icon('arrow')}</button><div id="camera-error" hidden><code id="camera-error-code"></code><button id="copy-error" class="text-button">Copy error details</button><textarea id="error-details" aria-label="Camera error details" readonly hidden></textarea></div></div>
   </div>
   <div class="frame-data" hidden><span id="frame-data"></span><span id="frame-number"></span></div>
  </section>
  <div class="viewfinder-caption" hidden><span id="caption"></span></div>
  <section class="controls" aria-label="Camera settings">
   <div class="lens-row"><button class="round-control" id="torch" aria-label="Toggle torch" disabled>${icon('flash')}</button><div class="zoom-group" aria-label="Digital zoom"><button class="selected" data-zoom="1" aria-pressed="true">1<span>×</span></button><button data-zoom="1.5" aria-pressed="false">1.5<span>×</span></button><button data-zoom="2" aria-pressed="false">2<span>×</span></button></div><button class="round-control" id="quality" aria-label="Change image detail">Std</button></div>
   <div class="control-tabs" role="tablist" aria-label="Adjust image"><button class="active" role="tab" aria-selected="true" aria-controls="exposure-panel" id="exposure-tab" data-panel="exposure">Exposure</button><button role="tab" aria-selected="false" aria-controls="focus-panel" id="focus-tab" data-panel="focus">Focus</button><button role="tab" aria-selected="false" aria-controls="filter-panel" id="filter-tab" data-panel="filter">Filter</button></div>
   <div class="adjustment-panel" id="exposure-panel" role="tabpanel" aria-labelledby="exposure-tab"><div class="range-top"><span></span><output id="exposure-value">0.0 ev</output></div><div class="slider-row">${icon('sun')}<input id="exposure" type="range" min="-2" max="2" value="0" step="0.1" aria-label="Image exposure"/>${icon('sun')}</div></div>
   <div class="adjustment-panel" id="focus-panel" role="tabpanel" aria-labelledby="focus-tab" hidden><div class="range-top"><span id="focus-label">Auto</span><output id="focus-value">Auto</output></div><div class="slider-row">${icon('focus')}<input id="focus" type="range" min="0" max="1" value="0" step="0.01" aria-label="Manual camera focus" disabled/><button class="text-button" id="focus-auto">Auto</button></div></div>
   <div class="adjustment-panel filters" id="filter-panel" role="tabpanel" aria-labelledby="filter-tab" hidden>${['original','mono','amber','ghost'].map((f,i)=>`<button class="filter-button ${i===0?'selected':''}" data-filter="${f}" aria-pressed="${i===0}"><span class="filter-swatch ${f}"></span>${f[0].toUpperCase()+f.slice(1)}</button>`).join('')}</div>
  </section>
  <div class="capture-row"><button class="icon-button secondary-action" id="save" aria-label="Save current QR image" disabled>${icon('save')}</button><button class="shutter" id="shutter" aria-label="Freeze current QR frame" disabled><span></span></button><button class="icon-button secondary-action" id="flip" aria-label="Switch front and rear cameras">${icon('flip')}</button></div>
  <footer class="camera-footer" hidden><span id="shutter-hint"></span></footer>
  <div class="home-indicator" aria-hidden="true"></div>
 </main><div class="toast" id="toast" role="status"></div>`;
 document.body.append(video);
 bindCamera();
 try {paintQr(frameBaseUrl); if($('#phone-qr'))renderQr($('#phone-qr'),frameBaseUrl);} catch { /* A transient layout must not disable camera access. */ }
}

function paintQr(url){
 const canvas=$('#qr');
 const dpr=window.devicePixelRatio||1;
 const qr=renderQr(canvas,url,{fitToPixels:Math.floor(canvas.parentElement.clientWidth*dpr)});
 canvas.style.width=canvas.style.height=`${qr.size/dpr}px`;
 const box=canvas.parentElement.getBoundingClientRect();
 canvas.style.left=`${Math.round((box.x+(box.width-qr.size/dpr)/2)*dpr)/dpr-box.x}px`;
 canvas.style.top=`${Math.round((box.y+(box.height-qr.size/dpr)/2)*dpr)/dpr-box.y}px`;
 return qr;
}
window.addEventListener('resize',()=>{if($('#qr'))paintQr(state.frame?.url||frameBaseUrl);});

function bindCamera(){
 bindCameraActivation($('#start'),event=>startCamera(event));
 $('#copy-error').onclick=async()=>{
  if(!state.diagnostic)return;
  const text=JSON.stringify(state.diagnostic,null,2);
  try{await navigator.clipboard.writeText(text);$('#copy-error').textContent='Copied';}
  catch{$('#error-details').hidden=false;$('#error-details').value=text;$('#error-details').select();}
 };
 $('#shutter').onclick=toggleFreeze;
 $('#save').onclick=()=>{if(!state.frame)return; if(!state.frozen)toggleFreeze();saveData($('#qr').toDataURL('image/png'),`qamera-${Date.now()}.png`);toast('The code is yours. Scan to see.');};
 $('#open-frame').onclick=()=>{if(!state.frame)return;if(!state.frozen)toggleFreeze();location.assign(state.frame.url);};
 bindCameraActivation($('#flip'),event=>{if(state.starting)return;state.facing=state.facing==='environment'?'user':'environment';startCamera(event);});
 $('#exposure').oninput=e=>{state.exposure=Number(e.target.value);$('#exposure-value').textContent=`${state.exposure>0?'+':''}${state.exposure.toFixed(1)} ev`;adjustChanged();};
 document.querySelectorAll('[data-zoom]').forEach(b=>b.onclick=()=>{state.zoom=Number(b.dataset.zoom);document.querySelectorAll('[data-zoom]').forEach(x=>{x.classList.toggle('selected',x===b);x.setAttribute('aria-pressed',x===b);});adjustChanged();});
 document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{state.filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>{x.classList.toggle('selected',x===b);x.setAttribute('aria-pressed',x===b);});adjustChanged();});
 const tabs=[...document.querySelectorAll('[data-panel]')];
 tabs.forEach((b,i)=>{b.onclick=()=>{tabs.forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-selected',x===b);x.tabIndex=x===b?0:-1;$(`#${x.dataset.panel}-panel`).hidden=x!==b;});};b.onkeydown=e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();const next=tabs[(i+(e.key==='ArrowRight'?1:2))%3];next.click();next.focus();}};});
 $('#speed').onclick=()=>{state.fps=state.fps===1?2:state.fps===2?0.5:1;$('#speed').textContent=`${state.fps} fps`;toast(state.fps===0.5?'Slow codes. Easier to scan.':`${state.fps} images per second.`);};
 $('#quality').onclick=()=>{state.budget=state.budget===DEFAULT_URL_BUDGET?FINE_URL_BUDGET:DEFAULT_URL_BUDGET;$('#quality').textContent=state.budget===DEFAULT_URL_BUDGET?'Std':'Fine';toast(state.budget===DEFAULT_URL_BUDGET?'Standard detail. Easier to scan.':'More detail. A denser code.');adjustChanged();};
 $('#torch').onclick=async()=>{try{const enabled=!state.torch;await state.track.applyConstraints({advanced:[{torch:enabled}]});state.torch=enabled;$('#torch').classList.toggle('selected',enabled);$('#torch').setAttribute('aria-pressed',enabled);}catch{toast('This camera could not change its torch.');}};
 $('#focus').oninput=async e=>{if(!state.track)return;try{const v=Number(e.target.value);await state.track.applyConstraints({advanced:[{focusMode:'manual',focusDistance:v}]});$('#focus-value').textContent=v.toFixed(2);$('#focus-label').textContent='Manual';}catch{toast('Manual focus is unavailable on this camera.');}};
 $('#focus-auto').onclick=async()=>{if(!state.track||!state.caps.focusMode?.includes('continuous')){toast('This camera manages focus automatically.');return;}try{await state.track.applyConstraints({advanced:[{focusMode:'continuous'}]});$('#focus-value').textContent='Auto';$('#focus-label').textContent='Auto';}catch{toast('Autofocus could not be changed.');}};
}
function adjustChanged(){if(state.frozen)toast('Held frame unchanged. Tap the shutter to go live.');}
function setReady(isDemo=false){$('#permission-card').hidden=true;state.running=true;state.frozen=false;state.frame=null;$('#shutter').disabled=true;$('#save').disabled=true;$('#open-frame').disabled=true;$('#shutter').classList.remove('held');$('#shutter').setAttribute('aria-label','Freeze current QR frame');$('#caption').textContent=isDemo?'Sample light. Real code.':'The image is in the code.';$('#shutter-hint').textContent='TAP TO HOLD THE MOMENT';status(isDemo?'Demo':'Live','live');}
async function startCamera(event){
 if(state.starting)return;
 state.starting=true;state.running=false;clearTimeout(state.timer);
 const token=++state.token;stopTracks();state.frame=null;
 $('#shutter').disabled=true;$('#save').disabled=true;$('#open-frame').disabled=true;
 $('#permission-card').hidden=false;$('#camera-error').hidden=true;$('#error-details').hidden=true;$('#copy-error').textContent='Copy error details';
 $('#permission-text').textContent='Allow Camera when your browser asks.';
 status('Connecting');$('#start').disabled=true;$('#start').textContent='Opening…';
 const startedAt=performance.now();
 const diagnostic={build:'noisample-capture-1',...cameraEnvironment(),activation:{event:event?.type||'none',pointer:event?.pointerType||null,trusted:event?.isTrusted??false},stage:'request',constraints:{audio:false,video:{facingMode:{ideal:state.facing}}}};
 state.diagnostic=diagnostic;
 try{
  if(!window.isSecureContext)throw Object.assign(new Error('Open QameRa over HTTPS to use the camera.'),{name:'CameraContextError'});
  if(!navigator.mediaDevices?.getUserMedia)throw Object.assign(new Error('Open this link directly in Chrome or Safari to use the camera.'),{name:'CameraContextError'});
  state.cameraRequest=requestCamera(
   navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices),
   diagnostic.constraints
  );
  const stream=await state.cameraRequest.promise;
  if(token!==state.token){stream.getTracks().forEach(t=>t.stop());return;}
  state.cameraRequest=null;state.stream=stream;state.track=stream.getVideoTracks()[0];
  if(!state.track)throw new Error('The camera did not provide a video track.');
  diagnostic.stage='playback';diagnostic.requestMs=Math.round(performance.now()-startedAt);
  video.srcObject=stream;
  await playCamera(video,{isCurrent:()=>token===state.token});
  if(token!==state.token)return;
  diagnostic.stage='controls';
  // As in noisample, obtain the stream before configuring its processing.
  // Preferred resolution must not prevent permission or usable video.
  try{state.track.applyConstraints?.({width:{ideal:640},height:{ideal:640}})?.catch(()=>{});}catch{}
  state.isDemo=false;state.caps={};
  try{state.caps=state.track.getCapabilities?.()||{};}catch{/* Camera playback does not require capability inspection. */}
  state.torch=false;$('#torch').classList.remove('selected');$('#torch').disabled=!state.caps.torch;
  const focus=state.caps.focusDistance;const manual=focus&&state.caps.focusMode?.includes('manual');$('#focus').disabled=!manual;
  $('#focus-label').textContent=manual?'Auto':'Autofocus';$('#focus-value').textContent='Auto';
  if(manual){$('#focus').min=focus.min;$('#focus').max=focus.max;$('#focus').step=focus.step||0.01;$('#focus').value=state.track.getSettings?.().focusDistance??focus.min;}
  state.track.onended=()=>{if(state.running&&!state.isDemo){state.running=false;++state.token;clearTimeout(state.timer);status('Paused');$('#permission-card').hidden=false;$('#permission-text').textContent='Camera disconnected. Tap to reconnect.';}};
  diagnostic.stage='ready';setReady();tick(token);
 }catch(error){
  if(token!==state.token)return;
  status('No camera');$('#permission-card').hidden=false;
  diagnostic.elapsedMs=Math.round(performance.now()-startedAt);
  diagnostic.error={name:error.name||'Error',message:String(error.message||''),constraint:error.constraint||null};
  diagnostic.cameraPermission='checking';
  readCameraPermission().then(value=>{diagnostic.cameraPermission=value;});
  $('#permission-text').textContent=describeCameraFailure(error,diagnostic.stage);
  $('#camera-error-code').textContent=`${diagnostic.stage} · ${diagnostic.error.name} · ${diagnostic.elapsedMs} ms`;
  $('#camera-error').hidden=false;
  stopTracks();
 }finally{
  if(token===state.token){state.cameraRequest=null;state.starting=false;$('#start').disabled=false;$('#start').innerHTML=`Open camera ${icon('arrow')}`;}
 }
}
function startDemo(){++state.token;stopTracks();clearTimeout(state.timer);state.isDemo=true;state.starting=false;state.caps={};$('#torch').disabled=true;$('#focus').disabled=true;setReady(true);tick(state.token);}
function drawSample(time){
 ctx.save();ctx.scale(source.width/192,source.height/192);
 const w=192;const g=ctx.createLinearGradient(0,0,w,w);g.addColorStop(0,'#e9f2d9');g.addColorStop(1,'#9bbaa1');ctx.fillStyle=g;ctx.fillRect(0,0,w,w);
 ctx.fillStyle='#456a4b';ctx.beginPath();ctx.ellipse(53,98,31,56,-.5,0,Math.PI*2);ctx.fill();ctx.fillStyle='#658754';ctx.beginPath();ctx.ellipse(131,67,27,53,.7,0,Math.PI*2);ctx.fill();
 ctx.strokeStyle='#30533a';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(95,160);ctx.quadraticCurveTo(102+Math.sin(time/2000)*4,93,140,40);ctx.stroke();ctx.beginPath();ctx.moveTo(95,160);ctx.quadraticCurveTo(75,100,35,53);ctx.stroke();
 ctx.fillStyle='#e36d45';ctx.beginPath();ctx.moveTo(65,138);ctx.lineTo(124,138);ctx.lineTo(114,187);ctx.lineTo(76,187);ctx.closePath();ctx.fill();ctx.fillStyle='#f79468';ctx.fillRect(62,134,65,11);ctx.restore();
}
function drawSource(){
 const w=source.width;if(state.isDemo)drawSample(performance.now());else{const crop=Math.min(video.videoWidth,video.videoHeight)/state.zoom;const x=(video.videoWidth-crop)/2,y=(video.videoHeight-crop)/2;ctx.save();if(state.facing==='user'){ctx.translate(w,0);ctx.scale(-1,1);}ctx.drawImage(video,x,y,crop,crop,0,0,w,w);ctx.restore();}
 if(state.isDemo&&state.zoom!==1){const crop=w/state.zoom;ctx.drawImage(source,(w-crop)/2,(w-crop)/2,crop,crop,0,0,w,w);}
 const im=ctx.getImageData(0,0,w,w),d=im.data,gain=2**state.exposure;
 for(let i=0;i<d.length;i+=4){let r=d[i],g=d[i+1],b=d[i+2];const l=.2126*r+.7152*g+.0722*b;if(state.filter==='mono')r=g=b=l;else if(state.filter==='amber'){r=l*1.14+19;g=l*.88+6;b=l*.58;}else if(state.filter==='ghost'){r=255-r;g=255-g;b=255-b;}d[i]=r*gain;d[i+1]=g*gain;d[i+2]=b*gain;}
 ctx.putImageData(im,0,0);
}
async function tick(token){
 if(token!==state.token||!state.running||state.frozen||document.hidden)return;
 const start=performance.now();
 try{drawSource();const frame=await encodeFrame(source,frameBaseUrl,{maxUrlLength:state.budget,size:state.budget===DEFAULT_URL_BUDGET?192:256});if(token!==state.token||state.frozen||!state.running)return;const qr=paintQr(frame.url);state.frame=frame;state.count++;$('#shutter').disabled=false;$('#save').disabled=false;$('#open-frame').disabled=false;status(state.isDemo?'Demo':'Live','live');$('#frame-data').textContent=`${frame.width} × ${frame.height} · ${(frame.bytes/1024).toFixed(1)} KB · QR ${qr.version}`;$('#frame-number').textContent=`FRAME ${String(state.count).padStart(4,'0')}`;}
 catch(error){if(token!==state.token)return;status('Retrying');console.warn('QameRa encoding:',error.message);}
 if(token===state.token&&state.running&&!state.frozen)state.timer=setTimeout(()=>tick(token),Math.max(50,1000/state.fps-(performance.now()-start)));
}
function toggleFreeze(){if(!state.frame)return;state.frozen=!state.frozen;++state.token;clearTimeout(state.timer);$('#shutter').classList.toggle('held',state.frozen);$('#shutter').setAttribute('aria-label',state.frozen?'Resume live QR frames':'Freeze current QR frame');$('#shutter-hint').textContent=state.frozen?'MOMENT HELD. SCAN WITH ANOTHER PHONE.':'TAP TO HOLD THE MOMENT';$('#caption').textContent=state.frozen?'A moment, waiting to be seen.':state.isDemo?'Sample light. Real code.':'The image is in the code.';status(state.frozen?'Held':state.isDemo?'Demo':'Live',state.frozen?'held':'live');if(!state.frozen)tick(state.token);if(navigator.vibrate)navigator.vibrate(12);}

function renderViewer(){
 let frame;try{frame=parseFrameHash(location.hash);if(!frame)throw new Error('Missing image');}catch{app.innerHTML=`<main class="viewer error-view"><a class="wordmark" href="${baseUrl}">QameRa</a><h1>This moment<br>got lost.</h1><p>The image link is incomplete or damaged. Try scanning the held QR again.</p><a class="primary-button" href="${baseUrl}">Open QameRa ${icon('arrow')}</a></main>`;return;}
 app.innerHTML=`<main class="viewer"><header class="topbar"><span class="status" data-state="held">Photo</span></header><div class="decoded-image"><img id="decoded" alt="Camera image reconstructed from this QR code"/></div><div class="frame-data"><span>${frame.width} × ${frame.height} · ${(frame.bytes/1024).toFixed(1)} KB</span><span>1:1</span></div><div class="viewer-actions"><button class="primary-button" id="save-photo">Save image ${icon('save')}</button><button class="icon-button" id="share-photo" aria-label="Share image link">${icon('share')}</button></div><a class="viewer-return" href="${baseUrl}">Open camera ${icon('arrow')}</a></main><div id="toast" class="toast" role="status"></div>`;
 $('#decoded').onerror=()=>{toast('This image could not be decoded. Scan the held QR again.');$('#save-photo').disabled=true;};$('#decoded').src=frame.dataUrl;$('#save-photo').onclick=()=>saveData(frame.dataUrl,`qamera-${Date.now()}.${frame.extension}`);
 $('#share-photo').onclick=async()=>{try{if(navigator.share)await navigator.share({title:'QameRa — a moment, decoded.',url:location.href});else{await navigator.clipboard.writeText(location.href);toast('Image link copied.');}}catch(e){if(e.name!=='AbortError')toast('Use your browser share button to share this link.');}};
}

if(location.hash){renderViewer();}else{app.innerHTML='<div class="intro"><span class="wordmark">Qame<span>R</span>a</span></div>';setTimeout(()=>{cameraMarkup();if(demo)startDemo();},2000);}
window.addEventListener('pagehide',()=>{state.running=false;++state.token;state.cameraRequest?.cancel();state.cameraRequest=null;state.starting=false;clearTimeout(state.timer);stopTracks();});
window.addEventListener('pageshow',e=>{if(e.persisted&&!location.hash&&$('#permission-card')){state.starting=false;$('#permission-card').hidden=false;$('#start').disabled=false;$('#start').innerHTML=`Open camera ${icon('arrow')}`;$('#permission-text').textContent='Tap to allow your camera.';status('Ready');}});
window.addEventListener('hashchange',()=>location.reload());
document.addEventListener('visibilitychange',()=>{clearTimeout(state.timer);if(state.running){++state.token;if(!document.hidden&&!state.frozen)tick(state.token);}});
