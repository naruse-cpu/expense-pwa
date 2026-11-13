'use strict';
// Browser-side document detection and perspective correction. No image upload.
const cropState={index:-1,canvas:null,ctx:null,source:null,points:[],drag:-1,ready:false,cvPromise:null};
function cropStatus(s){document.getElementById('cropStatus').textContent=s}
function ensureCv(){
 if(window.cv&&typeof cv.Mat==='function')return Promise.resolve(cv);
 if(cropState.cvPromise)return cropState.cvPromise;
 cropState.cvPromise=new Promise((resolve,reject)=>{
   const script=document.createElement('script');script.src='https://docs.opencv.org/4.x/opencv.js';script.async=true;
   const timeout=setTimeout(()=>reject(Error('画像処理ライブラリの読み込みがタイムアウトしました。通信環境を確認してください。')),35000);
   script.onerror=()=>{clearTimeout(timeout);reject(Error('画像処理ライブラリを読み込めませんでした。'))};
   script.onload=()=>{let n=0;const check=()=>{if(window.cv&&typeof cv.Mat==='function'){clearTimeout(timeout);resolve(cv)}else if(n++<150)setTimeout(check,100);else{clearTimeout(timeout);reject(Error('画像処理の初期化に失敗しました。'))}};check()};
   document.head.appendChild(script);
 });return cropState.cvPromise;
}
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
async function autoDetect(){if(!cropState.source)return;cropStatus('用紙の輪郭を検出しています…');try{await ensureCv();const source=cv.imread(cropState.source),gray=new cv.Mat(),blur=new cv.Mat(),edges=new cv.Mat(),contours=new cv.MatVector(),hierarchy=new cv.Mat();
 try{cv.cvtColor(source,gray,cv.COLOR_RGBA2GRAY);cv.GaussianBlur(gray,blur,new cv.Size(5,5),0);cv.Canny(blur,edges,45,130);cv.findContours(edges,contours,hierarchy,cv.RETR_LIST,cv.CHAIN_APPROX_SIMPLE);
 let best=null,area=0;for(let i=0;i<contours.size();i++){const contour=contours.get(i),approx=new cv.Mat();try{const ar=cv.contourArea(contour);if(ar<source.cols*source.rows*.08||ar<=area)continue;cv.approxPolyDP(contour,approx,.025*cv.arcLength(contour,true),true);if(approx.rows===4&&cv.isContourConvex(approx)){const pts=[];for(let j=0;j<4;j++)pts.push({x:approx.intPtr(j,0)[0],y:approx.intPtr(j,0)[1]});best=ordered(pts);area=ar}}finally{contour.delete();approx.delete()}}
 if(best){cropState.points=best;drawCrop();cropStatus('自動検出できました。四隅の位置を確認して、必要なら青い点を動かしてください。')}else cropStatus('用紙を自動検出できませんでした。青い点を四隅に合わせてください。');
 }finally{source.delete();gray.delete();blur.delete();edges.delete();contours.delete();hierarchy.delete()}}
 catch(e){cropStatus('自動検出を利用できません: '+e.message+'。手動で四隅を調整できますが、補正の実行には画像処理ライブラリが必要です。')}}
function distance(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
async function applyCrop(){if(!cropState.source)return;cropStatus('切り抜きと台形補正を実行中…');try{await ensureCv();const pts=ordered(cropState.points);const width=Math.round(Math.max(distance(pts[0],pts[1]),distance(pts[3],pts[2]))),height=Math.round(Math.max(distance(pts[0],pts[3]),distance(pts[1],pts[2])));if(width<80||height<80)throw Error('選択範囲が小さすぎます。');const factor=Math.min(1,2500/Math.max(width,height)),w=Math.max(1,Math.round(width*factor)),h=Math.max(1,Math.round(height*factor));
 const src=cv.imread(cropState.source),dst=new cv.Mat(),srcPoints=cv.matFromArray(4,1,cv.CV_32FC2,pts.flatMap(p=>[p.x,p.y])),dstPoints=cv.matFromArray(4,1,cv.CV_32FC2,[0,0,w-1,0,w-1,h-1,0,h-1]);let matrix;
 try{matrix=cv.getPerspectiveTransform(srcPoints,dstPoints);cv.warpPerspective(src,dst,matrix,new cv.Size(w,h),cv.INTER_LINEAR,cv.BORDER_CONSTANT,new cv.Scalar(255,255,255,255));const mode=document.getElementById('imageMode').value;if(mode!=='color'){const gray=new cv.Mat();try{cv.cvtColor(dst,gray,cv.COLOR_RGBA2GRAY);if(mode==='bw')cv.adaptiveThreshold(gray,gray,255,cv.ADAPTIVE_THRESH_GAUSSIAN_C,cv.THRESH_BINARY,31,12);cv.cvtColor(gray,dst,cv.COLOR_GRAY2RGBA)}finally{gray.delete()}}
 const output=document.createElement('canvas');cv.imshow(output,dst);const blob=await new Promise((res,rej)=>output.toBlob(b=>b?res(b):rej(Error('画像保存に失敗しました')),'image/jpeg',.90));files[cropState.index].processed=blob;drawFiles();closeCrop();$('status').textContent='画像を補正しました。PDFに反映されます。';
 }finally{src.delete();dst.delete();srcPoints.delete();dstPoints.delete();if(matrix)matrix.delete()}}
 catch(e){cropStatus('補正エラー: '+e.message)}}
function closeCrop(){document.getElementById('cropModal').hidden=true;cropState.index=-1;cropState.source=null;cropState.points=[]}
document.getElementById('autoCropBtn').onclick=autoDetect;document.getElementById('applyCropBtn').onclick=applyCrop;document.getElementById('cancelCropBtn').onclick=closeCrop;
document.getElementById('resetCornersBtn').onclick=()=>{if(cropState.source){cropState.points=defaultPoints(cropState.source.width,cropState.source.height);drawCrop();cropStatus('四隅を初期位置に戻しました。')}};
document.getElementById('restoreOriginalBtn').onclick=()=>{if(cropState.index>=0){files[cropState.index].processed=null;drawFiles();closeCrop();$('status').textContent='元画像に戻しました。'}};
