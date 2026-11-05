import { parseAsync, renderDocument } from 'docx-preview';
import type { OpenedDocument, GeneratedImage } from './types';
import { base64Bytes, icon } from './ui';
import { paginatePreview } from './pagination';

/** Shadow DOM keeps imported document typography and styles inside the page. */
export class DocumentPreview {
  private shadow: ShadowRoot;
  private pages: HTMLDivElement;
  private overlays: HTMLDivElement;
  private images = new Map<string, (HTMLImageElement | SVGImageElement)[]>();
  private buttons = new Map<string, HTMLButtonElement[]>();
  private source = new Map<string, string>();
  private objects: string[] = [];
  private resize: ResizeObserver;
  private scale = 0.7;
  private naturalWidth = 794;
  private active: string | null = null;
  onSelect: (id: string) => void = () => {};
  onZoom: (value: number) => void = () => {};
  pageCount = 0;

  constructor(private host: HTMLElement) {
    this.shadow = host.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = `<style>
      :host{display:block;position:relative;min-height:100%;padding:30px 34px 48px;box-sizing:border-box}
      .pages{position:relative;transform-origin:top left;margin:0 auto;width:max-content}
      .docx-wrapper{padding:0!important;background:transparent!important;gap:28px!important;display:flex!important;flex-direction:column!important;align-items:center!important}
      section.docx{box-shadow:0 2px 8px #233d3310,0 0 0 1px #233d3312!important;margin:0!important;position:relative}
      img[data-image-id],image[data-image-id]{cursor:pointer;outline-offset:5px;transition:outline-color .15s}
      [data-image-id].selected{outline:3px solid #6b885b}
      .overlays{position:absolute;inset:0;pointer-events:none;z-index:5}
      .image-comment{position:absolute;pointer-events:auto;display:grid;place-items:center;width:31px;height:31px;padding:0;border:1px solid #d1dbcb;border-radius:9px;background:#fff;color:#557249;box-shadow:0 3px 9px #233d331c;cursor:pointer;transform:translate(-50%,-50%)}
      .image-comment:hover,.image-comment.active{background:#37543e;color:white;border-color:#37543e}
      .image-comment.accepted:after{content:'';position:absolute;right:-3px;top:-3px;width:8px;height:8px;border:2px solid white;border-radius:50%;background:#709b50}
      .image-comment:focus-visible{outline:3px solid #a8bd80;outline-offset:3px}
      a{pointer-events:none;color:inherit} .docx-wrapper img{max-width:none}
    </style><div class="pages"></div><div class="overlays"></div>`;
    this.pages = this.shadow.querySelector('.pages')!;
    this.overlays = this.shadow.querySelector('.overlays')!;
    this.resize = new ResizeObserver(() => this.positionButtons());
    this.resize.observe(host);
    this.shadow.addEventListener('click', e => {
      const target = e.target as Element;
      const image = target.closest('[data-image-id]') as HTMLElement | null;
      if (image?.dataset.imageId) this.onSelect(image.dataset.imageId);
    });
  }

