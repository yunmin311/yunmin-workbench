const params = new URLSearchParams(location.search)
const state = params.get('state') || 'hero'
const theme = params.get('theme')

const icon = (name) => ({
  grid: '<svg viewBox="0 0 20 20"><rect x="3" y="3" width="5" height="5" rx="1"/><rect x="12" y="3" width="5" height="5" rx="1"/><rect x="3" y="12" width="5" height="5" rx="1"/><rect x="12" y="12" width="5" height="5" rx="1"/></svg>',
  focus: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="3"/><path d="M10 2v3M10 15v3M2 10h3M15 10h3"/></svg>',
  search: '<svg viewBox="0 0 20 20"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg>',
  send: '<svg viewBox="0 0 20 20"><path d="m3 10 14-7-5 14-2-5-7-2Z"/><path d="m10 12 7-9"/></svg>',
  check: '<svg viewBox="0 0 20 20"><path d="m4 10 4 4 8-9"/></svg>',
  user: '<svg viewBox="0 0 20 20"><circle cx="10" cy="7" r="3"/><path d="M4 17c.5-3.2 2.5-5 6-5s5.5 1.8 6 5"/></svg>',
}[name] || '')

const rail = () => `
  <aside class="rail" data-qa="rail">
    <div class="brand-mark">Y</div>
    <nav class="rail-icons" data-no-overlap-group="rail-icons">
      <button class="rail-button active" aria-label="Work">${icon('grid')}</button>
      <button class="rail-button" aria-label="Focus">${icon('focus')}</button>
      <button class="rail-button" aria-label="Search">${icon('search')}</button>
    </nav>
    <button class="avatar" aria-label="Profile">LQ</button>
  </aside>`

const sidebar = () => `
  <aside class="sidebar" data-qa="sidebar" data-qa-container>
    <header class="side-head"><span class="eyebrow">YUNMIN / WORKBENCH</span><button class="icon-button">⌘</button></header>
    <section class="current-work">
      <span class="section-label">CURRENT WORK</span>
      <h2>Workbench design recovery</h2>
      <p>Creative OS · W-024</p>
      <div class="phase-track" aria-label="Product path">
        <span class="done"></span><span class="done"></span><span class="active"></span><span></span><span></span><span></span><span></span>
      </div>
      <div class="phase-copy"><b>Task</b><span>Context → Prepare → Send</span></div>
    </section>
    <nav class="work-nav" data-no-overlap-group="work-nav">
      <button class="nav-row selected"><i>01</i><span><b>Recover composition</b><small>3 tasks · active</small></span><em>7</em></button>
      <button class="nav-row"><i>02</i><span><b>Verify donor fidelity</b><small>2 tasks · queued</small></span></button>
      <button class="nav-row"><i>03</i><span><b>Reconnect renderer</b><small>blocked by review</small></span><strong>•</strong></button>
    </nav>
    <footer class="side-foot"><span><i class="presence live"></i> Projection current</span><small>REAL · 14:32</small></footer>
  </aside>`

const sessionRow = (status, label, meta, badge = '') => `
  <button class="session-row">
    <span class="session-status ${status}"></span>
    <span class="session-main"><b>${label}</b><small>${meta}</small></span>
    ${badge ? `<em>${badge}</em>` : ''}
  </button>`

const teamDock = (mode) => `
  <aside class="team-dock" data-qa="team-dock" data-qa-container>
    <header class="dock-head">
      <div><span class="section-label">TEAM / RUNTIME</span><h3>${mode === 'focus' ? 'Task detail' : mode === 'send' ? 'Send review' : '4 sessions'}</h3></div>
      <button class="icon-button">···</button>
    </header>
    ${mode === 'focus' ? focusDetail() : mode === 'send' ? sendReview() : `
      <div class="dock-scroll" data-no-overlap-group="session-groups">
        <section class="session-group"><label>NEEDS YOU <em>1</em></label>${sessionRow('attention','OpenCode · UI rebuild','Approval requested · now','1')}</section>
        <section class="session-group"><label>WORKING <em>2</em></label>
          ${sessionRow('working','Codex · donor audit','Reading Reasonix · 02:18','')}
          ${sessionRow('working','Claude · visual QA','Inspecting 900 × 700 · 00:42','')}
        </section>
        <section class="session-group"><label>RECENT</label>${sessionRow('idle','DSH · source trace','Done · 12 min ago','')}</section>
      </div>
      <footer class="dock-foot"><span><i class="presence live"></i> 2 working</span><span>1 needs you</span></footer>`}
  </aside>`

