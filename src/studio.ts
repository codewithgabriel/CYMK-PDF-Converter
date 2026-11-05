import { invoke, isTauri } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { DocumentPreview } from './preview';
import { askDiscard, base64Bytes, bytesLabel, escape, icon, toast } from './ui';
import type { GeneratedImage, ImageWork, OpenedDocument, Picture, StudioStatus } from './types';

export class ImageStudio {
  private document: OpenedDocument | null = null;
  private work = new Map<string, ImageWork>();
  private sourceUrls = new Map<string, string>();
  private selected: string | null = null;
  private preview: DocumentPreview | null = null;
  private generating: string | null = null;
  private opening = false;
  private exporting = false;
  private savedSignature = '';
  private started = 0;
  private clock = 0;
  private status: StudioStatus = { configured: false, model: 'gpt-image-2.5-sunburst', largeOutput: true };
  onStatus: (configured: boolean) => void = () => {};

  constructor(private root: HTMLElement) {
    this.renderEmpty();
    this.root.addEventListener('click', event => {
      const button = (event.target as Element).closest<HTMLElement>('[data-action]');
      if (button && !(button instanceof HTMLButtonElement && button.disabled)) void this.action(button.dataset.action!, button.dataset.id);
    });
    window.addEventListener('keydown', event => {
      if (this.root.hidden) return;
      if ((event.ctrlKey || event.metaKey) && event.key === 'o') { event.preventDefault(); void this.chooseDocument(); }
      if ((event.ctrlKey || event.metaKey) && event.key === 's') { event.preventDefault(); void this.exportDocument(); }
    });
  }

  async refreshStatus() {
    if (isTauri()) {
      try { this.status = await invoke<StudioStatus>('studio_status'); }
      catch { toast('Could not read AI settings. Restart the desktop app.', true); }
    }
    this.onStatus(this.status.configured);
  }

  private renderEmpty() {
    this.root.innerHTML = `<div class="studio-welcome">
      <div class="welcome-title"><span class="eyebrow"><span class="tiny-spark">${icon('Sparkles', 13)}</span> A LITTLE IMAGINATION. A LOT MORE DETAIL.</span><h1>Your ideas.<br><em>Beautifully realised.</em></h1><p>Give the images in your Word documents a new perspective.<br>From a rough mockup to something remarkably real.</p></div>
      <div class="welcome-grid"><button class="document-drop" data-action="open"><span class="upload-symbol">${icon('FileText', 30)}<b>${icon('Plus', 13)}</b></span><strong>Start with your document</strong><span>Open a DOCX with images you’d like to reimagine.</span><span class="button primary">${icon('FolderOpen', 16)} Open Word document ${icon('ArrowUpRight', 16)}</span><small>.DOCX · Up to 80 MB · Original stays intact</small></button>
      <div class="possibility-card" aria-label="An illustration of the image enhancement workflow"><div class="sample-paper"><span class="sample-kicker">THE EVERYDAY, REIMAGINED</span><div class="sample-title">A place to<br>slow down.</div><div class="sample-art"><div class="arch-window"></div><div class="sun-glow"></div><div class="vase"><i></i><i></i><i></i><i></i></div><div class="table-top"></div><div class="plant-pot"></div></div><div class="sample-line long"></div><div class="sample-line"></div><div class="sample-line short"></div><span class="sample-page">01 / A STUDY IN NATURAL LIGHT</span></div><div class="floating-prompt">${icon('MessageSquarePlus', 18)} <span>“Make it feel like a real photograph.”</span></div><div class="floating-quality">${icon('Sparkles', 15)} A fresh perspective</div><span class="illustration-label">WORKFLOW ILLUSTRATION</span></div></div>
      <div class="workflow-steps"><div><span>01</span><h3>Find your image</h3><p>Your document opens in a familiar page view.</p></div><div><span>02</span><h3>Add your direction. Or don’t.</h3><p>Write a prompt or let the image and text guide it.</p></div><div><span>03</span><h3>Review. Refine. Make it yours.</h3><p>Accept the images you love and export a new DOCX.</p></div></div>
      <div class="welcome-note">${icon('ShieldCheck', 16)} <span>You stay in control. Only selected images and optional nearby text are sent to OpenAI when you generate.</span></div>
    </div>`;
  }