  async render(document: OpenedDocument) {
    this.disposeUrls();
    this.images.clear(); this.buttons.clear(); this.source.clear();
    this.pages.innerHTML = ''; this.overlays.innerHTML = '';
    const options = { className: 'docx', inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: false, useBase64URL: true, renderAltChunks: false, renderComments: false, renderChanges: false };
    const parsed = await parseAsync(base64Bytes(document.previewBase64), options);
    const urlIds = new Map<string, string>();
    const pictureMap = new Map(document.images.map(p => [p.id, p]));
    // The backend assigns a relationship per drawing occurrence. Headers can be
    // rendered repeatedly, so one occurrence can legitimately have several nodes.
    parsed.loadDocumentImage = async (relationship: string) => {
      const id = relationship.replace(/^inkwellPreview-/, '');
      const picture = pictureMap.get(id);
      if (!picture?.supported) return '';
      if (!this.source.has(id)) {
        const [prefix, encoded] = picture.dataUrl.split(',');
        const url = URL.createObjectURL(new Blob([base64Bytes(encoded)], { type: prefix.slice(5).split(';')[0] }));
        this.objects.push(url); this.source.set(id, url); urlIds.set(url, id);
      }
      return this.source.get(id)!;
    };
    const nodes = await renderDocument(parsed, options);
    this.pages.append(...nodes);
    this.pages.querySelectorAll('a').forEach(a => { a.removeAttribute('href'); a.removeAttribute('target'); });
    await Promise.all(Array.from(this.pages.querySelectorAll('img')).map(e => e.decode().catch(() => {})));
    await window.document.fonts.ready;
    paginatePreview(this.pages);
    const rendered = Array.from(this.pages.querySelectorAll<HTMLImageElement | SVGImageElement>('img, svg image'));
    rendered.forEach(element => {
      const src = element instanceof HTMLImageElement ? element.src : element.getAttribute('href');
      const id = src ? urlIds.get(src) : undefined;
      if (!id) return;
      element.dataset.imageId = id;
      if (element instanceof HTMLImageElement) element.alt = pictureMap.get(id)?.alt || pictureMap.get(id)!.label;
      this.images.set(id, [...(this.images.get(id) ?? []), element]);
      const button = window.document.createElement('button');
      button.className = 'image-comment'; button.dataset.imageId = id;
      button.title = `Add instructions for ${pictureMap.get(id)!.label}`;
      button.setAttribute('aria-label', button.title);
      button.innerHTML = icon('MessageSquarePlus', 16);
      this.overlays.append(button);
      this.buttons.set(id, [...(this.buttons.get(id) ?? []), button]);
    });
    this.pageCount = this.pages.querySelectorAll('section.docx').length;
    this.naturalWidth = Math.max(1, this.pages.offsetWidth);
    this.resize.observe(this.pages);
    this.fit();
  }

  fit() { this.zoom(Math.min(1, Math.max(0.3, (this.host.clientWidth - 68) / this.naturalWidth))); }
  zoom(value: number) {
    this.scale = Math.min(1.6, Math.max(0.3, value));
    // CSS zoom adjusts both page geometry and scrollable layout on WebView2/WebKit.
    this.pages.style.setProperty('zoom', String(this.scale));
    this.onZoom(Math.round(this.scale * 100));
    requestAnimationFrame(() => this.positionButtons());
  }
  zoomBy(delta: number) { this.zoom(this.scale + delta); }
  select(id: string, scroll = false) {
    this.active = id;
    this.images.forEach((nodes, key) => nodes.forEach(n => n.classList.toggle('selected', key === id)));
    this.buttons.forEach((nodes, key) => nodes.forEach(n => n.classList.toggle('active', key === id)));
    if (scroll) this.images.get(id)?.[0]?.scrollIntoView({ block: 'center', behavior: this.pageCount > 10 ? 'instant' : 'smooth' });
  }
  replace(id: string, candidate: GeneratedImage | null) {
    const src = candidate?.dataUrl ?? this.source.get(id) ?? '';
    this.images.get(id)?.forEach(element => {
      if (element instanceof HTMLImageElement) { element.src = src; element.onload = () => this.positionButtons(); }
      else element.setAttribute('href', src);
    });
    this.buttons.get(id)?.forEach(b => b.classList.toggle('accepted', !!candidate));
    if (this.active) this.select(this.active);
    requestAnimationFrame(() => this.positionButtons());
  }
  private positionButtons() {
    const host = this.host.getBoundingClientRect();
    this.images.forEach((nodes, id) => nodes.forEach((node, index) => {
      const rect = node.getBoundingClientRect();
      const button = this.buttons.get(id)?.[index];
      if (button) { button.style.left = `${rect.right - host.left + 11}px`; button.style.top = `${rect.top - host.top + 6}px`; }
    }));
  }
  private disposeUrls() { this.objects.forEach(URL.revokeObjectURL); this.objects = []; }
  destroy() { this.resize.disconnect(); this.disposeUrls(); }
}
