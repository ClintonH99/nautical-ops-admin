const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const ID = '11111111-1111-4111-8111-111111111111';
function database(seed = {}, failure) {
  const tables = structuredClone(seed), calls = [];
  return {
    tables, calls,
    from(table) {
      const op = { table, method: 'read', filters: [], orders: [] };
      const query = {
        select(columns = '*', options) { op.columns = columns; op.options = options; return this; },
        order(key, options = {}) { op.orders.push([key, options.ascending !== false]); return this; },
        range(start, end) { op.range = [start, end]; return this; },
        limit(n) { op.range = [0, n - 1]; return this; },
        eq(key, value) { op.filters.push([key, value]); return this; },
        insert(row) { op.method = 'insert'; op.row = row; return this; },
        update(row) { op.method = 'update'; op.row = row; return this; },
        delete() { op.method = 'delete'; return this; },
        maybeSingle() { op.single = true; return this; },
        then(resolve, reject) {
          try {
            calls.push(op);
            if (failure && failure(op)) return Promise.resolve({ data: null, count: null, error: { code: 'TEST_FAILURE' } }).then(resolve, reject);
            let rows = tables[table] || [];
            if (op.method === 'insert') { const row = { id: ID, ...op.row }; rows.push(row); tables[table] = rows; rows = [row]; }
            else {
              rows = rows.filter(row => op.filters.every(([k, v]) => row[k] === v));
              if (op.method === 'update') rows.forEach(row => Object.assign(row, op.row));
              if (op.method === 'delete') tables[table] = (tables[table] || []).filter(row => !rows.includes(row));
            }
            const count = rows.length;
            rows = [...rows].sort((a, b) => {
              for (const [key, asc] of op.orders) if (a[key] !== b[key]) return (a[key] > b[key] ? 1 : -1) * (asc ? 1 : -1);
              return 0;
            });
            if (op.range) rows = rows.slice(op.range[0], op.range[1] + 1);
            if (op.columns && op.columns !== '*') rows = rows.map(row => Object.fromEntries(op.columns.split(',').map(k => [k.trim(), row[k.trim()]])));
            return Promise.resolve({ data: op.options?.head ? null : op.single ? (rows[0] || null) : rows, count, error: null }).then(resolve, reject);
          } catch (error) { return Promise.reject(error).then(resolve, reject); }
        },
      };
      return query;
    },
  };
}
function loadHandler(name, db, overrides = {}) {
  const cache = {};
  const context = vm.createContext({ console: { error() {} }, process: { env: { ADMIN_PASSWORD: 'test-only', SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-only', SENTRY_READ_TOKEN: 'test-only' } }, URL, AbortSignal, fetch: overrides.fetch });
  function load(file) {
    if (cache[file]) return cache[file].exports;
    const module = { exports: {} }; cache[file] = module;
    const fn = vm.runInContext('(function(require,module,exports){' + fs.readFileSync(file, 'utf8') + '\n})', context);
    fn(dep => dep === '@supabase/supabase-js' ? { createClient: () => db } : load(path.resolve(path.dirname(file), dep + '.js')), module, module.exports);
    return module.exports;
  }
  return load(path.join(ROOT, 'api', name + '.js'));
}
async function invoke(handler, method = 'GET', body, password = 'test-only') {
  const res = { code: 200, headers: {}, setHeader(k,v) { this.headers[k] = v; }, status(n) { this.code = n; return this; }, json(value) { this.body = JSON.parse(JSON.stringify(value)); return this; }, end() { return this; } };
  await handler({ method, headers: { 'x-admin-password': password }, body, query: {} }, res);
  return res;
}
function browser(fetch = async () => { throw new Error('No test response'); }) {
  const elements = {}, alerts = [];
  const element = id => elements[id] ||= { id, innerHTML: '', textContent: '', value: '', style: {}, attributes: {}, classList: { add() {}, remove() {} }, addEventListener() {}, setAttribute(k,v) { this.attributes[k]=v; }, removeAttribute(k) { delete this.attributes[k]; } };
  const document = { getElementById: element, querySelectorAll: selector => selector === '[id$="-content"]' ? Object.values(elements).filter(e => e.id.endsWith('-content')) : [], querySelector: selector => selector === '.section.active' ? element('section-overview') : element('nav') };
  const ctx = vm.createContext({ document, console, fetch, AbortSignal, alert: x => alerts.push(x), confirm: () => true, prompt: () => null });
  const source = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInContext(source, ctx);
  return { ctx, elements, alerts, run: code => vm.runInContext(code, ctx) };
}
module.exports = { ROOT, ID, database, loadHandler, invoke, browser };
