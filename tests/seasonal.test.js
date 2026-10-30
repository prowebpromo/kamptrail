'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{spawnSync}=require('node:child_process');
const D=require('../community-discovery.js');
const axes=values=>Object.fromEntries(Object.keys(D.AXES).map(k=>[k,values[k]||{}]));
const fixture=()=>({version:1,available:true,checked_at:'2026-10-30T12:00:00Z',basis:'calendar_visit_month_all_years',published_reviews:7,condition_reports:4,unreported_reviews:1,excluded_dates:1,invalid_observations:1,months:{'01':{reports:3,first_visit:'2025-01-20',latest_visit:'2026-01-05',axes:axes({noise:{quiet:2,noisy:1},shade:{partial:1},comfort:{comfortable:1,concerns:1}})},'07':{reports:1,first_visit:'2026-07-02',latest_visit:'2026-07-02',axes:axes({noise:{mixed:1},access:{moderate:1}})}}});
test('visit-month counts preserve exact calendar months, years, categories and omitted fields',()=>{
 const d=fixture(),now=Date.parse('2026-10-30T13:00:00Z');assert.equal(D.validMonthly(d),true);
 const january=D.monthlyView(d,'01',now);assert.equal(january.reports,3);assert.equal(january.first_visit,'2025-01-20');assert.equal(january.latest_visit,'2026-01-05');assert.deepEqual(january.axes.noise,{quiet:2,noisy:1});assert.deepEqual(january.axes.shade,{partial:1});assert.ok(!Object.hasOwn(january.axes,'signals'));
 const all=D.monthlyView(d,'',now);assert.equal(all.reports,4);assert.deepEqual(all.axes.noise,{quiet:2,noisy:1,mixed:1});assert.equal(D.monthlyView(d,'02',now).reports,0);assert.equal(D.monthlyView(d,'constructor',now).mode,'unavailable');
});
test('missing, malformed, partial, private, future and expired monthly evidence is unavailable',()=>{
 for(const mutate of [d=>d.months['01'].first_visit='2025-02-30',d=>d.months['01'].latest_visit='2026-02-05',d=>d.months['01'].latest_visit='2027-01-05',d=>d.months['01'].axes.noise.quiet=4,d=>d.months['01'].axes.comfort.safe=1,d=>delete d.months['01'].axes.noise,d=>d.condition_reports=99,d=>d.months['01'].body='private prose',d=>d.token='private code',d=>d.months['01'].axes.signals={strong:1},d=>d.checked_at='2026-02-30T12:00:00Z']){const d=fixture();mutate(d);assert.equal(D.validMonthly(d),false);}
 assert.equal(D.monthlyView(undefined).mode,'unavailable');assert.equal(D.monthlyView({version:1,available:false,reason:'limit'}).mode,'unavailable');assert.equal(D.monthlyView(fixture(),'',Date.parse('2026-11-07T12:00:00Z')).mode,'expired');assert.equal(D.monthlyView(fixture(),'',Date.parse('2026-10-29T12:00:00Z')).mode,'expired');
});
const php=spawnSync('php',['-v']).status===0;
if(process.env.KT_REQUIRE_PHP==='1'&&!php)throw new Error('PHP is required for seasonal producer checks.');
test('published grouped rows use visit dates only and never score categorical values',{skip:!php},()=>{
 const groups=[{samples:2,visited_on:'2025-01-20',details:JSON.stringify({noise:'quiet',signals:[{carrier:'verizon',signal:'strong'}]})},{samples:1,visited_on:'2026-07-02',details:JSON.stringify({shade:'full'})},{samples:1,visited_on:'2026-02-30',details:JSON.stringify({noise:'noisy'})},{samples:1,visited_on:'2027-01-01',details:JSON.stringify({noise:'quiet'})},{samples:1,visited_on:'2026-01-05',details:JSON.stringify({signals:[{carrier:'att',signal:'usable'}]})},{samples:1,visited_on:'2026-01-05',details:null},{samples:1,visited_on:'2026-01-05',details:JSON.stringify({noise:'invalid'})}];
 const script=`require ${JSON.stringify(path.resolve('api/_lib/observations.php'))};$in=json_decode(stream_get_contents(STDIN),true);echo json_encode(ko_monthly_groups($in,'2026-10-30'));`;
 const r=spawnSync('php',['-r',script],{input:JSON.stringify(groups),encoding:'utf8'});assert.equal(r.status,0,r.stderr);const d=JSON.parse(r.stdout);assert.equal(d.condition_reports,3);assert.equal(d.excluded_dates,2);assert.equal(d.unreported_reviews,2);assert.equal(d.invalid_observations,1);assert.equal(d.months['01'].axes.noise.quiet,2);assert.deepEqual(d.months['01'].axes.comfort,{});assert.ok(!JSON.stringify(d).includes('verizon'));assert.equal(D.validMonthly(d),true);
 const limit=spawnSync('php',['-r',script],{input:JSON.stringify([{samples:1000001,visited_on:'2026-01-05',details:'{"noise":"quiet"}'}]),encoding:'utf8'});assert.deepEqual(JSON.parse(limit.stdout),{version:1,available:false,reason:'limit'});
 const groupsLimit=spawnSync('php',['-r',script],{input:JSON.stringify(Array.from({length:10001},()=>groups[0])),encoding:'utf8'});assert.deepEqual(JSON.parse(groupsLimit.stdout),{version:1,available:false,reason:'limit'});
});
