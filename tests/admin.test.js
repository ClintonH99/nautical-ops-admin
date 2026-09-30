const { test } = require('node:test');
const assert = require('node:assert/strict');
const { database, loadHandler, invoke, browser, ID } = require('./helpers');
const { subscriptionMetrics } = require('../lib/metrics');
const now = new Date('2026-09-30T12:00:00Z');
const future = '2099-01-01T00:00:00Z';
const baseSub = { id: ID, vessel_id: ID, status: 'active', plan_tier: '6_10', billing_period: '12_months', current_period_end: future };
const fixture = () => ({
  users: ['CAPTAIN_MOV','HOD','CREW'].map((role,i) => ({ id: String(i), role, vessel_id: ID, name: role, created_at: new Date().toISOString() })),
  vessels: [{id: ID, name:'Test boat', created_at: new Date().toISOString()}], vessel_subscriptions: [baseSub],
  trips:[{id:ID}], maintenance_logs:[{id:ID}], vessel_tasks:[{id:ID}], deleted_users:[],
});
for (const name of ['data','expenses','faq','updates','sentry']) {
  test(name + ': unauthorized and unsupported requests cannot reach the database', async () => {
    const db = database(); const handler = loadHandler(name, db);
    assert.equal((await invoke(handler,'GET',null,'wrong')).code,401);
    assert.equal((await invoke(handler,'PATCH')).code,405);
    assert.equal((await invoke(handler,'OPTIONS')).code,204);
    assert.equal(db.calls.length,0);
  });
}
test('dashboard role mapping, captain identity, totals and narrow subscription fields', async () => {
  const db=database(fixture()); const res=await invoke(loadHandler('data',db));
  assert.equal(res.code,200);assert.equal(res.body.overview.totalCaptains,1);assert.equal(res.body.overview.totalHods,1);assert.equal(res.body.overview.totalCrew,1);
  assert.equal(res.body.vessels[0].captain,'CAPTAIN_MOV');assert.equal(res.body.overview.mrr,80.75);
  assert.equal(res.headers['Cache-Control'],'private, no-store');
  assert.ok(!db.calls.find(x=>x.table==='vessel_subscriptions').columns.includes('token'));
});
test('dashboard retrieves more than the default 1000-row cap', async () => {
  const seed=fixture();seed.users=Array.from({length:1203},(_,i)=>({id:String(i).padStart(5,'0'),role:'CREW',created_at:new Date().toISOString()}));
  const res=await invoke(loadHandler('data',database(seed)));assert.equal(res.body.overview.totalUsers,1203);
});
for(const table of ['users','vessels','vessel_subscriptions','trips','maintenance_logs','vessel_tasks','deleted_users']) {
  test('dashboard reports failure instead of false zero for '+table, async()=>{
    const res=await invoke(loadHandler('data',database(fixture(), op=>op.table===table)));assert.equal(res.code,500);assert.equal(res.body.overview,undefined);
  });
}
test('estimates use exact app price divided by billing months',()=>{
  assert.equal(subscriptionMetrics(baseSub,now).mrr,969/12);
  assert.equal(subscriptionMetrics({...baseSub,plan_tier:'11_15',billing_period:'monthly'},now).mrr,119);
  assert.equal(subscriptionMetrics({...baseSub,plan_tier:'40_plus'},now).estimatedMonthly,null);
});
for(const status of ['trialing','canceled','past_due','revoked']) test(status+' is not counted as active MRR',()=>{
  const m=subscriptionMetrics({...baseSub,status},now);assert.equal(m.mrr,0);assert.equal(m.isActive,false);
  if(status==='trialing') assert.equal(m.trialMrr,969/12);
});
test('stale active rows need verification, not inclusion in revenue',()=>{
  const m=subscriptionMetrics({...baseSub,current_period_end:'2020-01-01'},now);assert.equal(m.mrr,0);assert.equal(m.displayStatus,'needs verification');
});
test('expense create/edit/delete round trip uses UUID and correct database fields',async()=>{
  const db=database();const h=loadHandler('expenses',db);
  assert.equal((await invoke(h,'POST',{name:' Hosting ',amount:'25.50',period:'monthly'})).code,200);
  assert.equal(db.tables.expenses[0].payment_type,'monthly');assert.equal(db.tables.expenses[0].amount,25.5);
  assert.equal((await invoke(h,'PUT',{id:ID,name:'Hosting',amount:30,period:'annual'})).code,200);
  assert.equal(db.tables.expenses[0].amount,30);
  assert.equal((await invoke(h,'DELETE',{id:ID})).code,200);assert.equal(db.tables.expenses.length,0);
  assert.equal((await invoke(h,'DELETE',{id:ID})).code,404);
});
for(const amount of ['12abc',-1,0,null,true,'Infinity']) test('rejects invalid expense amount '+amount,async()=>{
  const db=database();assert.equal((await invoke(loadHandler('expenses',db),'POST',{name:'Test',amount,period:'monthly'})).code,400);assert.equal(db.calls.length,0);
});
test('expense empty name, bad period and missing body are rejected',async()=>{
  const h=loadHandler('expenses',database());
  for(const body of [undefined,{name:' ',amount:1,period:'monthly'},{name:'a',amount:1,period:'daily'}]) assert.equal((await invoke(h,'POST',body)).code,400);
});
test('FAQ create, edit and answer write to the same tables read by the mobile app',async()=>{
  const db=database({user_questions:[{id:ID,status:'pending'}]});const h=loadHandler('faq',db);
  assert.equal((await invoke(h,'POST',{question:"What's new?",answer:'Safe <text>'})).code,200);
  assert.equal((await invoke(h,'POST',{id:ID,question:'Changed?',answer:'Updated'})).code,200);
  assert.equal(db.tables.faqs[0].answer,'Updated');
  assert.equal((await invoke(h,'POST',{type:'answer_question',id:ID,answer:'Reply'})).code,200);
  assert.equal(db.tables.user_questions[0].status,'answered');assert.equal(db.tables.user_questions[0].answer,'Reply');
});
test('FAQ read errors and unmatched mutations are not successes',async()=>{
  assert.equal((await invoke(loadHandler('faq',database({},op=>op.table==='faqs')))).code,500);
  assert.equal((await invoke(loadHandler('faq',database()),'POST',{id:ID,question:'Q',answer:'A'})).code,404);
  assert.equal((await invoke(loadHandler('faq',database()),'POST',{question:' ',answer:'A'})).code,400);
});
test('updates create/release/delete round trip and server-controlled release date',async()=>{
  const db=database();const h=loadHandler('updates',db);
  assert.equal((await invoke(h,'POST',{title:'Feature',description:'Detail'})).code,200);assert.equal(db.tables.app_updates[0].released_at,null);
  assert.equal((await invoke(h,'PUT',{id:ID,status:'released',released_at:'garbage'})).code,200);assert.ok(Number.isFinite(Date.parse(db.tables.app_updates[0].released_at)));
  assert.equal((await invoke(h,'DELETE',{id:ID})).code,200);assert.equal((await invoke(h,'DELETE',{id:ID})).code,404);
  assert.equal((await invoke(h,'POST',{title:'a',description:'b',status:'invalid'})).code,400);
});
for(const name of ['expenses','updates']) test(name+' database errors are reported',async()=>{
  assert.equal((await invoke(loadHandler(name,database({},()=>true)))).code,500);
});
test('Sentry exposes bounded/lifetime count caveat and upstream errors safely',async()=>{
  const h=loadHandler('sentry',database(),{fetch:async()=>({ok:true,headers:{get:()=>'<next>; rel="next"; results="true"'},json:async()=>[{id:'1',count:'2',userCount:1,status:'unresolved'}]})});
  const r=await invoke(h);assert.equal(r.code,200);assert.equal(r.body.hasMore,true);assert.equal(r.body.summary.events,2);assert.match(r.body.countNotice,/lifetime/);
  const bad=await invoke(loadHandler('sentry',database(),{fetch:async()=>({ok:false,status:403})}));assert.equal(bad.code,502);assert.equal(bad.body.detail,undefined);
});
test('all dashboard renderers escape user-entered markup',async()=>{
  const seed=fixture();seed.users[0].name='<img src=x onerror=alert(1)>';seed.vessels[0].name='<script>oops</script>';
  const res=await invoke(loadHandler('data',database(seed)));const b=browser();b.ctx.fixture=res.body;b.run('dashData=fixture;renderAll();renderFourOceans();');
  for(const id of ['overview-content','vessels-content','users-content','subscriptions-content','fouroceans-content']) {assert.ok(b.elements[id].innerHTML);assert.doesNotMatch(b.elements[id].innerHTML,/<img|<script>/);}
  assert.match(b.elements['users-content'].innerHTML,/&lt;img/);assert.match(b.elements['fouroceans-content'].innerHTML,/Not tracked/);
});
test('FAQ apostrophes no longer break Edit handler and values remain unchanged',()=>{
  const b=browser();b.ctx.sample={faqs:[{id:ID,question:"What's <new>?",answer:"Captain's % note",display_order:1}],questions:[{id:ID,question:'<img src=x>',status:'pending'}]};
  b.run('faqData=sample;renderFAQ();');assert.match(b.elements['faq-content'].innerHTML,/editFAQByIndex\(0\)/);assert.doesNotMatch(b.elements['faq-content'].innerHTML,/<img/);
  const prompts=[];b.ctx.prompt=(label,value)=>{prompts.push(value);return null;};b.run('editFAQByIndex(0)');assert.equal(prompts[0],"What's <new>?");
});
test('expense buttons pass complete quoted UUIDs and render escaped names',async()=>{
  const b=browser(async()=>({ok:true,status:200,json:async()=>[{id:ID,name:'<img src=x>',amount:25,payment_type:'monthly'}]}));
  b.run('dashData={overview:{mrr:0,trialMrr:0,activeSubscriptions:0}};adminPassword="test";');await b.run('renderAccounting()');
  assert.match(b.elements['accounting-content'].innerHTML,/editExpense\(&quot;11111111-1111-4111-8111-111111111111&quot;\)/);assert.doesNotMatch(b.elements['accounting-content'].innerHTML,/<img/);
  let received;b.ctx.editExpense=id=>{received=id;};b.run('editExpense("'+ID+'")');assert.equal(received,ID);
});
test('failed expense request displays unavailable rather than fake zero profit',async()=>{
  const b=browser(async()=>({ok:false,status:500,json:async()=>({error:'Failed'})}));b.run('adminPassword="test";');await b.run('renderAccounting()');assert.match(b.elements['accounting-content'].innerHTML,/unavailable/);assert.doesNotMatch(b.elements['accounting-content'].innerHTML,/Net Monthly/);
});
test('failed dashboard refresh preserves last successful data',async()=>{
  const b=browser(async()=>({ok:false,status:500,json:async()=>({error:'Failed'})}));b.run('adminPassword="test";dashData={sentinel:true}');await b.run('loadData()');assert.equal(b.run('dashData.sentinel'),true);assert.equal(b.alerts.length,1);
});
test('unauthorized response signs out and clears cached personal data',async()=>{
  const b=browser(async()=>({ok:false,status:401}));b.run('adminPassword="old";dashData={};faqData={};');await b.run('loadData()');assert.equal(b.run('adminPassword'),'');assert.equal(b.run('dashData'),null);assert.equal(b.run('faqData'),null);
});
test('late login response cannot reopen a signed-out session',async()=>{
  let complete;const b=browser(()=>new Promise(resolve=>complete=resolve));b.run('adminPassword="test"');const pending=b.run('loadData(true)');b.run('handleLogout()');complete({ok:true,status:200,json:async()=>({overview:{},users:[],vessels:[],subscriptions:[]})});await pending;assert.equal(b.elements.app.style.display,'none');assert.equal(b.run('dashData'),null);
});
test('duplicate in-flight writes only send one request',async()=>{
  let complete,calls=0;const b=browser(()=>{calls++;return new Promise(resolve=>complete=resolve);});const pending=b.run('apiRequest("/api/expenses",{method:"POST",body:"{}"})');await assert.rejects(b.run('apiRequest("/api/expenses",{method:"POST",body:"{}"})'),/progress/);complete({ok:true,status:200,json:async()=>({})});await pending;assert.equal(calls,1);
});