const focusDetail = () => `
  <nav class="dock-tabs"><button class="active">Context</button><button>Activity</button><button>Evidence</button></nav>
  <div class="dock-scroll detail-scroll">
    <section class="detail-block"><label>TASK</label><h4>Recompose the Work plane</h4><p>Replace graph/debug framing with a bounded spatial workspace.</p></section>
    <section class="detail-block"><label>STAGED CONTEXT · 3</label>
      <div class="context-file"><i>DOC</i><span><b>Design Intent</b><small>§ Spatial workspace</small></span><em>USED</em></div>
      <div class="context-file"><i>TSX</i><span><b>WorkGraphCanvas</b><small>Current renderer</small></span><em>USED</em></div>
      <div class="context-file"><i>REF</i><span><b>dsh-synapse</b><small>camera + selection</small></span><em>USED</em></div>
    </section>
    <section class="detail-block"><label>AVAILABLE · 4</label><button class="quiet-row">Legacy baseline <span>Stage</span></button><button class="quiet-row">GitHub screenshots <span>Stage</span></button></section>
  </div>`

const sendReview = () => `
  <nav class="dock-tabs"><button class="active">Preflight</button><button>Packet</button><button>Evidence</button></nav>
  <div class="dock-scroll detail-scroll">
    <section class="readiness"><span class="ready-ring">3/3</span><div><label>READY TO SEND</label><h4>Visual rebuild brief</h4></div></section>
    <section class="check-list" data-no-overlap-group="checks">
      <div>${icon('check')}<span><b>Task scoped</b><small>Design surface only</small></span></div>
      <div>${icon('check')}<span><b>Context staged</b><small>3 sources · 2.8 MB</small></span></div>
      <div>${icon('check')}<span><b>Target resolved</b><small>OpenCode · local</small></span></div>
    </section>
    <section class="detail-block"><label>PROVENANCE</label><p class="mono">creative-os/W-024<br/>task/T-118<br/>packet/frozen-7f3a</p></section>
    <section class="detail-block warning"><label>WRITE SCOPE</label><p>Static isolated route only. Production renderer and core remain untouched.</p></section>
  </div>`

const planeHeader = (title, kicker, step) => `
  <header class="plane-head" data-qa="plane-head">
    <div class="crumb"><span>Creative OS</span><i>/</i><span>Design recovery</span><i>/</i><b>${kicker}</b></div>
    <div class="plane-title"><div><span class="section-label">${step}</span><h1>${title}</h1></div><div class="view-tools"><button>${icon('focus')} Focus</button><button>−</button><span>86%</span><button>+</button></div></div>
  </header>`

const spatialCanvas = (mode) => `
  <section class="spatial-viewport" data-qa="spatial-viewport" data-qa-container>
    <div class="spatial-world">
      <svg class="relations" viewBox="0 0 900 510" preserveAspectRatio="none" aria-hidden="true">
        <path d="M235 256 C320 256 318 142 405 142"/><path d="M235 256 C330 256 332 296 430 296"/><path d="M566 142 C640 142 640 225 710 225"/>
      </svg>
      <article class="work-object brief-object" data-object="brief">
        <span class="object-index">WORK / 024</span><h3>Design recovery</h3><p>Restore the intended workspace and action model through donor code.</p><footer><span>3 tasks</span><span>1 blocked</span></footer>
      </article>
      <article class="work-object task-object primary ${mode === 'focus' ? 'selected' : ''}" data-object="primary">
        <header><span class="state-dot active"></span><small>IN FOCUS</small><em>T-118</em></header><h3>Recompose the Work plane</h3><p>Bounded space, truthful relations, docked context.</p><div class="object-progress"><span style="width:68%"></span></div><footer><span>3 context</span><span>OpenCode</span></footer>
      </article>
      <article class="work-object task-object secondary" data-object="secondary">
        <header><span class="state-dot queued"></span><small>NEXT</small><em>T-119</em></header><h3>Verify donor fidelity</h3><p>Compare DOM, behavior and geometry.</p><footer><span>2 context</span><span>Codex</span></footer>
      </article>
      <article class="work-object milestone" data-object="milestone"><span class="object-index">REVIEW GATE</span><h3>Four surfaces accepted</h3><p>Production reconnect stays locked.</p></article>
      <div class="plane-note"><i></i><span>Spatial relations reflect the product path.<br/>They do not infer execution lineage.</span></div>
    </div>
  </section>`