  private requireDesktop() {
    if (isTauri()) return true;
    toast('This is the interface preview. Run “npm run tauri dev” to open documents and generate images in the desktop app.');
    return false;
  }

  async chooseDocument() {
    if (!this.requireDesktop() || this.opening || this.generating || this.exporting) return;
    if (this.document && (this.isDirty() || [...this.work.values()].some(w => w.drafts.length))) {
      if (!await askDiscard('Your current preview and image drafts will close. Export the document first if you want to keep accepted replacements.')) return;
    }
    let loading: HTMLElement | null = null;
    try {
      const path = await open({ multiple: false, filters: [{ name: 'Word document', extensions: ['docx'] }] });
      if (typeof path !== 'string') return;
      this.opening = true;
      this.root.classList.add('is-loading');
      loading = document.createElement('div');
      loading.className = 'studio-loading'; loading.setAttribute('role', 'status');
      loading.innerHTML = `<div>${icon('LoaderCircle', 28)}<h2>Opening your document</h2><p>Preparing the pages and finding embedded images.<br>Larger documents can take a little longer.</p></div>`;
      document.body.append(loading);
      this.setMessage('Opening your document and finding its images…');
      const doc = await invoke<OpenedDocument>('studio_open', { path });
      this.document = doc; this.work.clear(); this.savedSignature = ''; this.selected = doc.images[0]?.id ?? null;
      this.sourceUrls.forEach(URL.revokeObjectURL); this.sourceUrls.clear();
      doc.images.filter(p => p.supported).forEach(p => {
        const [prefix, encoded] = p.dataUrl.split(',');
        this.sourceUrls.set(p.id, URL.createObjectURL(new Blob([base64Bytes(encoded)], { type: prefix.slice(5).split(';')[0] })));
      });
      doc.images.forEach(p => this.work.set(p.id, { prompt: '', style: 'realistic', useContext: true, quality: 'high', resolution: 'standard', drafts: [], currentDraft: null, accepted: null }));
      this.preview?.destroy();
      this.renderWorkspace();
      this.preview = new DocumentPreview(this.element('document-preview'));
      this.preview.onSelect = id => { this.select(id); this.element<HTMLTextAreaElement>('image-prompt')?.focus(); };
      this.preview.onZoom = value => { this.element('zoom-value').textContent = `${value}%`; };
      try {
        await this.preview.render(doc);
        this.element('page-count').textContent = `${this.preview.pageCount} ${this.preview.pageCount === 1 ? 'page' : 'pages'}`;
        if (this.selected) this.preview.select(this.selected);
        this.setMessage(doc.warnings.join(' ') || 'Select an image or its comment icon to begin. Nothing is generated automatically.');
      } catch {
        this.element('page-count').textContent = 'Preview unavailable';
        this.element('document-preview').classList.add('preview-failed');
        this.setMessage('This document’s layout could not be previewed. You can still select detected images in the left panel and export replacements.', true);
      }
      if (!doc.images.length) this.setMessage('No embedded images were detected. Word shapes, charts and externally linked images may need to be saved as embedded pictures first.');
    } catch (error) { this.setMessage(String(error), true); toast(String(error), true); }
    finally { loading?.remove(); this.opening = false; this.root.classList.remove('is-loading'); this.updateToolbar(); }
  }

