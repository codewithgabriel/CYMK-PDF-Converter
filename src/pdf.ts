import { invoke, isTauri } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';



export function mountPdf(root: HTMLElement) {
root.innerHTML = `
<div class="pdf-workspace"><section class="heading"><div class="eyebrow">LESS INK. SAME IDEAS.</div><h1>A lighter touch.<br>A better print.</h1><p>Turn your PDFs into print-ready CMYK.<br>Keep the detail. Take control of the ink.</p><div class="swatches"><i></i><i></i><i></i><i></i></div></section>
<div class="editor"><section class="panel source"><div class="section-title"><span class="step">01</span><h2>Your document</h2><span class="tag">PDF</span></div><button id="choose" class="dropzone"><span class="file-icon">↥</span><strong id="filename">Give your PDF a fresh start</strong><span id="filehint">Click to choose a document</span><span class="browse">Browse files <span>↗</span></span></button><div class="source-note"><span>◈</span><p>Processed locally. No uploads, no accounts,<br>just your document and a little less ink.</p></div></section>
<section class="panel settings"><div class="section-title"><span class="step">02</span><h2>Make it print-ready</h2></div><div class="setting-label"><label for="density">Ink density</label><div><output id="amount">80</output><span>%</span></div></div><input id="density" type="range" min="0" max="100" value="80"><div class="range-labels"><span>0% · No ink</span><span>100% · Full color</span></div><div class="presets"><button data-value="50">Economy <span>50%</span></button><button data-value="80" class="selected">Balanced <span>80%</span></button><button data-value="100">Original <span>100%</span></button></div><div class="quality"><div><strong>Original detail preserved</strong><p>Selectable text · Vector graphics · Original image resolution</p></div><span class="tag">CMYK</span></div><div class="density-note"><span>↘</span><p><strong id="reduction">20% lower CMYK channel values</strong><br>Actual ink savings depend on your printer and paper.</p></div></section></div>
<div class="export-bar"><div><strong>Ready for a lighter impression?</strong><p>CMYK output · All pages · Original page sizes</p></div><button id="convert" disabled>Save optimized PDF <span>↗</span></button></div><div id="status" role="status" aria-live="polite"></div><p class="footnote">Text and graphics stay sharp without full-page rasterization. 0% prints blank pages. Save a print copy; forms, tags, links, and digital signatures may change.</p><footer><span>THOUGHTFULLY PRINTED.</span><span>Small changes. Less ink.</span></footer></div>`;
let input: string | null = null;
let busy = false;
const $ = <T extends HTMLElement>(id: string) => root.querySelector(`#${id}`) as T;
const slider = $<HTMLInputElement>('density');
const convert = $<HTMLButtonElement>('convert');
function densityChanged() {
  const value = Number(slider.value);
  $('amount').textContent = String(value);
  $('reduction').textContent = `${100-value}% lower CMYK channel values`;
  slider.style.setProperty('--fill', `${value}%`);
  root.querySelectorAll<HTMLButtonElement>('[data-value]').forEach(b => b.classList.toggle('selected', Number(b.dataset.value) === value));
}
slider.oninput = densityChanged;
root.querySelectorAll<HTMLButtonElement>('[data-value]').forEach(b => b.onclick = () => {slider.value = b.dataset.value!; densityChanged();});
function status(message: string, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
$<HTMLButtonElement>('choose').onclick = async () => {
  if (busy) return;
  if (!isTauri()) { status('Open the Inkwell desktop app to select and convert a PDF. This browser view is an interface preview.'); return; }
  try {
    const path = await open({multiple:false, filters:[{name:'PDF document',extensions:['pdf']}]});
    if (typeof path === 'string') { input=path; $('filename').textContent = path.split(/[\\/]/).pop()!; $('filehint').textContent='Document selected · Click to replace'; convert.disabled=false; status(''); }
  } catch (e) { status(String(e), true); }
};
convert.onclick = async () => {
  if (!input || busy) return;
  try {
    const output = await save({defaultPath:input.replace(/\.pdf$/i,'')+'-inkwell.pdf', filters:[{name:'PDF document',extensions:['pdf']}]});
    if (!output) return;
    busy=true; convert.disabled=true; $<HTMLButtonElement>('choose').disabled=true; slider.disabled=true;
    root.querySelectorAll<HTMLButtonElement>('[data-value]').forEach(b=>b.disabled=true);
    convert.textContent='Optimizing your PDF…';
    status('Preserving text and graphics while adjusting CMYK ink levels. Large documents can take several minutes.');
    const result = await invoke<{pages:number;bytes:number;path:string}>('convert_pdf',{input,output,density:Number(slider.value),dpi:300});
    status(`Saved ${result.pages} page${result.pages===1?'':'s'} · ${(result.bytes/1048576).toFixed(1)} MB · ${result.path}`);
  } catch(e) {status(String(e),true);} finally {
    busy=false; convert.disabled=!input; convert.innerHTML='Save optimized PDF <span>↗</span>'; $<HTMLButtonElement>('choose').disabled=false; slider.disabled=false;
    root.querySelectorAll<HTMLButtonElement>('[data-value]').forEach(b=>b.disabled=false);
  }
};
densityChanged();

}
