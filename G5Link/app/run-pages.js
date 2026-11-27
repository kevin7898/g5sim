'use strict';

(() => {
  const model = window.G5RunPageModel;
  const body = $('runLayoutBody');
  const modules = $('runModules');
  const map = $('map').closest('.map-mod');
  const mapHome = document.createComment('Guidance map');
  map.before(mapHome);
  let mounted;
  let view = 'sets';
  let selected;
  let machine;
  let draft;
  let block;
  let message;
  let dragged;
  let focusBack;

  const area = ({ x, y, w, h }) => `grid-column:${x + 1}/span ${w};grid-row:${y + 1}/span ${h}`;
  const title = item => Object.hasOwn(model.modules, item.module) ? model.modules[item.module].name : 'Unavailable module';
  const move = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
  const action = (id, text, disabled = false) => `<button type="button" class="g5btn" data-layout-action="${id}" ${disabled ? 'disabled' : ''}>${text}</button>`;
  const option = (id, name, current) => `<option value="${esc(id)}" ${id === current ? 'selected' : ''}>${esc(name)}</option>`;
  const tabs = current => `<nav class="run-layout-tabs" aria-label="Layout Manager">${[['sets', 'Run Page Sets'], ['pages', 'All Run Pages'], ['bars', 'Shortcut Bars']].map(([id, label]) =>
    `<button type="button" class="g5btn ${id === current ? 'on' : ''}" data-layout-tab="${id}" ${id === current ? 'aria-current="page"' : ''}>${label}</button>`).join('')}</nav>`;
  const labels = entries => entries.map(([label, value]) => `<span>${esc(label)}</span><b>${esc(value ?? '—')}</b>`).join('');
  const count = (value, format) => Number.isFinite(value) ? format(value) : '—';

  const readouts = {
    location: () => [['Field', $('locName').textContent], ['Context', $('locSub').textContent]],
    workState: d => [['Recording', d.work ? (d.work.recording ? 'On' : 'Off') : '—'],
      ['Work areas', d.implements?.some(i => i.areas?.some(Boolean)) ? 'Active' : d.implements?.some(i => i.areas?.length) ? 'Inactive' : '—'],
      ['Speed', count(d.vehicle?.speed, n => `${fmt(U.speed(n), 1)} ${U.speedUnit()}`)]],
    counters: d => [['Area', count(d.work?.area, n => `${fmt(U.area(n), 2)} ${U.areaUnit()}`)],
      ['Time', count(d.work?.time, hms)], ['Distance', count(d.work?.distance, U.dist)]],
    implement: d => (d.implements?.length ? d.implements.slice(0, 3).map(i => [i.name, i.width > 0 ? U.width(i.width) : '—']) : [['Equipment', 'None']]),
    track: () => [['Track', $('trkName').textContent], ['Spacing', $('trkSpacing').textContent]],
  };
  const tools = {
    location: [['appBoundary', 'Boundary'], ['appWorkSetup', 'Work Setup']],
    track: [['setTrackBtn', 'Set Track'], ['spacingBtn', 'Track Spacing'], ['shift-left', '◀', 'Shift left'], ['shift-center', '●', 'Center track'], ['shift-right', '▶', 'Shift right']],
  };

  function mount(page, data) {
    if (mounted === page) return;
    if (map.parentElement === modules) {
      mapHome.after(map);
      map.style.removeProperty('grid-column');
      map.style.removeProperty('grid-row');
    }
    mounted = page;
    $('customRunPage').classList.toggle('active', !!page);
    setHtml(modules, page ? page.modules.filter(item => item.module !== 'map').map(item => {
      const buttons = (Object.hasOwn(tools, item.module) ? tools[item.module] : []).map(([id, label, name]) =>
        `<button type="button" class="g5btn" data-run-control="${id}" ${name ? `aria-label="${name}"` : ''}>${label}</button>`).join('');
      return `<section class="module run-module" style="${area(item)}"><h2 class="mod-title">${title(item)}</h2>
        <div class="run-values" data-run-module="${item.module}"></div>${buttons ? `<div class="run-tools ${item.module === 'track' ? 'run-track-tools' : ''}">${buttons}</div>` : ''}</section>`;
    }).join('') : '');
    const position = page?.modules.find(item => item.module === 'map');
    if (position) {
      map.style.gridColumn = `${position.x + 1}/span ${position.w}`;
      map.style.gridRow = `${position.y + 1}/span ${position.h}`;
      modules.prepend(map);
    }
    render(data);
  }

  function render(data) {
    if (!mounted) return;
    const hasVehicle = data.link === 'live' && data.state === 'vehicle' && data.vehicle;
    for (const region of modules.querySelectorAll('[data-run-module]')) {
      const id = region.dataset.runModule;
      const read = Object.hasOwn(readouts, id) ? readouts[id] : null;
      const needsVehicle = id === 'workState' || id === 'counters' || id === 'implement';
      setHtml(region, read ? (needsVehicle && !hasVehicle ? '<span>Waiting for live vehicle data</span>' : labels(read(data))) : '<span>This module is unavailable in this version.</span>');
    }
  }
  modules.onclick = e => {
    const id = e.target.closest('[data-run-control]')?.dataset.runControl;
    const shifts = { 'shift-left': '-1', 'shift-center': '0', 'shift-right': '1' };
    if (Object.hasOwn(shifts, id)) document.querySelector(`[data-shift="${shifts[id]}"]`)?.click();
    else if (id) $(id)?.click();
  };

  function open(section = 'sets') {
    if ($('runLayoutWin').hidden && $('keysWin').hidden) focusBack = document.activeElement;
    closeWin('menu');
    closeWin('keysWin');
    view = section;
    machine = pageType || 'tractor';
    selected = section === 'sets' ? model.activeSet(settings.runPages, machine).id || `factory:${machine}` : settings.pageName;
    draft = null;
    block = null;
    message = '';
    openWin('runLayoutWin');
    paint();
    body.querySelector(`[data-layout-tab="${view}"]`).focus();
  }

  function endDraft() {
    draft = null;
    block = null;
    message = '';
    paint();
    body.querySelector(`[data-layout-tab="${view}"]`)?.focus();
  }

  function close() {
    closeWin('runLayoutWin');
    endDraft();
    if (focusBack && focusBack.getClientRects().length) focusBack.focus();
    else $('menuBtn').focus();
  }

  const newId = prefix => `${prefix}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const allPageIds = () => [...pageNames, ...settings.runPages.pages.map(p => p.id)];
  const activeSet = () => model.activeSet(settings.runPages, machine);
  function saveState(target) {
    settings.runPages = model.normalize(settings.runPages);
    applyRunPageSet(target);
  }
  const setPageName = id => allPageIds().includes(id) ? pageLabel(id) : 'Unavailable page';
  const selectedSet = () => selected?.startsWith('factory:') ? model.factory[selected.slice(8)] : settings.runPages.sets.find(set => set.id === selected);
  const entries = (items, current) => `<div class="run-library">${items.map(([id, name, detail]) =>
    `<button type="button" class="run-entry ${id === current ? 'on' : ''}" data-layout-select="${esc(id)}" aria-pressed="${id === current}"><b>${esc(name)}</b><small>${esc(detail)}</small></button>`).join('')}</div>`;

  function listSets() {
    const current = selectedSet();
    const factory = Object.entries(model.factory).map(([type, set]) => [`factory:${type}`, set.name, 'Stock set']);
    const sets = settings.runPages.sets.map(set => [set.id, set.name, `${set.pages.length} run pages`]);
    const active = activeSet() === current;
    const bar = current && current.bar === 'auto' ? 'Automatic' : G5Keys.bars().find(b => b.id === current?.bar)?.name || 'Machine default';
    return `<div class="run-layout-columns"><aside><label class="run-field">Set for<select id="runMachine">${Object.entries(model.factory).map(([type, set]) => option(type, set.name, machine)).join('')}</select></label>
      ${entries([...factory, ...sets], selected)}${action('new-set', 'New Set')}</aside>
      <section class="run-layout-details">${current ? `<h2>${esc(current.name)}</h2><p>Shortcut bar · ${esc(bar)}</p>
      <ol class="run-order">${current.pages.map(id => `<li>${esc(setPageName(id))}</li>`).join('')}</ol>
      <div class="run-actions">${action('use-set', active ? 'In Use' : 'Use This Set', active)}${action('duplicate-set', 'Duplicate')}${current.id ? action('edit-set', 'Edit Set') : ''}</div>` : ''}</section></div>`;
  }

  function listPages() {
    const page = customPage(selected);
    const isStock = pageNames.includes(selected);
    const items = allPageIds().map(id => [id, pageLabel(id), customPage(id) ? 'Custom page' : 'Stock page']);
    return `<div class="run-layout-columns"><aside>${entries(items, selected)}${action('new-page', 'New Page')}</aside><section class="run-layout-details">
      ${isStock || page ? `<h2>${esc(pageLabel(selected))}</h2>${preview(page?.modules || model.template(selected), false)}
      <div class="run-actions">${action('open-page', 'Open Page', isStock && !supportedStock.includes(selected))}${action('duplicate-page', 'Duplicate')}${page ? action('edit-page', 'Edit Page') : ''}</div>` : ''}</section></div>`;
  }

  function preview(placements, editable) {
    const cells = editable ? Array.from({ length: model.rows * model.columns }, (_, i) => {
      const x = i % model.columns, y = Math.floor(i / model.columns);
      return `<button type="button" class="run-cell" tabindex="-1" data-cell="${x},${y}" style="${area({ x, y, w: 1, h: 1 })}" aria-label="Column ${x + 1}, row ${y + 1}"></button>`;
    }).join('') : '';
    return `<div class="run-grid run-preview ${editable ? 'editable' : ''}" ${editable ? 'id="runPreview"' : ''}>${cells}${placements.map(item => {
      const label = title(item);
      return editable ? `<button type="button" draggable="true" class="run-block ${block === item.id ? 'on' : ''}" aria-pressed="${block === item.id}" data-block="${item.id}" style="${area(item)}">${label}</button>`
        : `<div class="run-block" style="${area(item)}">${label}</div>`;
    }).join('')}</div>`;
  }

  function editPage() {
    const item = draft.modules.find(p => p.id === block);
    const sizes = item && Object.hasOwn(model.modules, item.module) ? model.modules[item.module].sizes : {};
    return `<div class="run-layout-columns run-edit-columns"><aside><h2>Modules</h2><div class="run-library">
      ${Object.entries(model.modules).map(([id, entry]) => `<button type="button" class="run-entry" data-add-module="${id}" ${draft.modules.some(p => p.module === id) ? 'disabled' : ''}>
        <b>${entry.name}</b><small>${entry.description}</small><span>${Object.values(entry.sizes).map(([w, h]) => `${w} × ${h}`).join(' · ')}</span></button>`).join('')}
    </div></aside><section class="run-layout-details"><label class="run-field">Page name<input id="runDraftName" maxlength="60" value="${esc(draft.name)}"></label>
      ${preview(draft.modules, true)}<p class="run-layout-message" role="status">${esc(message || 'Select a module, then tap a cell or use the arrow keys to move it.')}</p>
      <div class="run-actions">${item ? `<label class="run-field inline">Size<select id="runSize" ${Object.keys(sizes).length ? '' : 'disabled'}>${Object.entries(sizes).map(([name, [w, h]]) => option(name, `${w} × ${h}`, item.variant)).join('')}</select></label>
      ${Object.keys(move).map(id => `<button type="button" class="g5btn" data-run-move="${id}" aria-label="Move ${id}">${{ left: '←', right: '→', up: '↑', down: '↓' }[id]}</button>`).join('')}${action('remove-module', 'Remove')}` : ''}</div>
      <div class="run-actions end">${action('cancel', 'Cancel')}${action('save-page', 'Save Page', !draft.modules.length)}</div></section></div>`;
  }

  function editSet() {
    const add = allPageIds().filter(id => !draft.pages.includes(id));
    const assigned = [['', 'Machine default'], ['auto', 'Automatic'], ...G5Keys.bars().map(b => [b.id, b.name])];
    if (draft.bar && !assigned.some(([id]) => id === draft.bar)) assigned.push([draft.bar, 'Unavailable shortcut bar']);
    return `<div class="run-layout-details run-set-editor"><label class="run-field inline">Set name<input id="runDraftName" maxlength="60" value="${esc(draft.name)}"></label>
      <label class="run-field inline">Shortcut bar<select id="runSetBar">${assigned.map(([id, name]) => option(id, name, draft.bar || '')).join('')}</select></label>
      <ol class="run-order editable">${draft.pages.map((id, i) => `<li><b>${esc(setPageName(id))}</b><span>
        <button type="button" class="g5btn" data-set-move="up" data-index="${i}" aria-label="Move ${esc(setPageName(id))} earlier" ${i ? '' : 'disabled'}>↑</button>
        <button type="button" class="g5btn" data-set-move="down" data-index="${i}" aria-label="Move ${esc(setPageName(id))} later" ${i + 1 < draft.pages.length ? '' : 'disabled'}>↓</button>
        <button type="button" class="g5btn" data-set-move="remove" data-index="${i}" aria-label="Remove ${esc(setPageName(id))}">Remove</button></span></li>`).join('')}</ol>
      <div class="run-actions"><label class="run-field inline">Add page<select id="runSetAdd" ${add.length ? '' : 'disabled'}>${option('', 'Choose a run page', '')}${add.map(id => option(id, pageLabel(id))).join('')}</select></label></div>
      <div class="run-actions end">${action('cancel', 'Cancel')}${action('save-set', 'Save Set', !draft.pages.length)}</div></div>`;
  }

  function paint() {
    setHtml(body, tabs(view) + (view === 'sets' ? (draft ? editSet() : listSets()) : (draft ? editPage() : listPages())));
  }

  function startDraft(source, duplicate) {
    const page = view === 'pages';
    const base = page ? { name: 'Custom Run Page', modules: [] } : { name: 'Custom Set', pages: [], bar: null };
    draft = JSON.parse(JSON.stringify(source || base));
    if (!draft.id || duplicate) draft.id = newId(page ? 'custom' : 'set');
    if (duplicate) draft.name = `${draft.name.slice(0, 55)} copy`;
    message = '';
    block = null;
    paint();
    $('runDraftName').focus();
  }

  function place(id, updates) {
    const index = draft.modules.findIndex(item => item.id === id);
    if (index < 0) return;
    const candidate = { ...draft.modules[index], ...updates };
    message = '';
    if (model.fits(draft, candidate)) draft.modules[index] = candidate;
    else message = 'That position overlaps another module or extends past the grid.';
    paint();
    body.querySelector(`[data-block="${id}"]`)?.focus({ preventScroll: true });
  }

  function nudge(item, direction) {
    const [dx, dy] = move[direction];
    place(item.id, { x: item.x + dx, y: item.y + dy });
  }

  const actions = {
    'new-page': () => startDraft(),
    'new-set': () => startDraft(),
    'edit-page': () => startDraft(customPage(selected)),
    'edit-set': () => startDraft(selectedSet()),
    'duplicate-page': () => startDraft(customPage(selected) || { name: pageLabel(selected), modules: model.template(selected) }, true),
    'duplicate-set': () => startDraft({ ...selectedSet(), pages: selectedSet().pages.filter(id => allPageIds().includes(id) || !selected.startsWith('factory:')) }, true),
    'open-page': () => { close(); showPage(selected); },
    'use-set': () => {
      const current = selectedSet();
      if (current.id) settings.runPages.byType[machine] = current.id;
      else if (selected === `factory:${machine}`) delete settings.runPages.byType[machine];
      else {
        const set = { ...current, id: newId('set'), bar: null };
        settings.runPages.sets.push(set);
        settings.runPages.byType[machine] = set.id;
        selected = set.id;
      }
      saveState(machine === pageType ? undefined : settings.pageName);
      paint();
    },
    'remove-module': () => { draft.modules = draft.modules.filter(item => item.id !== block); block = null; message = ''; paint(); },
    'save-page': () => commit('pages'),
    'save-set': () => commit('sets'),
    cancel: endDraft,
  };

  function commit(collection) {
    if (!draft.name.trim()) { $('runDraftName').focus(); return; }
    const items = settings.runPages[collection];
    const index = items.findIndex(item => item.id === draft.id);
    if (index < 0) items.push(draft);
    else items[index] = draft;
    selected = draft.id;
    const currentSetChanged = collection === 'sets' && model.activeSet(settings.runPages, pageType)?.id === selected;
    saveState(currentSetChanged && !draft.pages.includes(settings.pageName) ? undefined : settings.pageName);
    endDraft();
  }

  $('runLayoutWin').addEventListener('click', e => {
    if (e.target.id === 'runLayoutWin' || e.target.closest('[data-close="runLayoutWin"]')) close();
  });
  body.addEventListener('input', e => {
    if (e.target.id === 'runDraftName') draft.name = e.target.value;
  });
  body.addEventListener('change', e => {
    const { id, value } = e.target;
    if (id === 'runMachine') { machine = value; selected = activeSet().id || `factory:${value}`; paint(); $('runMachine').focus(); }
    if (id === 'runSize') { const [w, h] = model.footprint(draft.modules.find(item => item.id === block).module, value); place(block, { variant: value, w, h }); }
    if (id === 'runSetBar') draft.bar = value || null;
    if (id === 'runSetAdd' && value) { draft.pages.push(value); paint(); $('runSetAdd').focus(); }
  });
  body.addEventListener('click', e => {
    const button = e.target.closest('button');
    if (!button || button.disabled) return;
    const { layoutTab, layoutSelect, layoutAction, addModule, cell, runMove, setMove, index } = button.dataset;
    const hit = button.dataset.block;
    if (layoutTab && layoutTab !== view) { if (layoutTab === 'bars') G5Keys.openManager(); else open(layoutTab); return; }
    if (layoutSelect) { selected = layoutSelect; paint(); body.querySelector(`[data-layout-select="${layoutSelect}"]`)?.focus(); return; }
    if (layoutAction) { actions[layoutAction](); return; }
    if (hit) { block = hit; message = ''; paint(); body.querySelector(`[data-block="${hit}"]`).focus(); return; }
    if (cell && block) { const [x, y] = cell.split(',').map(Number); place(block, { x, y }); return; }
    if (runMove) { nudge(draft.modules.find(item => item.id === block), runMove); return; }
    if (addModule) {
      const variants = Object.keys(model.modules[addModule].sizes);
      const item = variants.map(size => model.firstFit(draft, addModule, size, `module:${addModule}`)).find(Boolean);
      if (item) { draft.modules.push(item); block = item.id; message = ''; }
      else message = 'No available position for this module.';
      paint();
      if (item) body.querySelector(`[data-block="${item.id}"]`).focus();
      return;
    }
    if (setMove) {
      const target = Number(index);
      const [page] = draft.pages.splice(target, 1);
      if (setMove !== 'remove') draft.pages.splice(target + (setMove === 'up' ? -1 : 1), 0, page);
      paint();
    }
  });
  body.addEventListener('keydown', e => {
    const item = draft?.modules?.find(p => p.id === e.target.dataset.block);
    const direction = e.key.startsWith('Arrow') ? e.key.slice(5).toLowerCase() : '';
    if (item && Object.hasOwn(move, direction)) { e.preventDefault(); block = item.id; nudge(item, direction); }
    if (e.key === 'Escape') { e.preventDefault(); if (draft) endDraft(); else close(); }
  });
  body.addEventListener('dragstart', e => {
    const id = e.target.dataset.block;
    if (!id) return;
    dragged = id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  });
  body.addEventListener('dragend', () => { dragged = null; });
  body.addEventListener('dragover', e => { if (dragged && e.target.closest('#runPreview')) e.preventDefault(); });
  body.addEventListener('drop', e => {
    const grid = e.target.closest('#runPreview');
    if (!dragged || !grid) return;
    e.preventDefault();
    const rect = grid.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / rect.width * model.columns);
    const y = Math.floor((e.clientY - rect.top) / rect.height * model.rows);
    block = dragged;
    dragged = null;
    place(block, { x, y });
  });

  window.G5RunPages = { open, close, mount, render, tabs, hasMap: () => map.parentElement === modules,
    shortcutBar: () => model.activeSet(settings.runPages, pageType || 'tractor').bar };
  showPage(settings.pageName);
})();