  private renderWorkspace() {
    const doc = this.document!;
    this.root.innerHTML = `<div class="document-workspace"><div class="document-toolbar"><div class="document-title"><span class="doc-badge">${icon('FileText', 21)}</span><div><h2 title="${escape(doc.name)}">${escape(doc.name)}</h2><p>${bytesLabel(doc.bytes)} <span>·</span> <span id="page-count">Loading pages</span> <span>·</span> <span id="save-state">Original document</span></p></div></div><div class="toolbar-actions"><button class="button secondary compact" data-action="open" id="open-another">${icon('FolderOpen', 16)}<span>Open</span></button><button class="button primary compact" data-action="export" id="export-docx">${icon('ArrowDownToLine', 16)} Export DOCX</button></div></div>
      <div class="document-body"><section class="image-library"><div class="library-heading"><h3>IMAGES</h3><span>${doc.images.length.toString().padStart(2, '0')}</span></div><div id="image-list"></div><p class="library-note">${icon('MessageSquarePlus', 15)} Select a picture to give it a new perspective.</p></section>
      <section class="page-workspace" aria-label="Document preview"><div class="preview-toolbar"><span>${icon('Eye', 14)} Document preview</span><div><button class="icon-button" data-action="zoom-out" aria-label="Zoom out">${icon('Minus', 14)}</button><button class="zoom-value" id="zoom-value" data-action="fit" title="Fit page to width">Fit</button><button class="icon-button" data-action="zoom-in" aria-label="Zoom in">${icon('Plus', 14)}</button><span class="toolbar-divider"></span><button class="icon-button" data-action="fit" aria-label="Fit page to width">${icon('Scan', 15)}</button></div></div><div class="page-scroll"><div id="document-preview"></div></div><div class="preview-footnote">Page layout may vary slightly from Word. Export preserves the document’s existing layout settings.</div></section>
      <section class="image-inspector" id="image-inspector" aria-label="Image editing controls"></section></div>
      <div class="studio-statusbar"><span id="studio-message" role="status" aria-live="polite"></span><span class="session-note">${icon('ShieldCheck', 13)} Original protected</span></div></div>`;
    this.renderLibrary(); this.renderInspector(); this.updateToolbar();
  }

  private renderLibrary() {
    if (!this.document) return;
    this.element('image-list').innerHTML = this.document.images.map(p => {
      const work = this.work.get(p.id)!;
      const accepted = work.drafts.find(d => d.id === work.accepted);
      return `<button class="image-tile ${this.selected === p.id ? 'selected' : ''}" data-action="select" data-id="${p.id}" aria-pressed="${this.selected === p.id}"><span class="image-tile-preview">${p.supported ? `<img src="${accepted?.dataUrl ?? this.sourceUrls.get(p.id)}" alt="${escape(p.alt || p.label)}">` : icon('Image', 24)}${work.accepted ? `<span class="tile-state">${icon('Check', 11)}</span>` : work.drafts.length ? '<span class="draft-dot" title="Draft available"></span>' : ''}${this.generating === p.id ? `<span class="tile-generating">${icon('LoaderCircle', 19)}</span>` : ''}</span><span class="tile-caption"><strong>${p.label}</strong><small>${work.accepted ? 'Accepted' : !p.supported ? 'Not editable' : `${p.width} × ${p.height}`}</small></span></button>`;
    }).join('') || '<p class="empty-library">No embedded images</p>';
  }

