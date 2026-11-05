import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import JSZip from 'jszip';
const fixture = JSON.parse(fs.readFileSync('output/studio-qa/fixture.json', 'utf8'));
const alternate = 'data:image/png;base64,' + fs.readFileSync('output/studio-qa/alternate.png').toString('base64');

async function desktop(page: Page, failGeneration = false, documentFixture = fixture) {
  await page.addInitScript(({ fixture, alternate, failGeneration }) => {
    const calls: {cmd:string; args:any}[] = [];
    Object.assign(window, { isTauri: true, __calls: calls, __TAURI_INTERNALS__: {
      invoke: async (cmd: string, args: any = {}) => {
        calls.push({cmd,args});
        if (cmd === 'studio_status') return { configured: true, model: 'gpt-image-2.5-sunburst', largeOutput: true };
        if (cmd === 'plugin:dialog|open') return fixture.path;
        if (cmd === 'studio_open') return fixture;
        if (cmd === 'plugin:dialog|save') return '/tmp/result-inkwell.docx';
        if (cmd === 'studio_generate') {
          await new Promise(resolve => setTimeout(resolve, 150));
          if (failGeneration) throw 'The OpenAI project has no available API credit. Check its billing and spending limit.';
          return { id: `draft-${calls.filter(c=>c.cmd==='studio_generate').length}`, imageId: args.request.imageId, dataUrl: alternate, width: 640, height: 400, model: 'test-image' };
        }
        if (cmd === 'studio_export') return { path: args.output, bytes: 12345, replacements: args.accepted.length };
        if (cmd === 'studio_set_key') return { configured: !!args.key, model: 'gpt-image-2.5-sunburst', largeOutput: true };
        if (cmd === 'convert_pdf') return { pages: 1, bytes: 500, path: '/tmp/optimized.pdf' };
        throw new Error(`Unexpected command ${cmd}`);
      }
    }});
  }, { fixture: documentFixture, alternate, failGeneration });
  await page.goto('/');
  await page.locator('.document-drop').click();
  await expect(page.locator('#page-count')).toHaveText('2 pages');
  await expect(page.locator('#document-preview .image-comment')).toHaveCount(4); // repeated page header
}

