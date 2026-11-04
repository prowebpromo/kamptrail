const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const pages=['index.html','plan.html','about.html','tools.html','guides.html'];
test('public website journeys resolve locally, have one h1 and accurate canonical/social/structured metadata',()=>{
  for(const file of pages){const s=fs.readFileSync(file,'utf8');assert.equal((s.match(/<h1\b/g)||[]).length,1,file);assert.ok(s.includes('https://kamptrail.com/'+(file==='index.html'?'':file)),file);
    for(const name of ['twitter:title','twitter:description','twitter:image','og:title','og:description','og:image'])assert.ok(s.includes(name),file+': '+name);
    const scripts=[...s.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];assert.ok(scripts.length,file);for(const m of scripts){const d=JSON.parse(m[1]);assert.equal(d['@context'],'https://schema.org');assert.ok(d['@type']);}
    for(const m of s.matchAll(/(?:href|src)="([^"#]+)"/g)){if(/^(?:https?:|mailto:)/.test(m[1]))continue;const dest=m[1].split(/[?#]/)[0];assert.ok(fs.existsSync(dest),file+': '+dest);}
  }
  const home=fs.readFileSync('index.html','utf8');assert.match(home,/href="plan.html"/);assert.match(home,/href="about.html"/);
});
test('new product pages and evidence module are packaged and available as offline documents',()=>{
  const build=fs.readFileSync('scripts/build-release.js','utf8'),worker=fs.readFileSync('service-worker.js','utf8');for(const f of ['plan.html','about.html','record-overrides.js']){assert.ok(build.includes("'"+f+"'"),f);assert.ok(worker.includes("'"+f+"'"),f);}
  const site=fs.readFileSync('sitemap.xml','utf8');for(const f of pages)assert.ok(site.includes('https://kamptrail.com/'+(f==='index.html'?'':f)),f);
});
