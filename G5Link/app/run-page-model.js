'use strict';

(function () {
  const columns = 12;
  const rows = 6;
  const modules = {
    map: { name: 'Guidance Map', description: 'The live track, field and coverage map.', sizes: { wide: [9, 6], medium: [8, 4] } },
    location: { name: 'Location & Boundary', description: 'The current field and access to the boundary recorder.', sizes: { compact: [3, 2], wide: [4, 2] } },
    workState: { name: 'Work State', description: 'Recording status, implement activity and speed.', sizes: { compact: [3, 2], wide: [4, 2] } },
    counters: { name: 'Work Counters', description: 'Area, time and distance since the counter reset.', sizes: { compact: [3, 2], wide: [4, 2] } },
    implement: { name: 'Implement Summary', description: 'Attached equipment, working width and availability.', sizes: { compact: [3, 2], wide: [4, 2] } },
    track: { name: 'Track Controls', description: 'The selected track, spacing and shift controls.', sizes: { compact: [3, 2], wide: [4, 2] } },
  };
  const factory = {
    tractor: { name: 'Tractor', pages: ['Guidance', 'Tractor', 'Work Monitor', 'Implement Details', 'Machine Monitor', 'Field'] },
    tillage: { name: 'Tillage', pages: ['Guidance', 'Tillage', 'Work Monitor', 'Implement Details', 'Tractor'] },
    seeder: { name: 'Planting & Drilling', pages: ['Guidance', 'Planter', 'Section Control', 'Work Monitor', 'Implement Details'] },
    combine: { name: 'Harvest', pages: ['Harvesting', 'Work Monitor', 'Harvest Automation', 'Harvest Logistics', 'Guidance'] },
    sprayer: { name: 'Spraying', pages: ['Guidance', 'Spraying', 'Boom & Sections', 'Work Monitor', 'Implement Details'] },
  };
  const defaults = value => value && typeof value === 'object' ? value : {};
  const list = value => Array.isArray(value) ? value : [];
  const string = (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim().slice(0, 60) : fallback;
  const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,80}$/.test(value);

  function footprint(module, variant) {
    const sizes = Object.hasOwn(modules, module) ? modules[module].sizes : null;
    return sizes && Object.hasOwn(sizes, variant) ? sizes[variant] : null;
  }

  function fits(page, candidate) {
    const { x, y, w, h } = candidate;
    if (![x, y, w, h].every(Number.isInteger) || x < 0 || y < 0 || w < 1 || h < 1 || x + w > columns || y + h > rows) return false;
    return !page.modules.some(other => other.id !== candidate.id && x < other.x + other.w && x + w > other.x
      && y < other.y + other.h && y + h > other.y);
  }

  function firstFit(page, module, variant, id) {
    const size = footprint(module, variant);
    if (!size || page.modules.some(placed => placed.module === module)) return null;
    const [w, h] = size;
    for (let y = 0; y <= rows - h; y++) {
      for (let x = 0; x <= columns - w; x++) {
        const candidate = { id, module, variant, x, y, w, h };
        if (fits(page, candidate)) return candidate;
      }
    }
    return null;
  }

  function normalize(raw) {
    const source = defaults(raw);
    const state = { version: 1, pages: [], sets: [], byType: {}, lastPage: {} };
    for (const item of list(source.pages)) {
      if (!item || !identifier(item.id) || !item.id.startsWith('custom:') || state.pages.some(page => page.id === item.id)) continue;
      const page = { id: item.id, name: string(item.name, 'Custom Run Page'), modules: [] };
      for (const placed of list(item.modules)) {
        if (!placed || !identifier(placed.id) || !identifier(placed.module) || !identifier(placed.variant)
          || page.modules.some(module => module.id === placed.id || module.module === placed.module)) continue;
        const size = footprint(placed.module, placed.variant);
        const candidate = { id: placed.id, module: placed.module, variant: placed.variant, x: placed.x, y: placed.y,
          w: size ? size[0] : placed.w, h: size ? size[1] : placed.h };
        if (fits(page, candidate)) page.modules.push(candidate);
      }
      state.pages.push(page);
    }
    for (const item of list(source.sets)) {
      if (!item || !identifier(item.id) || !item.id.startsWith('set:') || state.sets.some(set => set.id === item.id)) continue;
      const seen = new Set(list(item.pages).filter(page => typeof page === 'string' && page.length > 0 && page.length <= 80));
      state.sets.push({ id: item.id, name: string(item.name, 'Custom Set'), pages: [...seen],
        bar: identifier(item.bar) ? item.bar : null });
    }
    for (const type of Object.keys(factory)) {
      const id = source.byType?.[type];
      if (state.sets.some(set => set.id === id)) state.byType[type] = id;
      const last = source.lastPage?.[type];
      if (typeof last === 'string' && last.length <= 80) state.lastPage[type] = last;
    }
    return state;
  }

  function activeSet(state, type) {
    return state.sets.find(set => set.id === state.byType[type]) || factory[type] || factory.tractor;
  }

  function order(state, type, supported) {
    const set = activeSet(state, type);
    const result = set.pages.filter(id => supported.includes(id) || state.pages.some(page => page.id === id));
    if (!result.includes('Guidance') && supported.includes('Guidance')) result.push('Guidance');
    return result;
  }

  function template(id) {
    const guidance = [['map', 'wide', 0, 0], ['location', 'compact', 9, 0], ['track', 'compact', 9, 2], ['counters', 'compact', 9, 4]];
    const work = [['map', 'medium', 0, 0], ['workState', 'wide', 8, 0], ['implement', 'wide', 8, 2], ['counters', 'wide', 8, 4]];
    const layout = id === 'Guidance' ? guidance : work;
    return layout.map(([module, variant, x, y]) => {
      const [w, h] = footprint(module, variant);
      return { id: `module:${module}`, module, variant, x, y, w, h };
    });
  }

  const api = { columns, rows, modules, factory, footprint, fits, firstFit, normalize, activeSet, order, template };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.G5RunPageModel = api;
})();
