import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

const root = resolve('docs/design-recovery/2026-09-13')
const output = resolve(root, 'shots-blue')
await mkdir(output, { recursive: true })

const states = [
  { state:'hero', label:'01-full-hero' },
  { state:'focus', label:'02-focused-work' },
  { state:'send', label:'03-send-ready' },
  { state:'compact', label:'04-compact' },
]
const viewports = [
  { width:1440, height:900, label:'1440x900' },
  { width:900, height:700, label:'900x700' },
]
const report = { generatedAt:new Date().toISOString(), cssScope:null, renders:[] }

const blueCss = await readFile(resolve(root,'prototype-blue.css'),'utf8')
const stripped = blueCss.replace(/\/\*[\s\S]*?\*\//g,'')
const allowed = new Set(['background','background-image','background-color','color','border-color','border-left-color','box-shadow','stroke'])
const forbiddenDeclarations = []
for (const block of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  for (const declaration of block[2].split(';')) {
    const colon=declaration.indexOf(':'); if(colon<0) continue
    const property=declaration.slice(0,colon).trim()
    if(property&&!property.startsWith('--')&&!allowed.has(property)) forbiddenDeclarations.push({selector:block[1].trim(),property})
  }
}
report.cssScope={allowed:[...allowed],forbiddenDeclarations,pass:forbiddenDeclarations.length===0}

const browser = await chromium.launch({ headless:true, executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' })
const file = resolve(root,'prototype.html').replaceAll('\\','/')
const visible = `(el)=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0}`
const capture = async (page, state, theme, target) => {
  await page.goto(`file:///${file}?state=${state}${theme==='blue'?'&theme=blue':''}`)
  await page.waitForFunction(()=>window.__designReady===true)
  await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))))
  await page.waitForTimeout(120)
  const audit=await page.evaluate((visibleSource)=>{
    const isVisible=eval(visibleSource)
    const selectors=['.workbench-shell','.rail','.sidebar','.main-surface','.plane-head','.canvas-stack','.spatial-viewport','.spatial-world','.composer','.team-dock','.compact-stage','.desktop-ghost','.compact-window']
    const boxes={};for(const selector of selectors){const el=document.querySelector(selector);if(!el||!isVisible(el))continue;const r=el.getBoundingClientRect();boxes[selector]={left:r.left,top:r.top,width:r.width,height:r.height}}
    const structural=[...document.querySelectorAll('body *')].filter(isVisible).map(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return{key:`${el.tagName}.${el.className}`,rect:[r.left,r.top,r.width,r.height].map(v=>Number(v.toFixed(3))),font:[s.fontFamily,s.fontSize,s.fontWeight,s.lineHeight,s.letterSpacing],space:[s.paddingTop,s.paddingRight,s.paddingBottom,s.paddingLeft,s.marginTop,s.marginRight,s.marginBottom,s.marginLeft,s.gap],shape:[s.borderTopLeftRadius,s.borderTopRightRadius,s.borderBottomRightRadius,s.borderBottomLeftRadius],material:[s.backdropFilter,s.filter],overflow:[s.overflowX,s.overflowY]}})
    const issues=[]
    if(document.documentElement.scrollWidth>innerWidth+1||document.documentElement.scrollHeight>innerHeight+1)issues.push({kind:'document-overflow',size:[document.documentElement.scrollWidth,document.documentElement.scrollHeight],viewport:[innerWidth,innerHeight]})
    for(const[selector,r]of Object.entries(boxes))if(r.left<-.75||r.top<-.75||r.left+r.width>innerWidth+.75||r.top+r.height>innerHeight+.75)issues.push({kind:'viewport-escape',selector,rect:r})
    return{boxes,structural,issues}
  },visible)
  await page.screenshot({path:target})
  return audit
}

const grayMetrics = async (baselinePath, bluePath) => {
  const [a,b]=await Promise.all([readFile(baselinePath),readFile(bluePath)])
  const page=await browser.newPage({viewport:{width:320,height:240}})
  const metrics=await page.evaluate(async([a64,b64])=>{
    const load=src=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=src})
    const [a,b]=await Promise.all([load(`data:image/png;base64,${a64}`),load(`data:image/png;base64,${b64}`)])
    const canvas=document.createElement('canvas');canvas.width=a.width;canvas.height=a.height;const ctx=canvas.getContext('2d',{willReadFrequently:true})
    ctx.drawImage(a,0,0);const ad=ctx.getImageData(0,0,a.width,a.height).data;ctx.clearRect(0,0,a.width,a.height);ctx.drawImage(b,0,0);const bd=ctx.getImageData(0,0,b.width,b.height).data
    let sum=0,max=0;const diffs=[]
    for(let i=0;i<ad.length;i+=4){const ga=.2126*ad[i]+.7152*ad[i+1]+.0722*ad[i+2],gb=.2126*bd[i]+.7152*bd[i+1]+.0722*bd[i+2],d=Math.abs(ga-gb);sum+=d;max=Math.max(max,d);diffs.push(d)}
    diffs.sort((x,y)=>x-y);const at=q=>diffs[Math.min(diffs.length-1,Math.floor(diffs.length*q))]
    return{width:a.width,height:a.height,meanAbs:Number((sum/diffs.length).toFixed(3)),p95:Number(at(.95).toFixed(3)),p99:Number(at(.99).toFixed(3)),max:Number(max.toFixed(3))}
  },[a.toString('base64'),b.toString('base64')])
  await page.close();return metrics
}

try {
  for(const viewport of viewports) for(const item of states) {
    const page=await browser.newPage({viewport})
    const baselinePath=resolve(output,`${item.label}-approved-green-${viewport.label}.png`)
    const bluePath=resolve(output,`${item.label}-blue-${viewport.label}.png`)
    const baseline=await capture(page,item.state,'baseline',baselinePath)
    const blue=await capture(page,item.state,'blue',bluePath)
    const geometryDeltas=[]
    for(const[selector,r]of Object.entries(baseline.boxes)){const other=blue.boxes[selector];if(!other){geometryDeltas.push({selector,kind:'missing'});continue}for(const key of['left','top','width','height']){const delta=Math.abs(r[key]-other[key]);if(delta>.01)geometryDeltas.push({selector,key,delta})}}
    const structuralEqual=JSON.stringify(baseline.structural)===JSON.stringify(blue.structural)
    const grayscale=await grayMetrics(baselinePath,bluePath)
    const issues=[...baseline.issues.map(x=>({...x,theme:'baseline'})),...blue.issues.map(x=>({...x,theme:'blue'}))]
    report.renders.push({state:item.state,viewport:viewport.label,baselinePath,bluePath,geometryDeltas,structuralEqual,grayscale,issues,pass:geometryDeltas.length===0&&structuralEqual&&issues.length===0&&grayscale.meanAbs<8})
    await page.close()
  }
} finally { await browser.close() }

await writeFile(resolve(output,'qa-report.json'),`${JSON.stringify(report,null,2)}\n`,'utf8')
console.log(`${report.cssScope.pass?'PASS':'FAIL'} css-color-only forbidden=${report.cssScope.forbiddenDeclarations.length}`)
for(const row of report.renders)console.log(`${row.pass?'PASS':'FAIL'} ${row.state} ${row.viewport} geometry=${row.geometryDeltas.length} structural=${row.structuralEqual} grayMAE=${row.grayscale.meanAbs} p95=${row.grayscale.p95}`)
if(!report.cssScope.pass||report.renders.some(row=>!row.pass))process.exitCode=1
