import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

const root = resolve('docs/design-recovery/2026-09-13')
const output = resolve(root, 'shots-system')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' })
const palettes = [{key:'ember',label:'01-graphite-ember'},{key:'slate',label:'02-slate-signal'},{key:'mineral',label:'03-mineral-quiet'}]
const viewports = [{width:1440,height:900,label:'1440x900'},{width:900,height:700,label:'900x700'}]
const report={generatedAt:new Date().toISOString(),hero:[],lab:[],paletteLabChecks:[],overlays:[],geometryParity:[]}
const geometryBaseline=new Map()
const fileUrl=(name,query='')=>`file:///${resolve(root,name).replaceAll('\\','/')}${query}`
const settle=async(page)=>{await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));await page.waitForTimeout(120)}

const evaluateHero=(page)=>page.evaluate(()=>{
  const selectors=['.app','.presence','.work-rail','.main','.main-head','.plane','.composer-wrap','.composer','.dock']
  const visible=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0}
  const box=el=>{const r=el.getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}}
  const boxes=Object.fromEntries(selectors.map(selector=>[selector,document.querySelector(selector)]).filter(([,el])=>el&&visible(el)).map(([selector,el])=>[selector,box(el)]))
  const issues=[]
  if(document.documentElement.scrollWidth>innerWidth+1||document.documentElement.scrollHeight>innerHeight+1)issues.push({kind:'document-overflow',size:[document.documentElement.scrollWidth,document.documentElement.scrollHeight]})
  for(const[selector,r]of Object.entries(boxes))if(r.left<-.75||r.top<-.75||r.right>innerWidth+.75||r.bottom>innerHeight+.75)issues.push({kind:'viewport-escape',selector,rect:r})
  for(const selector of['.app','.main','.plane','.composer','.dock']){const el=document.querySelector(selector);if(!el||!visible(el))continue;const s=getComputedStyle(el);if(!['auto','scroll'].includes(s.overflowX)&&el.scrollWidth>el.clientWidth+1)issues.push({kind:'x-overflow',selector,scroll:el.scrollWidth,client:el.clientWidth});if(!['auto','scroll'].includes(s.overflowY)&&el.scrollHeight>el.clientHeight+1)issues.push({kind:'y-overflow',selector,scroll:el.scrollHeight,client:el.clientHeight})}
  return{boxes,issues}
})

const evaluateLab=(page)=>page.evaluate(()=>{
  const issues=[]
  const visible=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0}
  const rect=el=>{const r=el.getBoundingClientRect();return{name:el.getAttribute('aria-label')||el.textContent?.trim().slice(0,36)||el.tagName,left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}}
  if(document.documentElement.scrollWidth>innerWidth+1)issues.push({kind:'document-x-overflow',scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth})
  for(const el of document.querySelectorAll('[data-qa-hit]')){if(!visible(el))continue;const r=rect(el);if(r.width<44||r.height<44)issues.push({kind:'hit-area',rect:r})}
  for(const el of document.querySelectorAll('.plate-title,.group-title,.state-label,.field label,.object-name,.evidence-title')){if(!visible(el))continue;const s=getComputedStyle(el);if(s.textOverflow!=='ellipsis'&&(el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1))issues.push({kind:'text-clipping',rect:rect(el),scroll:[el.scrollWidth,el.scrollHeight],client:[el.clientWidth,el.clientHeight]})}
  for(const stage of document.querySelectorAll('[data-overlay-stage]')){const sr=stage.getBoundingClientRect(),items=[...stage.querySelectorAll('[data-overlay]')].filter(visible);for(const el of items){const r=el.getBoundingClientRect();if(r.left<sr.left-.75||r.top<sr.top-.75||r.right>sr.right+.75||r.bottom>sr.bottom+.75)issues.push({kind:'overlay-escape',rect:rect(el),stage:rect(stage)})}for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){const a=items[i].getBoundingClientRect(),b=items[j].getBoundingClientRect(),w=Math.min(a.right,b.right)-Math.max(a.left,b.left),h=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);if(w>.75&&h>.75)issues.push({kind:'overlay-overlap',a:rect(items[i]),b:rect(items[j]),area:Number((w*h).toFixed(1))})}}
  for(const el of document.querySelectorAll('*')){if(!visible(el))continue;const s=getComputedStyle(el),owns=el.hasAttribute('data-scroll-owner')||el===document.documentElement||el===document.body;if(['auto','scroll'].includes(s.overflowY)&&el.scrollHeight>el.clientHeight+1&&!owns)issues.push({kind:'unexpected-scroll-owner',rect:rect(el),className:el.className})}
  const focused=document.querySelector('.btn.secondary');focused.focus();const fs=getComputedStyle(focused);if(fs.outlineStyle==='none'&&fs.boxShadow==='none')issues.push({kind:'focus-not-visible',rect:rect(focused)})
  const demoFocus=document.querySelector('.demo-focus'),dfs=getComputedStyle(demoFocus);if(dfs.outlineStyle==='none'&&dfs.boxShadow==='none')issues.push({kind:'demo-focus-not-visible'})
  const normal=getComputedStyle(document.querySelector('.states .btn.secondary')).backgroundColor,hover=getComputedStyle(document.querySelector('.states .demo-hover')).backgroundColor,selected=getComputedStyle(document.querySelector('.states .demo-selected')).backgroundColor;if(normal===hover||hover===selected)issues.push({kind:'state-hierarchy-not-distinct',normal,hover,selected})
  const parse=value=>{const m=value.trim().match(/^#([0-9a-f]{6})$/i);if(!m)return null;const n=parseInt(m[1],16);return[(n>>16)&255,(n>>8)&255,n&255]}
  const lum=rgb=>{const v=rgb.map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});return.2126*v[0]+.7152*v[1]+.0722*v[2]}
  const contrast=(a,b)=>{const l1=lum(a),l2=lum(b);return(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05)}
  const vars=getComputedStyle(document.body),checks=[['--t1','--canvas'],['--t2','--canvas'],['--t3','--canvas'],['--t1','--s1'],['--t2','--s1'],['--accent','--shell']],contrasts=[]
  for(const[fg,bg]of checks){const a=parse(vars.getPropertyValue(fg)),b=parse(vars.getPropertyValue(bg));if(a&&b){const ratio=contrast(a,b);contrasts.push({fg,bg,ratio:Number(ratio.toFixed(2))});if(ratio<4.5)issues.push({kind:'contrast',fg,bg,ratio:Number(ratio.toFixed(2))})}}
  return{issues,contrasts,documentHeight:document.documentElement.scrollHeight}
})

