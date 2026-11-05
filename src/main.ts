import { ImageStudio } from './studio';
import { mountPdf } from './pdf';
import { icon } from './ui';
import './style.css';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<aside class="app-sidebar"><a class="brand" href="#" aria-label="Inkwell home"><span class="brand-symbol">i</span><span>inkwell<span class="brand-dot">.</span></span></a><div class="workspace-label">YOUR WORKSPACE</div><nav aria-label="Workspace tools"><button class="nav-item active" id="nav-studio" aria-label="Image studio" title="Image studio" aria-current="page">${icon('Image', 18)}<span>Image studio</span><span class="new-badge">NEW</span></button><button class="nav-item" id="nav-pdf" aria-label="PDF optimizer" title="PDF optimizer">${icon('Layers', 18)}<span>PDF optimizer</span></button></nav><div class="sidebar-note"><div class="sidebar-drawing">${icon('Leaf', 21)}</div><strong>Good ideas.<br>A lighter footprint.</strong><p>A thoughtful workspace<br>for your documents.</p></div><div class="sidebar-bottom"><button class="settings-nav" id="ai-settings" aria-label="AI settings" title="AI settings">${icon('Settings2', 17)} AI settings</button><div class="connection-state"><span class="connection-dot" id="connection-dot"></span><span id="connection-label">Connect OpenAI</span></div><span class="desktop-label">MADE FOR YOUR DESKTOP</span></div></aside>
<main class="app-main"><header class="app-header"><div class="breadcrumb">WORKSPACE <span>/</span> <strong id="current-tool">IMAGE STUDIO</strong></div><div class="header-detail">${icon('Sparkles', 14)} <span id="header-detail">A new perspective, one image at a time.</span></div></header><div id="studio-view"></div><div id="pdf-view" hidden></div></main><div id="toast" role="status" aria-live="polite" hidden></div>`;

const studioView = document.getElementById('studio-view')!;
const pdfView = document.getElementById('pdf-view')!;
const studio = new ImageStudio(studioView);
mountPdf(pdfView);
studio.onStatus = configured => {
  document.getElementById('connection-dot')!.classList.toggle('connected', configured);
  document.getElementById('connection-label')!.textContent = configured ? 'AI ready' : 'Connect OpenAI';
};
void studio.refreshStatus();
const switchTool = (name: 'studio' | 'pdf') => {
  studioView.hidden = name !== 'studio'; pdfView.hidden = name !== 'pdf';
  for (const tool of ['studio', 'pdf']) {
    const nav = document.getElementById(`nav-${tool}`)!;
    nav.classList.toggle('active', name === tool);
    if (name === tool) nav.setAttribute('aria-current', 'page'); else nav.removeAttribute('aria-current');
  }
  document.getElementById('current-tool')!.textContent = name === 'studio' ? 'IMAGE STUDIO' : 'PDF OPTIMIZER';
  document.getElementById('header-detail')!.textContent = name === 'studio' ? 'A new perspective, one image at a time.' : 'Local processing. A little less ink.';
};
document.getElementById('nav-studio')!.onclick = () => switchTool('studio');
document.getElementById('nav-pdf')!.onclick = () => switchTool('pdf');
document.querySelector<HTMLAnchorElement>('.brand')!.onclick = event => { event.preventDefault(); switchTool('studio'); };
document.getElementById('ai-settings')!.onclick = () => void studio.settings();
window.addEventListener('beforeunload', event => {
  if (studio.hasUnsavedWork()) { event.preventDefault(); event.returnValue = ''; }
});
