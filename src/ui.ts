import { createElement, ArrowDownToLine, ArrowLeftRight, ArrowUpRight, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, FileText, FolderOpen, Image, Layers, LoaderCircle, MessageSquarePlus, Minus, Plus, Scan, Settings2, ShieldCheck, Sparkles, WandSparkles, X, RotateCcw, Leaf, ZoomIn, KeyRound, TriangleAlert, Upload, Eye, ImagePlus } from 'lucide';

const icons = { ArrowDownToLine, ArrowLeftRight, ArrowUpRight, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, FileText, FolderOpen, Image, Layers, LoaderCircle, MessageSquarePlus, Minus, Plus, Scan, Settings2, ShieldCheck, Sparkles, WandSparkles, X, RotateCcw, Leaf, ZoomIn, KeyRound, TriangleAlert, Upload, Eye, ImagePlus };
export function icon(name: keyof typeof icons, size = 18) { return createElement(icons[name], { width: size, height: size, 'stroke-width': 1.65, 'aria-hidden': 'true' }).outerHTML; }
export function escape(value: string) { return value.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!)); }
export function bytesLabel(bytes: number) { return bytes < 1048576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`; }
export function base64Bytes(value: string) { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
export function toast(message: string, error = false) {
  const host = document.getElementById('toast')!;
  host.textContent = message;
  host.classList.toggle('is-error', error);
  host.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => host.hidden = true, error ? 12000 : 6500);
}
let toastTimer = 0;

export function askDiscard(message: string): Promise<boolean> {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal small-modal';
    dialog.innerHTML = `<div class="modal-heading"><span class="eyebrow">UNSAVED WORK</span><h2>Open another document?</h2><p>${escape(message)}</p></div><div class="modal-actions"><button class="button secondary" data-action="cancel">Keep working</button><button class="button primary" data-action="discard">Discard and open</button></div>`;
    document.body.append(dialog);
    const finish = (value: boolean) => { dialog.close(); dialog.remove(); resolve(value); };
    dialog.querySelector('[data-action="cancel"]')!.addEventListener('click', () => finish(false));
    dialog.querySelector('[data-action="discard"]')!.addEventListener('click', () => finish(true));
    dialog.oncancel = e => { e.preventDefault(); finish(false); };
    dialog.showModal();
  });
}
