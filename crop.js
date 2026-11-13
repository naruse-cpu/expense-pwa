'use strict';
// Browser-side document detection and perspective correction. No image upload.
const cropState={index:-1,canvas:null,ctx:null,source:null,points:[],drag:-1,ready:false,cvPromise:null};
function cropStatus(s){document.getElementById('cropStatus').textContent=s}
// No external image processing dependency: all operations run in Safari Canvas.
function ordered(pts){const a=pts.map(p=>({x:p.x,y:p.y}));const sums=a.map(p=>p.x+p.y),diffs=a.map(p=>p.y-p.x);
 const tl=a[sums.indexOf(Math.min(...sums))],br=a[sums.indexOf(Math.max(...sums))],tr=a[diffs.indexOf(Math.min(...diffs))],bl=a[diffs.indexOf(Math.max(...diffs))];
 if(new Set([tl,tr,br,bl]).size!==4)throw Error('四隅の位置が重なっています。');return [tl,tr,br,bl];}
function defaultPoints(w,h){const dx=w*.07,dy=h*.07;return [{x:dx,y:dy},{x:w-dx,y:dy},{x:w-dx,y:h-dy},{x:dx,y:h-dy}]}
async function openCrop(i){const entry=files[i];if(!entry||entry.file.type==='application/pdf'||/\.pdf$/i.test(entry.file.name))return;
 cropState.index=i;document.getElementById('cropModal').hidden=false;cropStatus('画像を読み込んでいます…');
 try{const bitmap=await createImageBitmap(entry.original);const max=1600,scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height));const c=document.createElement('canvas');c.width=Math.max(1,Math.round(bitmap.width*scale));c.height=Math.max(1,Math.round(bitmap.height*scale));c.getContext('2d',{willReadFrequently:true}).drawImage(bitmap,0,0,c.width,c.height);bitmap.close();cropState.source=c;cropState.points=defaultPoints(c.width,c.height);cropState.canvas=document.getElementById('cropCanvas');drawCrop();cropStatus('「自動検出」で紙の四隅を探します。失敗した場合は青い点を指で動かしてください。');
 await autoDetect();}catch(e){cropStatus('画像を開けません: '+e.message)}
}
function drawCrop(){const src=cropState.source;if(!src)return;const c=cropState.canvas;c.width=src.width;c.height=src.height;const x=c.getContext('2d');x.drawImage(src,0,0);x.save();x.lineWidth=Math.max(3,src.width/230);x.strokeStyle='#17b3ff';x.fillStyle='rgba(20,150,255,.13)';x.beginPath();cropState.points.forEach((p,i)=>i?x.lineTo(p.x,p.y):x.moveTo(p.x,p.y));x.closePath();x.fill();x.stroke();cropState.points.forEach((p,i)=>{x.beginPath();x.arc(p.x,p.y,Math.max(12,src.width/65),0,Math.PI*2);x.fillStyle='#ffffff';x.fill();x.strokeStyle='#0077c8';x.stroke();x.fillStyle='#174c89';x.font=`bold ${Math.max(17,src.width/40)}px sans-serif`;x.fillText(String(i+1),p.x+15,p.y-15)});x.restore()}
function pos(e){const r=cropState.canvas.getBoundingClientRect();return {x:(e.clientX-r.left)*cropState.canvas.width/r.width,y:(e.clientY-r.top)*cropState.canvas.height/r.height}}
const editor=document.getElementById('cropCanvas');editor.addEventListener('pointerdown',e=>{if(!cropState.source)return;const p=pos(e);let d=Infinity,k=-1;cropState.points.forEach((q,i)=>{const dd=Math.hypot(p.x-q.x,p.y-q.y);if(dd<d){d=dd;k=i}});if(d<cropState.source.width*.14){cropState.drag=k;editor.setPointerCapture(e.pointerId)}});
editor.addEventListener('pointermove',e=>{if(cropState.drag<0)return;const p=pos(e);cropState.points[cropState.drag]={x:Math.max(0,Math.min(editor.width-1,p.x)),y:Math.max(0,Math.min(editor.height-1,p.y))};drawCrop()});
function endDrag(){cropState.drag=-1}editor.addEventListener('pointerup',endDrag);editor.addEventListener('pointercancel',endDrag);
// Lightweight on-device paper detection. No external OpenCV dependency.
// Connected-component segmentation plus boundary/corner estimation.
// A confidence check prevents blindly cropping to a wrong rectangle.
async function autoDetect(){
 if(!cropState.source)return;
 const btn=document.getElementById('autoCropBtn');btn.disabled=true;
 cropStatus('用紙の四隅を自動検出しています…');
 try{
  const source=cropState.source,W=source.width,H=source.height;
  const sc=Math.min(1,420/Math.max(W,H));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(W*sc));canvas.height=Math.max(1,Math.round(H*sc));
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(source,0,0,canvas.width,canvas.height);
  const w=canvas.width,h=canvas.height,n=w*h,d=ctx.getImageData(0,0,w,h).data;
  const gray=new Uint8Array(n),rgb=new Uint8Array(n*3);
  for(let i=0;i<n;i++){let j=i*4;gray[i]=Math.round(d[j]*.299+d[j+1]*.587+d[j+2]*.114);rgb[i*3]=d[j];rgb[i*3+1]=d[j+1];rgb[i*3+2]=d[j+2]}
  // Robust border color estimate, useful for paper on a desk.
  const sample=[[],[],[]],stride=Math.max(2,Math.floor(Math.min(w,h)/35));
  function take(x,y){const j=(y*w+x)*3;for(let k=0;k<3;k++)sample[k].push(rgb[j+k])}
  for(let x=0;x<w;x+=stride){take(x,0);take(x,h-1)}
  for(let y=0;y<h;y+=stride){take(0,y);take(w-1,y)}
  const median=v=>{v.sort((a,b)=>a-b);return v[Math.floor(v.length/2)]};
  const bg=sample.map(median),mask=new Uint8Array(n);
  // Bright paper against darker background OR chromatic difference against colored surface.
  let contrastCount=0;
  for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x++){
   const i=y*w+x,j=i*3,delta=Math.abs(rgb[j]-bg[0])+Math.abs(rgb[j+1]-bg[1])+Math.abs(rgb[j+2]-bg[2]);
   const bright=gray[i]>150&&gray[i]>(bg[0]*.299+bg[1]*.587+bg[2]*.114)+24;
   if(delta>70||bright){mask[i]=1;contrastCount++}
  }
  if(contrastCount<n*.045)throw Error('背景との色の差が小さすぎます');
  // Majority filter closes small holes caused by print on the page.
  for(let pass=0;pass<2;pass++){
   const copy=mask.slice();
   for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x++){
    const i=y*w+x;let sum=0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)sum+=copy[i+dy*w+dx];
    if(sum>=5)mask[i]=1;else if(sum<=2)mask[i]=0;
   }
  }
  // Find largest foreground region; prefer one containing image center.
  const seen=new Uint8Array(n),queue=new Int32Array(n);let best=null;
  for(let i=0;i<n;i++){
   if(!mask[i]||seen[i])continue;
   let head=0,tail=1;queue[0]=i;seen[i]=1;let minX=w,minY=h,maxX=0,maxY=0;
   const pixels=[];
   while(head<tail){const at=queue[head++],x=at%w,y=(at/w)|0;pixels.push(at);
    if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
    const neighbors=[at-1,at+1,at-w,at+w];
    for(const v of neighbors){if(v<0||v>=n||Math.abs(v%w-x)+Math.abs(((v/w)|0)-y)!==1||!mask[v]||seen[v])continue;seen[v]=1;queue[tail++]=v}
   }
   const area=tail,box=(maxX-minX+1)*(maxY-minY+1);
   if(area<n*.06||box<n*.12)continue;
   const center=(minX<w*.5&&maxX>w*.5&&minY<h*.5&&maxY>h*.5);
   const score=area*(center?1.35:1);
   if(!best||score>best.score)best={score,area,pixels,minX,minY,maxX,maxY};
  }
  if(!best)throw Error('用紙の輪郭を特定できませんでした');
  if(best.maxX-best.minX<w*.25||best.maxY-best.minY<h*.25)throw Error('検出領域が小さすぎます');
  // Estimate the four actual corners rather than forcing an axis-aligned rectangle.
  // Ignore the outermost 0.5% of points to reduce isolated noise.
  const pts=best.pixels.filter(i=>{const x=i%w,y=(i/w)|0;return x>0&&x<w-1&&y>0&&y<h-1}).map(i=>({x:i%w,y:(i/w)|0}));
  if(pts.length<100)throw Error('輪郭点が不足しています');
  const corner=(fn,low)=>{
   const ranked=pts.map(p=>({p,v:fn(p)})).sort((a,b)=>low?a.v-b.v:b.v-a.v);
   const count=Math.max(1,Math.floor(ranked.length*.002));
   let x=0,y=0;for(let j=0;j<count;j++){x+=ranked[j].p.x;y+=ranked[j].p.y}
   return {x:x/count,y:y/count};
  };
  const candidates=[corner(p=>p.x+p.y,true),corner(p=>p.x-p.y,false),corner(p=>p.x+p.y,false),corner(p=>p.x-p.y,true)];
  const area=Math.abs(candidates.reduce((sum,p,i)=>{const q=candidates[(i+1)%4];return sum+p.x*q.y-q.x*p.y},0))/2;
  const bbox=(best.maxX-best.minX)*(best.maxY-best.minY);
  if(area<bbox*.40)throw Error('四隅の推定が不安定です');
  // Add small inward-safe margin (roughly 1% of page), keeping the whole paper.
  const cx=candidates.reduce((v,p)=>v+p.x,0)/4,cy=candidates.reduce((v,p)=>v+p.y,0)/4;
  cropState.points=candidates.map(p=>({x:Math.max(0,Math.min(W-1,(p.x+(p.x-cx)*.015)/sc)),y:Math.max(0,Math.min(H-1,(p.y+(p.y-cy)*.015)/sc))}));
  drawCrop();cropStatus('用紙の四隅を推定しました。青い4点を確認し、必要なら指で修正して「補正を確定」を押してください。');
 }catch(err){cropStatus('自動検出できませんでした（'+err.message+'）。青い4点を手動で合わせてください。');}
 finally{btn.disabled=false}
}
function distance(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
// Perspective correction uses native Canvas pixels, independent of OpenCV.js.
// This also works if OpenCV auto-detection is unavailable on iOS Safari.
function solveLinear(a,b){const n=b.length;for(let i=0;i<n;i++){let k=i;for(let j=i+1;j<n;j++)if(Math.abs(a[j][i])>Math.abs(a[k][i]))k=j;if(Math.abs(a[k][i])<1e-9)throw Error('四隅の配置を確認してください。');[a[i],a[k]]=[a[k],a[i]];[b[i],b[k]]=[b[k],b[i]];const v=a[i][i];for(let q=i;q<n;q++)a[i][q]/=v;b[i]/=v;for(let j=0;j<n;j++){if(j===i)continue;const m=a[j][i];for(let q=i;q<n;q++)a[j][q]-=m*a[i][q];b[j]-=m*b[i]}}return b}
function homographyToSource(pts,w,h){const corners=[[0,0],[w-1,0],[w-1,h-1],[0,h-1]],a=[],b=[];for(let i=0;i<4;i++){const [u,v]=corners[i],{x,y}=pts[i];a.push([u,v,1,0,0,0,-x*u,-x*v]);b.push(x);a.push([0,0,0,u,v,1,-y*u,-y*v]);b.push(y)}return solveLinear(a,b)}
async function applyCrop(){
 const btn=document.getElementById('applyCropBtn');if(!cropState.source||btn.disabled)return;
 btn.disabled=true;cropStatus('補正中です。写真のサイズによっては数秒かかります…');
 try{
  const pts=ordered(cropState.points),srcCanvas=cropState.source;
  const width=Math.round(Math.max(distance(pts[0],pts[1]),distance(pts[3],pts[2]))),height=Math.round(Math.max(distance(pts[0],pts[3]),distance(pts[1],pts[2])));
  if(width<80||height<80)throw Error('選択範囲が小さすぎます。');
  const factor=Math.min(1,1800/Math.max(width,height)),w=Math.max(1,Math.round(width*factor)),h=Math.max(1,Math.round(height*factor));
  const hmat=homographyToSource(pts,w,h),[a,b,c,d,e,f,g,k]=hmat;
  const src=srcCanvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,srcCanvas.width,srcCanvas.height);
  const output=document.createElement('canvas');output.width=w;output.height=h;
  const ctx=output.getContext('2d');const result=ctx.createImageData(w,h);const from=src.data,to=result.data,sw=srcCanvas.width,sh=srcCanvas.height,mode=document.getElementById('imageMode').value;
  for(let y=0;y<h;y++){for(let x=0;x<w;x++){
   const denom=g*x+k*y+1,sx=Math.round((a*x+b*y+c)/denom),sy=Math.round((d*x+e*y+f)/denom),j=(y*w+x)*4;
   let r=255,gr=255,bl=255;if(sx>=0&&sy>=0&&sx<sw&&sy<sh){const i=(sy*sw+sx)*4;r=from[i];gr=from[i+1];bl=from[i+2]}
   if(mode!=='color'){let v=Math.round(.299*r+.587*gr+.114*bl);if(mode==='bw')v=v>=165?255:0;r=gr=bl=v}
   to[j]=r;to[j+1]=gr;to[j+2]=bl;to[j+3]=255;
  }if(y%180===0)await new Promise(resolve=>setTimeout(resolve,0));}
  ctx.putImageData(result,0,0);
  const blob=await new Promise((resolve,reject)=>output.toBlob(v=>v?resolve(v):reject(Error('画像保存に失敗しました')),'image/jpeg',.9));
  const entry=files[cropState.index];if(!entry)throw Error('対象の画像が見つかりません。');entry.processed=blob;
  drawFiles();closeCrop();$('status').textContent='画像を補正しました。PDFに反映されます。';
 }catch(err){cropStatus('補正エラー: '+(err?.message||String(err)));console.error(err)}finally{btn.disabled=false}
}
function closeCrop(){document.getElementById('cropModal').hidden=true;cropState.index=-1;cropState.source=null;cropState.points=[]}
document.getElementById('autoCropBtn').onclick=autoDetect;document.getElementById('applyCropBtn').onclick=applyCrop;document.getElementById('cancelCropBtn').onclick=closeCrop;
document.getElementById('resetCornersBtn').onclick=()=>{if(cropState.source){cropState.points=defaultPoints(cropState.source.width,cropState.source.height);drawCrop();cropStatus('四隅を初期位置に戻しました。')}};
document.getElementById('restoreOriginalBtn').onclick=()=>{if(cropState.index>=0){files[cropState.index].processed=null;drawFiles();closeCrop();$('status').textContent='元画像に戻しました。'}};
