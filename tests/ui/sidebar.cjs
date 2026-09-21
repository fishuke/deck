module.exports = async function checkSidebar({ window, run, click, wait, screenshot }) {
  const initial = await run('window.deck.sessions.list()');
  const session = (id, title, age) => ({ session_id: id, title, agent: 'codex', cwd: '/Users/demo/www/deck', status: 'ended', term_id: null, updated_at: Date.now() - age, started_at: Date.now() - age });
  const older = session('codex:old-suggestion', 'Yesterday’s refactor', 24 * 60 * 60 * 1000);
  const previous = session('codex:previous-suggestion', 'Polish the command palette', 8 * 60 * 1000);
  const latest = session('codex:latest-suggestion', 'Finish the sidebar cleanup', 4 * 60 * 1000);
  const update = async (extra) => { window.webContents.send('test:sessions', [...initial, ...extra]); await wait(150); };
  const hasSuggestions = () => run(`Boolean(document.querySelector('section[aria-label="Session suggestions"]'))`);
  const sidebarText = () => run(`document.querySelector('aside').innerText`);
  const search = async (query) => {
    await run(`(() => { const input = document.querySelector('input[aria-label="Search tabs"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(query)}); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await wait(150);
  };

  const shell = await run('window.deck.term.create({ cwd: "/tmp/codex-startup" })');
  const pending = { ...session(`pending:${shell.id}`, null, 0), cwd: shell.cwd, term_id: shell.id, status: 'idle' };
  await update([pending]);
  if (!(await run(`Boolean(document.querySelector('[aria-label="codex-startup (Codex)"] [title="Ready"]'))`))) throw Error('Idle Codex should be identified before its first prompt');
  await update([]);
  if (!(await run(`Boolean(document.querySelector('[aria-label="codex-startup"]'))`))) throw Error('Exiting before the first prompt should restore the shell tab');
  await update([pending]);
  await update([{ ...pending, session_id: 'codex:startup', title: 'First Codex prompt', status: 'working' }]);
  if (!(await run(`Boolean(document.querySelector('[aria-label="First Codex prompt (Codex)"] [title="Working"]'))`))) throw Error('The first hook should replace the idle Codex placeholder');
  await run(`window.deck.term.kill(${JSON.stringify(shell.id)})`);
  await update([]);

  await update([older, previous, latest]);
  await click('Build a better terminal (Codex)');
  const text = await sidebarText();
  if (!text.includes(latest.title) || text.includes(previous.title) || text.includes(older.title)) throw Error('Sidebar should suggest only the most recent session');
  await screenshot('continue-session');
  await click('More recent (1)');
  if (!(await sidebarText()).includes(previous.title)) throw Error('Other recent sessions should be available on demand');
  await click('Show less');
  await search('Yesterday');
  if (!(await sidebarText()).includes(older.title) || await hasSuggestions()) throw Error('Explicit search should find older sessions without a suggestion card');
  await search('');
  await click('Dismiss all session suggestions');
  if (await hasSuggestions()) throw Error('Dismiss all retained suggestions');
  await click('Toggle sidebar');
  await click('Toggle sidebar');
  if (await hasSuggestions()) throw Error('Dismissal did not survive sidebar remount');
  await search('Finish the sidebar');
  if (!(await sidebarText()).includes(latest.title)) throw Error('Dismissal should preserve searchable sessions');
  await search('');

  await update([older, session('codex:expiring', 'Almost fifteen minutes old', 15 * 60 * 1000 - 1000)]);
  if (!(await hasSuggestions())) throw Error('A session within fifteen minutes should be suggested');
  await wait(1100);
  if (await hasSuggestions()) throw Error('Suggestion did not expire without new session events');

  await update([session('codex:close-all', 'Another recent session', 60 * 1000)]);
  await click('New session');
  await click('Close all tabs');
  if ((await run('window.deck.term.list()')).length || await hasSuggestions()) throw Error('Close all should leave a clear sidebar');
  if ((await run('window.deck.sessions.list()')).length !== initial.length + 1) throw Error('Close all deleted session history');

  // The sweep closes only the sessions that are idle with every PR merged and a clean tree.
  const swept = await run('window.deck.term.create({ cwd: "/Users/demo/www/clean", agent: "claude" })');
  const sweptToo = await run('window.deck.term.create({ cwd: "/Users/demo/www/clean-too", agent: "claude" })');
  const kept = await run('window.deck.term.create({ cwd: "/Users/demo/www/deck", agent: "codex" })');
  const live = (id, title, term, cwd) => ({ ...session(id, title, 60 * 1000), agent: id.startsWith('codex:') ? 'codex' : 'claude', status: 'idle', term_id: term.id, cwd });
  await update([live('claude-swept', 'Merged work', swept, swept.cwd), live('claude-swept-too', 'More merged work', sweptToo, sweptToo.cwd), live('codex:kept', 'Open work', kept, kept.cwd)]);
  await click('Sweep sessions');
  await wait(300);
  const sweepText = () => run(`(() => { const panel = document.querySelector('[role="dialog"][aria-label="Session sweep"]'); return panel ? panel.innerText : ''; })()`);
  let sessionSweep = await sweepText();
  for (const expected of ['2 merged and clean', 'Close all done', 'Merged work', '#21 PR 21', 'Open work', '#22 PR 22', '1 of 1 not merged']) {
    if (!sessionSweep.includes(expected)) throw Error('Session sweep missing: ' + expected);
  }
  await click('Close all done');
  const remaining = (await run('window.deck.term.list()')).map(term => term.id);
  if (remaining.includes(swept.id) || remaining.includes(sweptToo.id) || !remaining.includes(kept.id)) throw Error('Close all done should close only the merged and clean sessions');
  sessionSweep = await sweepText();
  if (sessionSweep.includes('Merged work') || !sessionSweep.includes('Open work')) throw Error('Closed sessions should leave the sweep');
  await click('Close session Open work');
  if ((await run('window.deck.term.list()')).length) throw Error('Closing a session from the sweep should close its tab');
  await click('Close session sweep');
  await update([]);

  await click('New session');
  await click('Worktrees');
  const sweep = await run(`(() => { const panel = document.querySelector('[role="dialog"][aria-label="Worktrees"]'); return panel ? panel.innerText : ''; })()`);
  for (const expected of ['2 merged and clean · 3.7 GB', 'Remove all', 'INI-1-feature', 'api · 2.5 GB', 'merged', 'not on the default branch', '3 uncommitted']) {
    if (!sweep.includes(expected)) throw Error('Worktree sweep missing: ' + expected);
  }
  await click('Remove all');
  if ((await run('window.deck.removedWorktrees()')).length !== 2) throw Error('Remove all should reclaim only the merged and clean worktrees');
  if (!(await run(`document.querySelector('[role="dialog"][aria-label="Worktrees"]').innerText`)).includes('INI-2-wip')) throw Error('Remove all took the worktree with uncommitted work');
  await click('Close');

  // A tab in a worktree waits for an answer; an ordinary tab still closes at once.
  const dirty = await run('window.deck.term.create({ cwd: "/Users/demo/www/.worktrees/INI-2-wip" })');
  await wait(200);
  await click('Close INI-2-wip');
  const prompt = await run(`(() => { const dialog = document.querySelector('[role="dialog"][aria-label="Close tab and its worktree"]'); return dialog ? dialog.innerText : ''; })()`);
  for (const expected of ['worktree of web', 'INI-2-wip', '3 uncommitted files', 'Keep worktree', 'Remove and delete branch']) {
    if (!prompt.includes(expected)) throw Error('Worktree close prompt missing: ' + expected);
  }
  if (await run('document.activeElement.textContent.trim()') !== 'Keep worktree') throw Error('An uncommitted tree should default to keeping the worktree');
  if (!(await run('window.deck.term.list()')).some(term => term.id === dirty.id)) throw Error('Tab closed before the worktree question was answered');
  await click('Keep worktree');
  if (await run(`Boolean(document.querySelector('[role="dialog"][aria-label="Close tab and its worktree"]'))`)) throw Error('Keep did not dismiss the prompt');
  if ((await run('window.deck.term.list()')).some(term => term.id === dirty.id)) throw Error('Keep did not close the tab');
  if ((await run('window.deck.removedWorktrees()')).length !== 2) throw Error('Keep removed a worktree');
};
