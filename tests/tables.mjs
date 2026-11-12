import {chromium} from 'playwright';
import {buildHTML} from '../src/archive.js';
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';

const schema = '<thead><tr><th>层级</th><th>关键字段</th><th>作用</th></tr></thead><tbody><tr><td>Task / Agent</td><td><code>task_id、agent_id、scene_id、version</code></td><td>任务和版本追踪</td></tr><tr><td>Memory</td><td>memory_ids、retrieval_score、feedback</td><td>记忆效果分析</td></tr><tr><td colspan="3">完整保留合并单元格</td></tr></tbody>';
const wide = '<thead><tr>' + Array.from({length:8}, (_,i)=>`<th>字段 ${i+1}</th>`).join('') + '</tr></thead><tbody><tr>' + Array.from({length:8}, (_,i)=>`<td>value_${i+1}</td>`).join('') + '</tr></tbody>';
const c = {
  title:'手机表格回归', url:'https://chatgpt.com/c/table-test', exportedAt:'2026-11-12T00:00:00Z', width:768,
  background:'#fff', color:'#222', warnings:[],
  css:'.kept-turn{font:14px/1.7 sans-serif}.wide{display:flex;position:relative;margin-left:-258px;margin-right:-258px;max-width:100%}.viewport{overflow-x:auto;padding-left:258px;padding-right:258px;max-width:100%}table{border-collapse:collapse;min-width:min(100%,768px)}th,td{min-width:0;max-width:576px;padding:10px;text-align:left;overflow-wrap:anywhere;border-bottom:1px solid #ddd}code{overflow-wrap:anywhere}',
  messages:[{role:'assistant',html:`<div class="kept-turn"><h2>统一记录什么？</h2><div class="wide"><div class="viewport"><table id="schema">${schema}</table></div></div><p>普通表格也要可读：</p><table id="plain">${schema}</table><div class="wide"><div class="viewport"><table id="wide">${wide}</table></div></div></div>`}]
};
await mkdir('output/playwright/tables',{recursive:true});
const html=buildHTML(c);
await writeFile('output/playwright/tables/tables.html',html);
const browser=await chromium.launch({channel:'chromium',headless:true});
try {
  const page=await browser.newPage();
  for (const width of [1280,320,390,430]) {
    await page.setViewportSize({width,height:900});
    await page.setContent(html);
    assert.equal(await page.getByRole('table').count(),3);
    assert.equal(await page.locator('td[colspan="3"]').count(),2);
    const tables=await page.locator('table').evaluateAll(nodes=>nodes.map(t=>{
      const rect=t.getBoundingClientRect();
      return {id:t.id,left:rect.left,right:rect.right,width:rect.width,client:t.clientWidth,scroll:t.scrollWidth,
        headers:[...t.rows[0].cells].map(n=>({x:n.getBoundingClientRect().x,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})),
        cells:[...t.rows[1].cells].map(n=>({x:n.getBoundingClientRect().x,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height}))};
    }));
    for (const t of tables) {
      assert.ok(t.left>=0 && t.right<=width+1,`${width}px: ${t.id} viewport stays on screen`);
      t.headers.forEach((h,i)=>{
        assert.ok(h.width>=(width<600?100:70),`${width}px: ${t.id} column ${i+1} is readable`);
        assert.ok(Math.abs(h.x-t.cells[i].x)<1 && Math.abs(h.width-t.cells[i].width)<1,'Header and body columns align');
        assert.ok(h.height<60 && t.cells[i].height<200,'Short cell text is not stacked one character per line');
      });
    }
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Only the table scrolls horizontally');
    if (width<600) {
      const wideTable=page.locator('#wide');
      assert.ok(tables.find(t=>t.id==='wide').scroll>tables.find(t=>t.id==='wide').client);
      assert.equal(await wideTable.evaluate(t=>{t.scrollLeft=t.scrollWidth;const last=t.rows[0].cells[7].getBoundingClientRect();return t.scrollLeft>0&&last.right<=t.getBoundingClientRect().right+1;}),true,'Last column is reachable by horizontal scrolling');
      await page.screenshot({path:`output/playwright/tables/mobile-${width}.png`});
    }
  }
  console.log('PASS cached desktop table wrappers, plain tables, readable columns, header alignment, merged cells and horizontal scrolling at 320/390/430px');
} finally {await browser.close();}