  private renderInspector() {
    const panel = this.element('image-inspector');
    const picture = this.picture();
    if (!picture) { panel.innerHTML = `<div class="inspector-empty">${icon('ImagePlus', 36)}<h3>A new perspective starts here.</h3><p>Select an embedded image to view its editing controls.</p></div>`; return; }
    const work = this.work.get(picture.id)!;
    const draft = work.drafts.find(d => d.id === work.currentDraft);
    panel.innerHTML = `<div class="inspector-heading"><div><span class="eyebrow">IMAGE STUDIO</span><h2>${picture.label} <span>${work.accepted ? 'Accepted' : draft ? 'Draft ready' : 'Original'}</span></h2></div><span class="inspector-spark">${icon('Sparkles', 20)}</span></div>
      <div class="inspector-scroll"><div class="source-image"><img src="${draft?.dataUrl || this.sourceUrls.get(picture.id) || ''}" alt="${draft ? 'Generated draft' : escape(picture.alt || picture.label)}" ${picture.supported ? '' : 'hidden'}><span class="image-caption">${draft ? 'GENERATED DRAFT' : 'REFERENCE IMAGE'}</span>${draft ? `<button class="image-expand" data-action="compare" aria-label="Compare original and generated image">${icon('ArrowLeftRight', 16)}</button>` : ''}</div>
      <div class="image-meta"><span>${draft ? `${draft.width} × ${draft.height}` : `${picture.width} × ${picture.height}`} px</span><span>${draft ? 'PNG · High resolution' : picture.part.includes('header') ? 'Document header' : picture.part.includes('footer') ? 'Document footer' : 'Embedded in document'}</span></div>
      ${draft ? `<div class="draft-review"><div class="draft-nav"><span>Draft ${work.drafts.indexOf(draft) + 1} of ${work.drafts.length}</span><div><button class="icon-button" data-action="previous-draft" aria-label="Previous draft" ${work.drafts.indexOf(draft) === 0 ? 'disabled' : ''}>${icon('ChevronLeft', 15)}</button><button class="icon-button" data-action="next-draft" aria-label="Next draft" ${work.drafts.indexOf(draft) === work.drafts.length - 1 ? 'disabled' : ''}>${icon('ChevronRight', 15)}</button></div></div><button class="button ${work.accepted === draft.id ? 'accepted-button' : 'primary'}" data-action="accept" ${work.accepted === draft.id ? 'disabled' : ''}>${icon('Check', 16)} ${work.accepted === draft.id ? 'Applied to document' : 'Use this image'}</button><button class="text-button" data-action="compare">${icon('ArrowLeftRight', 14)} Compare with original</button></div>` : ''}
      ${!picture.supported ? `<p class="inline-error">${escape(picture.reason || 'This image format is not supported.')}</p>` : ''}
      <div class="inspector-section"><div class="field-heading"><label>Creative direction</label><span>01</span></div><div class="style-options" role="group" aria-label="Image style"><button data-action="style-realistic" aria-pressed="${work.style === 'realistic'}" class="${work.style === 'realistic' ? 'selected' : ''}">${icon('Image', 16)}<span>Realistic</span></button><button data-action="style-enhance" aria-pressed="${work.style === 'enhance'}" class="${work.style === 'enhance' ? 'selected' : ''}">${icon('Scan', 16)}<span>Refine</span></button><button data-action="style-illustration" aria-pressed="${work.style === 'illustration'}" class="${work.style === 'illustration' ? 'selected' : ''}">${icon('WandSparkles', 16)}<span>Illustrate</span></button></div></div>
      <div class="inspector-section"><div class="field-heading"><label for="image-prompt">Your instructions <span class="optional">Optional</span></label><span>02</span></div><textarea id="image-prompt" maxlength="4000" rows="4" placeholder="E.g. Make this look like a real photograph, with warm natural light and realistic textures…">${escape(work.prompt)}</textarea><div class="prompt-hint"><span>${icon('Sparkles', 12)} Leave blank to let the reference guide it.</span><span id="prompt-count">${work.prompt.length}/4000</span></div></div>
      <div class="context-control"><label class="switch-row" for="use-context"><span>${icon('FileText', 16)}<span>Use document context<small>Help the image fit your story</small></span></span><input type="checkbox" role="switch" id="use-context" ${work.useContext ? 'checked' : ''}></label><details class="context-details"><summary>Nearby text ${icon('ChevronDown', 12)}</summary><p>${escape(picture.context || picture.alt || 'No nearby text was found. The source image will guide generation.')}</p></details></div>
      <div class="inspector-section output-settings"><div class="field-heading"><label>Finishing touches</label><span>03</span></div><div class="select-row"><label for="image-quality">Quality<select id="image-quality"><option value="high" ${work.quality === 'high' ? 'selected' : ''}>High detail</option><option value="medium" ${work.quality === 'medium' ? 'selected' : ''}>Standard</option></select></label><label for="image-resolution">Resolution<select id="image-resolution"><option value="standard" ${work.resolution === 'standard' ? 'selected' : ''}>${this.status.largeOutput ? '1.5K' : 'Up to 1536 px'}</option>${this.status.largeOutput ? `<option value="large" ${work.resolution === 'large' ? 'selected' : ''}>2.5K · Experimental</option>` : ''}</select></label></div><p class="small-note">${this.status.largeOutput ? 'Long edge: 1536 or 2560 px. ' : ''}Larger images and higher detail can cost more.</p></div>
      ${work.accepted ? `<button class="restore-button" data-action="restore">${icon('RotateCcw', 14)} Restore original in document</button>` : ''}
      </div><div class="generation-footer"><div id="generation-progress" class="generation-progress" ${this.generating === picture.id ? '' : 'hidden'}>${icon('LoaderCircle', 15)}<span>Creating your image… <b id="elapsed">0:00</b></span></div><button class="button primary generate-button" data-action="generate" id="generate-image" ${this.generating || !picture.supported ? 'disabled' : ''}>${icon(this.generating === picture.id ? 'LoaderCircle' : 'Sparkles', 17)} ${this.generating === picture.id ? 'Generating…' : draft ? 'Generate another draft' : 'Generate image'}</button><p>Only runs when you click. Sends this image${work.useContext ? ' and nearby text' : ''} to OpenAI. API charges apply.</p></div>`;
    this.element<HTMLTextAreaElement>('image-prompt').oninput = event => {
      work.prompt = (event.target as HTMLTextAreaElement).value;
      this.element('prompt-count').textContent = `${work.prompt.length}/4000`;
    };
    this.element<HTMLInputElement>('use-context').onchange = event => { work.useContext = (event.target as HTMLInputElement).checked; this.renderInspector(); };
    this.element<HTMLSelectElement>('image-quality').onchange = event => { work.quality = (event.target as HTMLSelectElement).value; };
    this.element<HTMLSelectElement>('image-resolution').onchange = event => { work.resolution = (event.target as HTMLSelectElement).value; };
  }

