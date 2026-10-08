// The canvas panel: a post for the tab in front opens it and renders; every
// title is a tab, a reposted title replaces its tab, todo items tick, and the
// footer button toggles the panel.
module.exports = async ({ window, run, click, wait, screenshot }) => {
  let posted = 0;
  const frame = (format, title, content, extra = {}) => ({ id: `${format}-${++posted}`, title, format, content, createdAt: Date.now() + posted, updatedAt: Date.now() + posted, ...extra });
  const post = async (termId, drawing) => { window.webContents.send('test:canvas', termId, drawing); await wait(250); };
  const panel = () => run(`document.querySelector('.terminal-side-panel')?.innerText ?? ''`);
  const tabs = () => run(`[...document.querySelectorAll('.terminal-side-panel [role=tab]')].map(tab => tab.textContent)`);

  await click('Build a better terminal (Codex)');
  await post('1', frame('mermaid', 'How software gets made', `flowchart TB
  P((person with<br/>a problem)) --> A[Idea] --> B[Define] --> C[Design] --> D[Build]
  D --> E[Test] -. fix .-> D
  E --> F[Release] --> G[Observe] -- what we learned --> A
  classDef warm fill:#FEF3C7,stroke:#D97706,color:#111
  classDef cool fill:#DBEAFE,stroke:#2563EB,color:#111
  class A,G warm
  class B,C,D,E,F cool`));
  if (!(await panel()).includes('How software gets made')) throw Error('A post for the active tab did not open the canvas panel');
  for (let i = 0; i < 20 && !(await run(`Boolean(document.querySelector('.deck-mermaid svg'))`)); i++) await wait(250);
  if (!(await run(`Boolean(document.querySelector('.deck-mermaid svg'))`))) throw Error('The mermaid drawing did not render to svg');
  if (!(await run(`document.querySelector('.deck-mermaid svg').textContent.includes('Release')`))) throw Error('The rendered diagram lost its labels');
  if ((await tabs()).length) throw Error('One frame should show no tab strip');
  await screenshot('canvas-mermaid');

  await post('1', frame('svg', 'Sketch', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 120"><rect width="320" height="120" rx="12" fill="#FBFBFD"/><circle cx="40" cy="40" r="14" fill="none" stroke="#374151" stroke-width="3"/><line x1="40" y1="54" x2="40" y2="90" stroke="#374151" stroke-width="3"/><rect x="100" y="30" width="180" height="60" rx="10" fill="#DBEAFE" stroke="#2563EB" stroke-width="2"/><text x="190" y="66" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#111">a stickman and a box</text></svg>`, { alt: 'a stickman and a box' }));
  if (!(await run(`Boolean(document.querySelector('.terminal-side-panel img[alt="a stickman and a box"]'))`))) throw Error('The svg drawing did not render as an image');
  if (JSON.stringify(await tabs()) !== '["How software gets made","Sketch"]') throw Error('Two frames did not show as two tabs');
  await screenshot('canvas-svg');

  await post('1', frame('markdown', 'Now', '## Working on\nDark mode\n\n- [ ] tokens\n- [x] toggle'));
  const boxes = () => run(`[...document.querySelectorAll('.terminal-side-panel input[type=checkbox]')].map(box => box.checked)`);
  if (JSON.stringify(await boxes()) !== '[false,true]') throw Error('The todo list did not render its task items');
  await run(`document.querySelector('.terminal-side-panel input[type=checkbox]').click()`);
  await wait(200);
  if (JSON.stringify(await boxes()) !== '[true,true]') throw Error('Ticking a task item did not update the frame: ' + (await run(`[...document.querySelectorAll('.terminal-side-panel input[type=checkbox]')].map(box => box.outerHTML).join(' | ')`)));
  await screenshot('canvas-todo');

  // Reposting a title replaces its tab instead of adding one.
  await post('1', frame('markdown', 'now', '## Working on\nDark mode\n\n- [x] tokens\n- [x] toggle\n- [ ] remember the choice'));
  if (JSON.stringify(await tabs()) !== '["How software gets made","Sketch","Now"]') throw Error('Reposting a title did not replace its tab');
  if (!(await panel()).includes('remember the choice')) throw Error('The replaced tab did not show its new content');

  await click('Sketch');
  if (!(await run(`Boolean(document.querySelector('.terminal-side-panel img[alt="a stickman and a box"]'))`))) throw Error('Picking a tab did not show it');
  // A post for another terminal must not touch this panel.
  await post('2', frame('ascii', 'Elsewhere', '[a] -> [b]'));
  if ((await panel()).includes('Elsewhere') || !(await run(`Boolean(document.querySelector('.terminal-side-panel img'))`))) throw Error('A post for another tab replaced the one in view');
  // A new post for this terminal brings its tab forward again.
  await post('1', frame('code', 'Snippet', 'let x = 1', { language: 'ts' }));
  if (!(await panel()).includes('let x = 1')) throw Error('A new post did not come forward over the picked tab');
  await click('Close Snippet');
  if ((await tabs()).includes('Snippet')) throw Error('Closing a tab did not remove it');

  await click('Close (⌘⇧E)');
  if ((await panel()).includes('Sketch')) throw Error('Close did not hide the canvas panel');
  await click('Drawings the agent posted for this tab (⌘⇧E)');
  if ((await tabs()).length !== 3) throw Error('The footer button did not reopen the canvas with its tabs');
  await click('Clear the canvas');
  if (!(await panel()).includes('Nothing here yet')) throw Error('Clear did not empty the canvas');
  await screenshot('canvas-empty');
  await click('Close (⌘⇧E)');
};
