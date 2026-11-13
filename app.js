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
function drawFiles(){if(typeof resetPreparedShare==='function')resetPreparedShare();const list=$('fileList');list.replaceChildren();files.forEach((entry,i)=>{const f=entry.file;const row=document.createElement('div');row.className='file';const title=document.createElement('span');title.textContent=`${i+1}. ${f.name}`+(entry.processed?'（補正済み）':'');row.append(title);if(!(f.type==='application/pdf'||/\.pdf$/i.test(f.name))){const edit=document.createElement('button');edit.className='secondary';edit.textContent='トリミング';edit.onclick=()=>openCrop(i);row.append(edit)}const del=document.createElement('button');del.textContent='削除';del.onclick=()=>{files.splice(i,1);drawFiles()};row.append(del);list.append(row)})}
function validate(){if(!files.length)throw Error('写真またはPDFを追加してください。');if(!$('date').value)throw Error('日付を入力してください。');
  if(reportMode()){if(!$('customer').value.trim())throw Error('ユーザー名を入力してください。')}
  else {if(!$('name').value.trim())throw Error('基本設定の名前を入力してください。');if(!/^\d+$/.test($('amount').value.replaceAll(',','')))throw Error('金額は0以上の整数で入力してください。');if($('category').value==='その他'&&!$('other').value.trim())throw Error('その他の勘定科目を入力してください。')}
}
// PDF出力時だけ縮小・JPEG圧縮。元画像やトリミング位置は変更しない。
async function imageJpeg(file, isReport){
  const bitmap=await createImageBitmap(file);
  try{
    const maxSide=isReport?2200:1600;
    const quality=isReport?0.80:0.70;
    const scale=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));
    canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const ctx=canvas.getContext('2d',{alpha:false});
    if(!ctx)throw Error('画像処理用の画面を作成できませんでした');
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('JPEG圧縮に失敗しました')),'image/jpeg',quality));
    if(blob.type!=='image/jpeg')throw Error('JPEG圧縮に対応していません');
    return await blob.arrayBuffer();
  }finally{bitmap.close()}
}
async function buildPdf(){validate();if(!window.PDFLib)throw Error('PDFライブラリの読み込みに失敗しました。インターネット接続を確認してください。');
  const doc=await PDFLib.PDFDocument.create();for(const entry of files){const file=entry.file;if(file.type==='application/pdf'||/\.pdf$/i.test(file.name)){
      let input;try{input=await PDFLib.PDFDocument.load(await file.arrayBuffer())}catch(_e){throw Error(file.name+' を開けません。暗号化PDFや破損ファイルは非対応です。')}
      const pages=await doc.copyPages(input,input.getPageIndices());for(const p of pages)doc.addPage(p);
    }else{let jpeg;try{jpeg=await imageJpeg(entry.processed||file,reportMode())}catch(_e){throw Error(file.name+' の画像を変換できません。JPEGまたはPNGで試してください。')}
      const img=await doc.embedJpg(jpeg);const page=doc.addPage([595.28,841.89]);const scale=Math.min(555.28/img.width,801.89/img.height);const w=img.width*scale,h=img.height*scale;page.drawImage(img,{x:(595.28-w)/2,y:(841.89-h)/2,width:w,height:h});}}
  return new File([await doc.save()],$('filename').textContent,{type:'application/pdf'});
}
function download(file){const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=file.name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}
let preparedShareFile=null;
let preparingShare=false;
function resetPreparedShare(){
  preparedShareFile=null;
  const b=$('shareBtn');
  b.textContent='ドライブ・メール等に送る';
  if(!preparingShare)b.disabled=false;
}
// 入力や画像が変わった場合、以前に作った共有用PDFは使用しない。
document.addEventListener('input',e=>{if(e.target.closest('main'))resetPreparedShare()});
document.addEventListener('change',e=>{if(e.target.closest('main'))resetPreparedShare()});
async function savePdf(){
  $('saveBtn').disabled=true;
  $('status').textContent='PDFを作成しています…';
  try{
    const file=await buildPdf();
    download(file);
    $('status').textContent='スマホに保存しました：'+file.name;
  }catch(e){$('status').textContent='エラー：'+e.message;alert(e.message)}
  finally{$('saveBtn').disabled=false}
}
function sharePdf(){
  if(preparedShareFile){
    // ユーザー操作の同期処理内でshare()を呼ぶ。await buildPdf()を挟まない。
    const file=preparedShareFile;
    if(!navigator.share||!navigator.canShare?.({files:[file]})){
      $('status').textContent='このブラウザはファイル共有に対応していません。スマホに保存してからドライブやメールで開いてください。';
      return;
    }
    try{
      const promise=navigator.share({files:[file],title:file.name});
      $('status').textContent='送信先を選択してください。';
      Promise.resolve(promise).catch(e=>{
        if(e.name!=='AbortError'){$('status').textContent='共有エラー：'+e.message;alert('共有できませんでした：'+e.message)}
        else $('status').textContent='共有をキャンセルしました。もう一度「送る」を押せます。';
      });
    }catch(e){$('status').textContent='共有エラー：'+e.message;alert(e.message)}
    return;
  }
  if(preparingShare)return;
  preparingShare=true;
  $('shareBtn').disabled=true;
  $('saveBtn').disabled=true;
  $('status').textContent='送信用PDFを準備しています…';
  buildPdf().then(file=>{
    preparedShareFile=file;
    $('shareBtn').textContent='送る（準備完了）';
    $('status').textContent='PDFの準備ができました。「送る（準備完了）」をもう一度押して、Googleドライブやメールを選んでください。';
  }).catch(e=>{
    $('status').textContent='エラー：'+e.message;alert(e.message);
  }).finally(()=>{
    preparingShare=false;
    $('saveBtn').disabled=false;
    $('shareBtn').disabled=false;
  });
}
$('saveBtn').onclick=savePdf;
$('shareBtn').onclick=sharePdf;
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
