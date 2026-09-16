import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

const root = resolve('docs/design-recovery/2026-09-13')
const output = resolve(root, 'shots-transplant')
await mkdir(output, { recursive: true })

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
})
const matrix = [
  { state: 'hero', label: '01-full-hero' },
  { state: 'focus', label: '02-focused-work' },
  { state: 'send', label: '03-send-ready' },
  { state: 'compact', label: '04-compact' },
]
const viewports = [
  { width: 1440, height: 900, label: '1440x900' },
  { width: 900, height: 700, label: '900x700' },
]
const report = []

try {
  for (const viewport of viewports) {
    for (const item of matrix) {
      const window = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } })
      const file = resolve(root, 'prototype.html').replaceAll('\\', '/')
      await window.goto(`file:///${file}?state=${item.state}`)
      await window.waitForFunction(() => window.__designReady === true)
      await window.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      await window.waitForTimeout(250)
      const qa = await window.evaluate(() => {
        const px = 0.75
        const visible = (el) => {
          const s = getComputedStyle(el)
          const r = el.getBoundingClientRect()
          return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0
        }
        const rect = (el) => {
          const r = el.getBoundingClientRect()
          return { name: el.getAttribute('data-qa') || el.className || el.tagName, left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
        }
        const issues = []
        if (document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1) {
          issues.push({ kind: 'document-overflow', width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })
        }
        for (const el of document.querySelectorAll('[data-qa]')) {
          if (!visible(el)) continue
          const r = rect(el)
          if (r.left < -px || r.top < -px || r.right > innerWidth + px || r.bottom > innerHeight + px) issues.push({ kind: 'viewport-escape', rect: r })
        }
        for (const group of document.querySelectorAll('[data-no-overlap-group]')) {
          const children = [...group.children].filter(visible)
          for (let i = 0; i < children.length; i += 1) for (let j = i + 1; j < children.length; j += 1) {
            const a = children[i].getBoundingClientRect(), b = children[j].getBoundingClientRect()
            const overlapW = Math.min(a.right,b.right)-Math.max(a.left,b.left)
            const overlapH = Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)
            if (overlapW > px && overlapH > px) issues.push({ kind:'overlap', group:group.getAttribute('data-no-overlap-group'), a:rect(children[i]), b:rect(children[j]), area:overlapW*overlapH })
          }
        }
        for (const el of document.querySelectorAll('.workbench-shell,.main-surface,.canvas-stack,.spatial-viewport,.team-dock,.compact-window')) {
          if (!visible(el)) continue
          const style = getComputedStyle(el)
          if (style.overflowX !== 'auto' && style.overflowX !== 'scroll' && el.scrollWidth > el.clientWidth + 1) issues.push({ kind:'element-x-overflow', rect:rect(el), scrollWidth:el.scrollWidth, clientWidth:el.clientWidth })
          if (style.overflowY !== 'auto' && style.overflowY !== 'scroll' && el.scrollHeight > el.clientHeight + 1) issues.push({ kind:'element-y-overflow', rect:rect(el), scrollHeight:el.scrollHeight, clientHeight:el.clientHeight })
        }
        return { issues, boxes: [...document.querySelectorAll('[data-qa]')].filter(visible).map(rect) }
      })
      const target = resolve(output, `${item.label}-${viewport.label}.png`)
      await window.screenshot({ path: target })
      report.push({ state: item.state, viewport: viewport.label, screenshot: target, pass: qa.issues.length === 0, ...qa })
      await window.close()
    }
  }
} finally {
  await browser.close()
}

await writeFile(resolve(output, 'qa-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
for (const item of report) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.state} ${item.viewport} issues=${item.issues.length}`)
if (report.some((item) => !item.pass)) process.exitCode = 1
