'use strict';
const $ = id => document.getElementById(id);
const files=[];
const invalid = /[\\/:*?"<>|\x00-\x1f]/g;
const safe = value => String(value).replace(invalid,'_').trim().replace(/[. ]+$/,'').slice(0,110);
for(const key of ['department','name']){
  try{const saved=localStorage.getItem('expensePwa_'+key);if(saved!==null)$(key).value=saved;}catch(_e){}
  $(key).addEventListener('change',()=>{try{localStorage.setItem('expensePwa_'+key,$(key).value)}catch(_e){};update();});
  $(key).addEventListener('input',update);
}
const now=new Date();$('date').value=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
function reportMode(){return ['点検報告','作業報告'].includes($('kind').value)}
function update(){
  $('expenseFields').hidden=reportMode();$('reportFields').hidden=!reportMode();$('otherField').hidden=$('category').value!=='その他';
  const k=$('kind').value,day=$('date').value.replaceAll('-','');let base;
  if(reportMode()) base=(k==='点検報告'?'定期点検報告書':'作業報告書')+'_'+day+'_'+safe($('customer').value||'ユーザー名')+($('free').value.trim()?'_'+safe($('free').value):'');
  else {const cat=$('category').value==='その他'?$('other').value||'その他':$('category').value;
    base=safe($('department').value)+'経費'+(k==='スキャン'?'(ｽｷｬﾝ)':'')+'_'+day+'_'+safe($('name').value||'名前')+'_税込'+safe($('amount').value||'金額')+'_'+safe(cat)+($('payment').value==='クレジット'?'_ｸﾚｼﾞｯﾄ':'');}
  $('filename').textContent=safe(base)+'.pdf';
}
for(const id of ['kind','date','amount','category','other','payment','customer','free']){ $(id).addEventListener('change',update);$(id).addEventListener('input',update)}update();
$('cameraBtn').onclick=()=>$('cameraInput').click();$('fileBtn').onclick=()=>$('fileInput').click();
$('cameraInput').onchange=e=>{addFiles(e.target.files);e.target.value=''};
$('fileInput').onchange=e=>{addFiles(e.target.files);e.target.value=''};
$('drop').ondragover=e=>{e.preventDefault();$('drop').classList.add('drag')};
$('drop').ondragleave=()=> $('drop').classList.remove('drag');
$('drop').ondrop=e=>{e.preventDefault();$('drop').classList.remove('drag');addFiles(e.dataTransfer.files)};
function addFiles(list){for(const file of list){if(files.length>=5){alert('最大5ファイルまでです。');break}
  if(!(file.type.startsWith('image/')||file.type==='application/pdf'||/\.pdf$/i.test(file.name))){alert('未対応のファイルです: '+file.name);continue}
  if(files.some(e=>e.file.name===file.name&&e.file.size===file.size&&e.file.lastModified===file.lastModified))continue;
  files.push({file,original:file,processed:null})}drawFiles()}
function drawFiles(){const list=$('fileList');list.replaceChildren();files.forEach((entry,i)=>{const f=entry.file;const row=document.createElement('div');row.className='file';const title=document.createElement('span');title.textContent=`${i+1}. ${f.name}`+(entry.processed?'（補正済み）':'');row.append(title);if(!(f.type==='application/pdf'||/\.pdf$/i.test(f.name))){const edit=document.createElement('button');edit.className='secondary';edit.textContent='トリミング';edit.onclick=()=>openCrop(i);row.append(edit)}const del=document.createElement('button');del.textContent='削除';del.onclick=()=>{files.splice(i,1);drawFiles()};row.append(del);list.append(row)})}
function validate(){if(!files.length)throw Error('写真またはPDFを追加してください。');if(!$('date').value)throw Error('日付を入力してください。');
  if(reportMode()){if(!$('customer').value.trim())throw Error('ユーザー名を入力してください。')}
  else {if(!$('name').value.trim())throw Error('基本設定の名前を入力してください。');if(!/^\d+$/.test($('amount').value.replaceAll(',','')))throw Error('金額は0以上の整数で入力してください。');if($('category').value==='その他'&&!$('other').value.trim())throw Error('その他の勘定科目を入力してください。')}
}
async function imagePng(file){const bitmap=await createImageBitmap(file);try{const canvas=document.createElement('canvas');const scale=Math.min(1,2400/Math.max(bitmap.width,bitmap.height));canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d',{alpha:false}).drawImage(bitmap,0,0,canvas.width,canvas.height);
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('画像変換に失敗しました')),'image/png'));return await blob.arrayBuffer();}finally{bitmap.close()}}
async function buildPdf(){validate();if(!window.PDFLib)throw Error('PDFライブラリの読み込みに失敗しました。インターネット接続を確認してください。');
  const doc=await PDFLib.PDFDocument.create();for(const entry of files){const file=entry.file;if(file.type==='application/pdf'||/\.pdf$/i.test(file.name)){
      let input;try{input=await PDFLib.PDFDocument.load(await file.arrayBuffer())}catch(_e){throw Error(file.name+' を開けません。暗号化PDFや破損ファイルは非対応です。')}
      const pages=await doc.copyPages(input,input.getPageIndices());for(const p of pages)doc.addPage(p);
    }else{let png;try{png=await imagePng(entry.processed||file)}catch(_e){throw Error(file.name+' の画像を変換できません。JPEGまたはPNGで試してください。')}
      const img=await doc.embedPng(png);const page=doc.addPage([595.28,841.89]);const scale=Math.min(555.28/img.width,801.89/img.height);const w=img.width*scale,h=img.height*scale;page.drawImage(img,{x:(595.28-w)/2,y:(841.89-h)/2,width:w,height:h});}}
  return new File([await doc.save()],$('filename').textContent,{type:'application/pdf'});
}
function download(file){const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=file.name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}
async function perform(share){$('saveBtn').disabled=true;$('shareBtn').disabled=true;$('status').textContent='PDFを作成しています…';try{const file=await buildPdf();if(share&&navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:file.name});$('status').textContent='共有画面を開きました。'}else{download(file);$('status').textContent='PDFを作成しました：'+file.name+(share?'（共有非対応のためダウンロードしました）':'')}}catch(e){if(e.name==='AbortError')$('status').textContent='共有をキャンセルしました。';else{$('status').textContent='エラー：'+e.message;alert(e.message)}}finally{$('saveBtn').disabled=false;$('shareBtn').disabled=false}}
$('saveBtn').onclick=()=>perform(false);$('shareBtn').onclick=()=>perform(true);
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