test('open, contextual generation, review, per-image acceptance, export and restore', async ({ page }) => {
  const errors: string[]=[]; page.on('pageerror',e=>errors.push(e.message));
  await desktop(page);
  await expect(page.locator('.image-tile')).toHaveCount(3);
  await expect(page.locator('#document-preview')).toContainText('A little room to breathe.');
  expect(await page.evaluate(()=>(window as any).__calls.filter((c:any)=>c.cmd==='studio_generate').length)).toBe(0);
  await page.screenshot({ path: 'output/studio-qa/workspace.png', fullPage: true });
  await page.locator('#generate-image').click();
  await expect(page.getByRole('button',{name:'Use this image',exact:true})).toBeVisible();
  let calls = await page.evaluate(()=>(window as any).__calls);
  expect(calls.find((c:any)=>c.cmd==='studio_generate').args.request).toMatchObject({prompt:'',useContext:true,imageId:'image-1',quality:'high'});
  await expect(page.locator('#save-state')).toHaveText('Original document');
  await page.getByRole('button',{name:'Compare with original',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('#compare-slider').fill('70');
  await page.screenshot({ path:'output/studio-qa/comparison.png',fullPage:true });
  await page.getByRole('dialog').getByRole('button',{name:'Use this image'}).click();
  await expect(page.locator('#save-state')).toContainText('1 replacement');
  const source1 = await page.locator('#document-preview img[data-image-id="image-1"]').getAttribute('src');
  const source2 = await page.locator('#document-preview img[data-image-id="image-2"]').getAttribute('src');
  expect(source1).toBe(alternate); expect(source2).not.toBe(alternate);
  await page.locator('#export-docx').click();
  await expect(page.locator('#save-state')).toHaveText('Exported');
  calls = await page.evaluate(()=>(window as any).__calls);
  expect(calls.find((c:any)=>c.cmd==='studio_export').args.accepted).toEqual([{imageId:'image-1',candidateId:'draft-1'}]);
  await page.getByRole('button',{name:'Restore original in document'}).click();
  await expect(page.locator('#save-state')).toContainText('Unsaved');
  expect(await page.locator('#document-preview img[data-image-id="image-1"]').getAttribute('src')).not.toBe(alternate);
  expect(errors).toEqual([]);
});

test('image comments select the right picture; optional context and custom prompt are respected', async ({page}) => {
  await desktop(page);
  await page.locator('#document-preview .image-comment[data-image-id="image-2"]').click();
  await expect(page.locator('#image-inspector h2')).toContainText('Image 02');
  await page.locator('#image-prompt').fill('Keep the ceramic cup blue.');
  await page.locator('#use-context').uncheck();
  await page.locator('#image-quality').selectOption('medium');
  await page.locator('#image-resolution').selectOption('large');
  await page.locator('#generate-image').click();
  await expect(page.getByRole('button',{name:'Use this image',exact:true})).toBeVisible();
  const call = await page.evaluate(()=>(window as any).__calls.find((c:any)=>c.cmd==='studio_generate'));
  expect(call.args.request).toMatchObject({imageId:'image-2',prompt:'Keep the ceramic cup blue.',useContext:false,quality:'medium',resolution:'large'});
  await page.locator('#export-docx').click();
  const saved = await page.evaluate(()=>(window as any).__calls.find((c:any)=>c.cmd==='studio_export'));
  expect(saved.args.accepted).toEqual([]); // Unaccepted drafts never silently enter the document.
});

test('failed generation leaves the document intact and allows retry', async ({page}) => {
  await desktop(page,true);
  await page.locator('#generate-image').click();
  await expect(page.locator('#studio-message')).toContainText('no available API credit');
  await expect(page.locator('#generate-image')).toBeEnabled();
  await expect(page.locator('#save-state')).toHaveText('Original document');
  await expect(page.getByRole('button',{name:'Use this image',exact:true})).toHaveCount(0);
});

test('desktop layout and PDF tool remain usable at the minimum window size', async ({page}) => {
  await page.setViewportSize({width:1000,height:700});
  await desktop(page);
  const overflow = await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
  await expect(page.locator('#generate-image')).toBeInViewport();
  await expect(page.locator('#ai-settings')).toBeVisible();
  await page.screenshot({path:'output/studio-qa/compact.png',fullPage:true});
  await page.locator('#nav-pdf').click();
  await page.locator('[data-value="50"]').click();
  await expect(page.locator('#amount')).toHaveText('50');
  await expect(page.locator('#reduction')).toHaveText('50% lower CMYK channel values');
  await page.screenshot({path:'output/studio-qa/pdf.png',fullPage:true});
  await page.locator('#nav-studio').click();
  await expect(page.locator('.image-tile')).toHaveCount(3);
});

test('continuous documents paginate without dropping text or image occurrences', async ({page}) => {
  const archive = await JSZip.loadAsync(fixture.previewBase64, {base64:true});
  const xml = await archive.file('word/document.xml')!.async('string');
  archive.file('word/document.xml', xml.replace(/<w:br w:type="page"\/>/g,''));
  const continuous = {...fixture,previewBase64:await archive.generateAsync({type:'base64'})};
  await desktop(page,false,continuous);
  await expect(page.locator('#document-preview')).toContainText('This second placement deliberately uses the same embedded image.');
  await expect(page.locator('#document-preview img[data-image-id="image-1"]')).toHaveCount(1);
  await expect(page.locator('#document-preview img[data-image-id="image-2"]')).toHaveCount(1);
  expect(await page.locator('#document-preview section.docx').evaluateAll(pages=>pages.every(p=>(p as HTMLElement).offsetHeight<1200))).toBe(true);
});
