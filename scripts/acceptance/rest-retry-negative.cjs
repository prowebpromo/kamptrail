'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const [mode]=process.argv.slice(2);
if(mode==='prepare'){
 const f='rest-areas.js',s=fs.readFileSync(f,'utf8');
 const fixed='if(pending&&!controller?.signal.aborted)return pending;\n      if(data&&!force)return data;if(pending)return pending;';
 assert.ok(s.includes(fixed),'check exact reviewed retry guard');
 fs.writeFileSync('rest-areas.js.verified-fix',s);
 fs.writeFileSync(f,s.replace(fixed,'if(data&&!force)return data;if(pending)return pending;'));
}else{
 const d=JSON.parse(fs.readFileSync('rest-retry-negative.json','utf8'));
 assert.equal(d.stats.unexpected,2);assert.equal(d.stats.expected,0);assert.equal(d.stats.skipped,0);assert.equal(d.errors.length,0);
 const tests=d.suites.flatMap(s=>s.suites||[]).flatMap(s=>s.specs||[]).flatMap(s=>s.tests||[]);
 assert.equal(tests.length,2);
 for(const t of tests){assert.equal(t.results.length,1);assert.match(t.results[0].error.message,/Unavailable now/);}
 console.log(JSON.stringify({kind:'negative-control',original_cache_order_reproduces_stale_retry_notice:true,expected_failures:2,other_runner_errors:0}));
}