try{
  for(const viewport of viewports)for(const palette of palettes){const page=await browser.newPage({viewport});await page.goto(fileUrl('color-directions.html',`?palette=${palette.key}`));await settle(page);const qa=await evaluateHero(page);const screenshot=resolve(output,`${palette.label}-${viewport.label}.png`);await page.screenshot({path:screenshot});const baselineKey=viewport.label;if(!geometryBaseline.has(baselineKey))geometryBaseline.set(baselineKey,qa.boxes);const base=geometryBaseline.get(baselineKey),deltas=[];for(const[selector,r]of Object.entries(qa.boxes)){const b=base[selector];if(!b)continue;for(const key of['left','top','width','height']){const delta=Math.abs(r[key]-b[key]);if(delta>.5)deltas.push({selector,key,delta})}}report.geometryParity.push({palette:palette.key,viewport:viewport.label,pass:deltas.length===0,deltas});report.hero.push({palette:palette.key,viewport:viewport.label,screenshot,pass:qa.issues.length===0&&deltas.length===0,...qa});await page.close()}
  for(const viewport of viewports){const page=await browser.newPage({viewport});await page.goto(fileUrl('component-lab.html','?palette=ember'));await settle(page);const qa=await evaluateLab(page);const screenshot=resolve(output,`component-lab-${viewport.label}.png`),fullScreenshot=resolve(output,`component-lab-${viewport.label}-full.png`);await page.screenshot({path:screenshot});await page.screenshot({path:fullScreenshot,fullPage:true});report.lab.push({viewport:viewport.label,screenshot,fullScreenshot,pass:qa.issues.length===0,...qa});if(viewport.width===1440){await page.locator('[data-overlay-stage]').scrollIntoViewIfNeeded();await page.locator('.modal-trigger').click();await settle(page);const modalQa=await page.evaluate(()=>{const stage=document.querySelector('[data-overlay-stage]').getBoundingClientRect(),modal=document.querySelector('[data-modal]').getBoundingClientRect();return{contained:modal.left>=stage.left&&modal.top>=stage.top&&modal.right<=stage.right&&modal.bottom<=stage.bottom,stage:{left:stage.left,top:stage.top,right:stage.right,bottom:stage.bottom},modal:{left:modal.left,top:modal.top,right:modal.right,bottom:modal.bottom}}});const overlayScreenshot=resolve(output,'component-lab-overlays-1440x900.png');await page.screenshot({path:overlayScreenshot});report.overlays.push({viewport:viewport.label,screenshot:overlayScreenshot,pass:modalQa.contained,...modalQa})}await page.close()}
  for(const palette of palettes){const page=await browser.newPage({viewport:{width:1440,height:900}});await page.goto(fileUrl('component-lab.html',`?palette=${palette.key}`));await settle(page);const qa=await evaluateLab(page);report.paletteLabChecks.push({palette:palette.key,pass:qa.issues.length===0,issues:qa.issues,contrasts:qa.contrasts});await page.close()}
}finally{await browser.close()}
await writeFile(resolve(output,'qa-report.json'),`${JSON.stringify(report,null,2)}\n`,'utf8')
for(const item of report.hero)console.log(`${item.pass?'PASS':'FAIL'} hero ${item.palette} ${item.viewport} issues=${item.issues.length}`)
for(const item of report.geometryParity)console.log(`${item.pass?'PASS':'FAIL'} geometry ${item.palette} ${item.viewport} deltas=${item.deltas.length}`)
for(const item of report.lab)console.log(`${item.pass?'PASS':'FAIL'} lab ${item.viewport} issues=${item.issues.length}`)
for(const item of report.paletteLabChecks)console.log(`${item.pass?'PASS':'FAIL'} lab-palette ${item.palette} issues=${item.issues.length}`)
for(const item of report.overlays)console.log(`${item.pass?'PASS':'FAIL'} overlays ${item.viewport}`)
if([...report.hero,...report.geometryParity,...report.lab,...report.paletteLabChecks,...report.overlays].some(item=>!item.pass))process.exitCode=1