  private picture() { return this.document?.images.find(p => p.id === this.selected); }
  private element<T extends HTMLElement = HTMLElement>(id: string) { return this.root.querySelector<T>(`#${id}`)!; }
  private signature() { return JSON.stringify([...this.work].filter(([,w]) => w.accepted).map(([id,w]) => [id,w.accepted])); }
  private isDirty() { return this.signature() !== (this.savedSignature || '[]'); }
  hasUnsavedWork() { return this.isDirty(); }
  private select(id: string, scroll = false) {
    this.selected = id; this.renderLibrary(); this.renderInspector(); this.preview?.select(id, scroll);
  }
  private setMessage(message: string, error = false) {
    const target = this.element('studio-message');
    if (target) { target.textContent = message; target.classList.toggle('error', error); }
    else if (error) toast(message, true);
  }

  private updateToolbar() {
    const count = [...this.work.values()].filter(w => w.accepted).length;
    const exportButton = this.element<HTMLButtonElement>('export-docx');
    if (exportButton) {
      exportButton.disabled = !!this.generating || this.exporting || this.opening;
      exportButton.innerHTML = `${icon(this.exporting ? 'LoaderCircle' : 'ArrowDownToLine', 16)} ${this.exporting ? 'Exporting…' : 'Export DOCX'}${count ? `<span class="export-count">${count}</span>` : ''}`;
      this.element<HTMLButtonElement>('open-another').disabled = !!this.generating || this.exporting || this.opening;
      this.element('save-state').textContent = this.isDirty() ? `${count} ${count === 1 ? 'replacement' : 'replacements'} · Unsaved` : this.savedSignature ? 'Exported' : 'Original document';
    }
  }

