/**
 * DOCX contains flow content; many exporters omit saved page breaks entirely.
 * Paginate the preview's measured block flow without touching the exported XML.
 * Complex columns and oversized indivisible rows remain in their original flow.
 */
export function paginatePreview(root: HTMLElement) {
  const number = (value: string) => Number.parseFloat(value) || 0;
  const height = (element: HTMLElement) => {
    const style = getComputedStyle(element);
    return element.getBoundingClientRect().height + number(style.marginTop) + number(style.marginBottom);
  };
  const sections = Array.from(root.querySelectorAll<HTMLElement>('section.docx'));
  for (const section of sections) {
    const articles = Array.from(section.children).filter((c): c is HTMLElement => c instanceof HTMLElement && c.tagName === 'ARTICLE');
    if (articles.length !== 1) continue;
    const article = articles[0];
    if (number(getComputedStyle(article).columnCount) > 1) continue;
    const style = getComputedStyle(section);
    const pageHeight = number(style.minHeight);
    if (!pageHeight) continue;
    const ornaments = Array.from(section.children).filter((n): n is HTMLElement => n instanceof HTMLElement && n !== article);
    const capacity = pageHeight - number(style.paddingTop) - number(style.paddingBottom) - ornaments.reduce((sum, n) => sum + Math.max(0, height(n)), 0) - 10;
    if (capacity < 150 || article.getBoundingClientRect().height <= capacity + 10) continue;
    // Read geometry before moving any elements to avoid repeated full reflows.
    const blocks = Array.from(article.children).filter((c): c is HTMLElement => c instanceof HTMLElement).map(node => ({node, height:height(node), rows: node instanceof HTMLTableElement ? Array.from(node.rows).map(row=>({row,height:height(row)})) : []}));
    const fragments: {node:HTMLElement;height:number}[] = [];
    for (const block of blocks) {
      if (!(block.node instanceof HTMLTableElement) || block.height <= capacity || block.rows.length < 2) { fragments.push(block); continue; }
      const table = block.node;
      const rowGroups: {row:HTMLTableRowElement;height:number}[][] = [];
      let group: {row:HTMLTableRowElement;height:number}[] = [];
      let spanEnd = -1;
      block.rows.forEach((info,index) => {
        group.push(info);
        for (const cell of Array.from(info.row.cells)) spanEnd = Math.max(spanEnd,index+Math.max(1,cell.rowSpan)-1);
        if (index >= spanEnd) {rowGroups.push(group);group=[];}
      });
      if (group.length) rowGroups.push(group);
      let pending: HTMLTableRowElement[] = []; let used = 0;
      const flush = () => {
        if (!pending.length) return;
        const fragment = table.cloneNode(false) as HTMLTableElement;
        for (const child of Array.from(table.children)) if (child.tagName === 'COLGROUP' || child.tagName === 'CAPTION') fragment.append(child.cloneNode(true));
        const body = document.createElement('tbody'); body.append(...pending); fragment.append(body);
        fragments.push({node:fragment,height:used+4}); pending=[];used=0;
      };
      for (const rows of rowGroups) {
        const size=rows.reduce((sum,r)=>sum+r.height,0);
        if (pending.length && used+size > capacity-4) flush();
        pending.push(...rows.map(r=>r.row));used+=size;
      }
      flush();
    }
    const pageGroups: HTMLElement[][] = []; let current:HTMLElement[]=[];let used=0;
    for (const block of fragments) {
      if (current.length && used+block.height > capacity) {pageGroups.push(current);current=[];used=0;}
      current.push(block.node);used+=block.height;
    }
    if (current.length) pageGroups.push(current);
    const replacements = pageGroups.map(group => {
      const page=section.cloneNode(false) as HTMLElement;
      const body=article.cloneNode(false) as HTMLElement;body.append(...group);
      for(const child of Array.from(section.children)) page.append(child === article ? body : child.cloneNode(true));
      return page;
    });
    section.replaceWith(...replacements);
  }
}
