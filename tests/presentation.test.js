const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, browser } = require('./helpers');
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

test('redesign retains the nine approved navigation destinations and callbacks', () => {
  for (const section of ['overview','vessels','users','subscriptions','faq','accounting','fouroceans','updates','errors']) {
    assert.ok(html.includes('showSection(\'' + section + '\',this)'));
    assert.ok(html.includes('id="section-' + section + '"'));
  }
  for (const callback of ['loadFAQData()', 'renderAccounting()', 'renderFourOceans()', 'loadUpdates()', 'loadErrors()', 'handleLogout()', 'loadData()']) assert.ok(html.includes(callback));
});

test('Activity is removed from navigation, markup and rendering', () => {
  assert.ok(!html.includes("showSection('activity'"));
  assert.ok(!html.includes('section-activity'));
  assert.ok(!html.includes('activity-content'));
  assert.ok(!html.includes('renderActivity'));
});

test('stylesheet and approved logo are included in Vercel static deployment', () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json')));
  for (const file of ['admin.css', 'vessel-logo.png']) {
    assert.ok(html.includes('/'+file));
    assert.ok(fs.existsSync(path.join(ROOT,'public',file)));
    assert.ok(config.builds.some(b=>b.src==='public/'+file && b.use==='@vercel/static'));
  }
  assert.ok(!config.builds.some(b=>b.src==='public/index.'));
});

test('navigation exposes a single current page to assistive technology', () => {
  const b=browser();
  b.run(`var oldNav=document.getElementById('old-nav');var newNav=document.getElementById('new-nav');oldNav.setAttribute('aria-current','page');document.querySelectorAll=()=>[oldNav,newNav];showSection('users',newNav)`);
  assert.equal(b.elements['old-nav'].attributes['aria-current'],undefined);
  assert.equal(b.elements['new-nav'].attributes['aria-current'],'page');
});

test('vessel expand and collapse retains crew data and reports expanded state', () => {
  const b=browser();
  b.run(`document.getElementById('vm-0').style.display='none';document.getElementById('vb-0');toggleVessel(0)`);
  assert.equal(b.elements['vm-0'].style.display,'table-row');
  assert.equal(b.elements['vb-0'].attributes['aria-expanded'],'true');
  b.run('toggleVessel(0)');
  assert.equal(b.elements['vm-0'].style.display,'none');
  assert.equal(b.elements['vb-0'].attributes['aria-expanded'],'false');
});