const contextShelf = () => `<div class="context-shelf"><span class="context-chip"><i>DOC</i> Design Intent <button>×</button></span><span class="context-chip"><i>REF</i> dsh-synapse <button>×</button></span><span class="context-chip"><i>TSX</i> Canvas <button>×</button></span></div>`

const composer = (mode) => {
  if (mode === 'send') return `
    <section class="composer send-composer" data-qa="composer" data-qa-container>
      <div class="review-copy"><span class="section-label">SEND-READY · OPENCode</span><p>Rebuild four isolated surfaces from the donor map. Preserve semantic, staging, Packet and IPC layers.</p></div>
      ${contextShelf()}
      <footer class="composer-actions"><span><b>3</b> sources · <b>1</b> target</span><button class="secondary-button">Back to edit</button><button class="send-button">${icon('send')} Send packet</button></footer>
    </section>`
  return `
    <section class="composer" data-qa="composer" data-qa-container>
      <button class="resize-handle" aria-label="Resize composer"></button>
      ${mode === 'focus' ? contextShelf() : ''}
      <div class="composer-input"><textarea readonly>${mode === 'focus' ? 'Prepare a donor-faithful rebuild for the selected task…' : 'Ask the team or prepare this Work…'}</textarea><button class="send-button">${icon('send')}</button></div>
      <footer class="composer-meta"><span>＋ Context</span><span>/ commands</span><em>OpenCode · local</em></footer>
    </section>`
}

const mainSurface = (mode) => {
  const meta = mode === 'hero' ? ['Design recovery','Work plane','WORK / ACTIVE'] : mode === 'focus' ? ['Recompose the Work plane','Task focus','TASK / CONTEXT'] : ['Visual rebuild brief','Prepare & send','SEND / READY']
  return `<main class="main-surface" data-qa="main-surface" data-qa-container>${planeHeader(meta[0],meta[1],meta[2])}<div class="canvas-stack">${spatialCanvas(mode)}${composer(mode)}</div></main>`
}

const compact = () => `
  <div class="compact-stage" data-qa="compact-stage" data-qa-container>
    <div class="desktop-ghost"><span>YUNMIN WORKBENCH</span><h1>Edge presence,<br/>not a mini dashboard.</h1><p>The Compact surface keeps one Work, one attention signal, one runtime and one next action in reach.</p></div>
    <aside class="compact-window" data-qa="compact-window" data-qa-container>
      <header class="compact-head"><span class="brand-mark small">Y</span><div><label>CURRENT WORK</label><b>Design recovery</b></div><button>↗</button></header>
      <section class="compact-task"><span class="section-label">TASK · T-118</span><h2>Recompose the Work plane</h2><div class="compact-progress"><span style="width:68%"></span></div><p><b>68%</b><span>Context staged · 3</span></p></section>
      <section class="attention-strip"><i class="presence attention"></i><div><label>NEEDS YOU</label><b>OpenCode requests approval</b></div><button>Review</button></section>
      <section class="runtime-strip"><div class="runtime-avatars"><i>OC</i><i>CD</i><i>CL</i></div><span><b>2 working</b><small>1 checking visual QA</small></span><em>LIVE</em></section>
      <footer class="compact-actions"><button class="secondary-button">Open Work</button><button class="send-button">Prepare →</button></footer>
    </aside>
  </div>`

document.body.dataset.state = state
if (theme === 'blue') document.body.dataset.theme = 'blue'
document.querySelector('#app').innerHTML = state === 'compact'
  ? compact()
  : `<div class="workbench-shell" data-qa="shell" data-qa-container>${rail()}${sidebar()}${mainSurface(state)}${teamDock(state)}</div>`

window.__designReady = true
