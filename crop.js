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
 try{const bitmap=await createImageBitmap(entry.original);const max=1600,scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height));const c=document.createElement('canvas');c.width=Math.max(1,Math.round(bitmap.width*scale));c.height=Math.max(1,Math.round(bitmap.height*scale));c.getContext('2d',{willReadFrequently:true}).drawImage(bitmap,0,0,c.width,c.height);bitmap.close();cropState.source=c;cropState.points=defaultPoints(c.width,c.height);cropState.canvas=document.getElementById('cropCanvas');drawCrop();cropStatus('枠は最初から少し内側に表示しています。青い4点を動かして調整するか、「画面全体に広げる」を押してください。');}catch(e){cropStatus('画像を開けません: '+e.message)}
}
function drawCrop(){const src=cropState.source;if(!src)return;const c=cropState.canvas;c.width=src.width;c.height=src.height;const x=c.getContext('2d');x.drawImage(src,0,0);x.save();x.lineWidth=Math.max(3,src.width/230);x.strokeStyle='#17b3ff';x.fillStyle='rgba(20,150,255,.13)';x.beginPath();cropState.points.forEach((p,i)=>i?x.lineTo(p.x,p.y):x.moveTo(p.x,p.y));x.closePath();x.fill();x.stroke();cropState.points.forEach((p,i)=>{x.beginPath();x.arc(p.x,p.y,Math.max(12,src.width/65),0,Math.PI*2);x.fillStyle='#ffffff';x.fill();x.strokeStyle='#0077c8';x.stroke();x.fillStyle='#174c89';x.font=`bold ${Math.max(17,src.width/40)}px sans-serif`;x.fillText(String(i+1),p.x+15,p.y-15)});x.restore()}
function pos(e){const r=cropState.canvas.getBoundingClientRect();return {x:(e.clientX-r.left)*cropState.canvas.width/r.width,y:(e.clientY-r.top)*cropState.canvas.height/r.height}}
const editor=document.getElementById('cropCanvas');editor.addEventListener('pointerdown',e=>{if(!cropState.source)return;const p=pos(e);let d=Infinity,k=-1;cropState.points.forEach((q,i)=>{const dd=Math.hypot(p.x-q.x,p.y-q.y);if(dd<d){d=dd;k=i}});if(d<cropState.source.width*.14){cropState.drag=k;editor.setPointerCapture(e.pointerId)}});
editor.addEventListener('pointermove',e=>{if(cropState.drag<0)return;const p=pos(e);cropState.points[cropState.drag]={x:Math.max(0,Math.min(editor.width-1,p.x)),y:Math.max(0,Math.min(editor.height-1,p.y))};drawCrop()});
function endDrag(){cropState.drag=-1}editor.addEventListener('pointerup',endDrag);editor.addEventListener('pointercancel',endDrag);
// Expand the selection to the full image. No automatic paper detection.
function expandToFullImage(){
 const source=cropState.source;if(!source)return;
 const w=source.width-1,h=source.height-1;
 cropState.points=[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
 drawCrop();cropStatus('画像全体を選択しました。必要なら青い4点を指で調整してください。');
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
document.getElementById('autoCropBtn').onclick=expandToFullImage;document.getElementById('applyCropBtn').onclick=applyCrop;document.getElementById('cancelCropBtn').onclick=closeCrop;
document.getElementById('resetCornersBtn').onclick=()=>{if(cropState.source){cropState.points=defaultPoints(cropState.source.width,cropState.source.height);drawCrop();cropStatus('四隅を初期位置に戻しました。')}};
document.getElementById('restoreOriginalBtn').onclick=()=>{if(cropState.index>=0){files[cropState.index].processed=null;drawFiles();closeCrop();$('status').textContent='元画像に戻しました。'}};