  private async generate() {
    const picture = this.picture();
    if (!picture || !this.document || this.generating || !picture.supported) return;
    if (!this.status.configured) { await this.settings(); return; }
    const work = this.work.get(picture.id)!;
    const request = { sessionId: this.document.sessionId, imageId: picture.id, prompt: work.prompt.trim(), useContext: work.useContext, style: work.style, quality: work.quality, resolution: work.resolution };
    this.generating = picture.id; this.started = Date.now(); this.renderInspector(); this.renderLibrary(); this.updateToolbar();
    this.setMessage(`Generating ${picture.label.toLowerCase()}. High-detail images can take several minutes. You can browse other images while you wait.`);
    this.clock = window.setInterval(() => {
      const elapsed = this.element('elapsed');
      const seconds = Math.floor((Date.now() - this.started) / 1000);
      if (elapsed) elapsed.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2,'0')}`;
    }, 1000);
    try {
      const result = await invoke<GeneratedImage>('studio_generate', { request });
      work.drafts.push(result); work.currentDraft = result.id;
      this.setMessage(`${picture.label}: your draft is ready. Compare it with the original, then choose “Use this image” to apply it.`);
      toast(`${picture.label} is ready to review.`);
    } catch (error) { this.setMessage(String(error), true); toast(String(error), true); }
    finally { clearInterval(this.clock); this.generating = null; this.renderInspector(); this.renderLibrary(); this.updateToolbar(); }
  }

  async exportDocument() {
    if (!this.document || this.generating || this.exporting || this.opening) return;
    try {
      const output = await save({ defaultPath: this.document.path.replace(/\.docx$/i, '') + '-inkwell.docx', filters: [{ name: 'Word document', extensions: ['docx'] }] });
      if (!output) return;
      this.exporting = true; this.updateToolbar();
      const signature = this.signature();
      const accepted = [...this.work].filter(([,w]) => w.accepted).map(([imageId,w]) => ({ imageId, candidateId: w.accepted! }));
      const result = await invoke<{ path: string; bytes: number; replacements: number }>('studio_export', { sessionId: this.document.sessionId, output, accepted });
      this.savedSignature = signature;
      this.setMessage(`Saved ${result.replacements} accepted ${result.replacements === 1 ? 'replacement' : 'replacements'} · ${bytesLabel(result.bytes)} · ${result.path}`);
      toast('Your Word document has been exported.');
    } catch (error) { this.setMessage(String(error), true); toast(String(error), true); }
    finally { this.exporting = false; this.updateToolbar(); }
  }

  private compare() {
    const picture = this.picture();
    if (!picture) return;
    const work = this.work.get(picture.id)!;
    const draft = work.drafts.find(d => d.id === work.currentDraft);
    if (!draft) return;
    const dialog = document.createElement('dialog');
    dialog.className = 'modal compare-modal';
    dialog.innerHTML = `<div class="compare-heading"><div><span class="eyebrow">A CLOSER LOOK</span><h2>${picture.label} <span>Before & after</span></h2></div><button class="icon-button" data-close aria-label="Close comparison">${icon('X', 20)}</button></div><div class="compare-stage"><img src="${this.sourceUrls.get(picture.id)}" alt="Original image"><div class="compare-after"><img src="${draft.dataUrl}" alt="Generated image"></div><span class="compare-label before">ORIGINAL</span><span class="compare-label after">GENERATED</span><div class="compare-line"><span>${icon('ArrowLeftRight', 20)}</span></div></div><div class="compare-controls"><label for="compare-slider">Slide to compare</label><input type="range" id="compare-slider" min="0" max="100" value="50"><span>${draft.width} × ${draft.height} px</span></div><div class="compare-bottom"><p>Check fine details and any text before accepting.</p><button class="button primary" data-accept ${work.accepted === draft.id ? 'disabled' : ''}>${icon('Check', 16)} ${work.accepted === draft.id ? 'Already applied' : 'Use this image'}</button></div>`;
    document.body.append(dialog);
    const close = () => { dialog.close(); dialog.remove(); };
    dialog.querySelector('[data-close]')!.addEventListener('click', close);
    dialog.oncancel = event => { event.preventDefault(); close(); };
    dialog.querySelector<HTMLInputElement>('#compare-slider')!.oninput = event => {
      const value = (event.target as HTMLInputElement).value;
      dialog.querySelector<HTMLElement>('.compare-after')!.style.clipPath = `inset(0 0 0 ${value}%)`;
      dialog.querySelector<HTMLElement>('.compare-line')!.style.left = `${value}%`;
    };
    dialog.querySelector('[data-accept]')!.addEventListener('click', () => { this.accept(); close(); });
    dialog.showModal();
  }

  private accept() {
    const picture = this.picture(); if (!picture) return;
    const work = this.work.get(picture.id)!;
    const draft = work.drafts.find(d => d.id === work.currentDraft); if (!draft) return;
    work.accepted = draft.id; this.preview?.replace(picture.id, draft);
    this.renderLibrary(); this.renderInspector(); this.updateToolbar();
    this.setMessage(`${picture.label} updated in the preview. Export DOCX to save your accepted images.`);
  }

  async settings() {
    if (!this.requireDesktop()) return;
    const dialog = document.createElement('dialog'); dialog.className = 'modal settings-modal';
    dialog.innerHTML = `<div class="modal-heading"><div class="modal-title"><span class="settings-key">${icon('KeyRound', 23)}</span><button class="icon-button" data-close aria-label="Close AI settings">${icon('X', 20)}</button></div><span class="eyebrow">YOUR CREATIVE CONNECTION</span><h2>AI settings</h2><p>Connect your OpenAI account to reimagine document images.</p></div><div class="settings-connection"><span class="connection-dot ${this.status.configured ? 'connected' : ''}"></span>${this.status.configured ? 'API key configured' : 'No API key connected'}<span>${escape(this.status.model)}</span></div><label class="key-label" for="api-key">${this.status.configured ? 'Replace API key' : 'OpenAI API key'}</label><input id="api-key" type="password" autocomplete="off" spellcheck="false" placeholder="sk-…"><p class="small-note">Keys entered here stay in memory for this app session. Your key is never included in an exported document.</p><p class="settings-privacy">${icon('ShieldCheck', 16)} Your selected image and optional nearby text are sent to OpenAI only when you click Generate. API usage is billed to the connected project.</p><p id="settings-error" class="inline-error" role="alert"></p><div class="modal-actions">${this.status.configured ? '<button class="text-button" data-disconnect>Disconnect</button>' : ''}<button class="button secondary" data-close>Cancel</button><button class="button primary" data-save>Connect key</button></div>`;
    document.body.append(dialog);
    const close = () => { dialog.querySelector<HTMLInputElement>('#api-key')!.value = ''; dialog.close(); dialog.remove(); };
    dialog.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
    dialog.oncancel = e => { e.preventDefault(); close(); };
    const set = async (key: string) => {
      const button = dialog.querySelector<HTMLButtonElement>('[data-save]')!; button.disabled = true;
      try { this.status = await invoke<StudioStatus>('studio_set_key', { key }); this.onStatus(this.status.configured); close(); if (this.document) this.renderInspector(); toast(this.status.configured ? 'API key configured for this session. It will be checked when you generate.' : 'API key disconnected.'); }
      catch (error) { dialog.querySelector('#settings-error')!.textContent = String(error); }
      finally { button.disabled = false; }
    };
    dialog.querySelector('[data-save]')!.addEventListener('click', () => {
      const key = dialog.querySelector<HTMLInputElement>('#api-key')!.value.trim();
      if (!key) { dialog.querySelector('#settings-error')!.textContent = 'Enter an API key first.'; return; }
      void set(key);
    });
    dialog.querySelector('[data-disconnect]')?.addEventListener('click', () => void set(''));
    dialog.showModal();
  }

  private async action(action: string, id?: string) {
    if (action === 'open') return this.chooseDocument();
    if (action === 'export') return this.exportDocument();
    if (action === 'select' && id) return this.select(id, true);
    if (action === 'zoom-in') return this.preview?.zoomBy(0.1);
    if (action === 'zoom-out') return this.preview?.zoomBy(-0.1);
    if (action === 'fit') return this.preview?.fit();
    if (action === 'generate') return this.generate();
    if (action === 'compare') return this.compare();
    if (action === 'accept') return this.accept();
    const picture = this.picture(); if (!picture) return;
    const work = this.work.get(picture.id)!;
    if (action.startsWith('style-')) { work.style = action.slice(6); this.renderInspector(); }
    if (action === 'restore') { work.accepted = null; this.preview?.replace(picture.id, null); this.renderInspector(); this.renderLibrary(); this.updateToolbar(); this.setMessage(`${picture.label}: the original image is back in your document preview.`); }
    if (action === 'previous-draft' || action === 'next-draft') {
      const index = work.drafts.findIndex(d => d.id === work.currentDraft) + (action === 'previous-draft' ? -1 : 1);
      work.currentDraft = work.drafts[index]?.id ?? work.currentDraft; this.renderInspector();
    }
  }
}
