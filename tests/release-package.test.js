'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const out=path.join(root,'dist','kamptrail');

test('release keeps runtime versions, handshake and first-party asset URLs consistent',()=>{
  const version=require('../package.json').version;
  const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
  assert.equal(lock.version,version);assert.equal(lock.packages[''].version,version);
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.ok(html.includes(`<meta name="kamptrail-version" content="${version}">`));
  assert.ok(html.includes(`>v${version}</a>`));
  const scripts=[...html.matchAll(/<script src="([^"/]+\.js)(\?[^"]*)?"/g)];
  const runtimeFiles=fs.readdirSync(root).filter(file=>file.endsWith('.js')&&!file.endsWith('.spec.js')&&!['service-worker.js','playwright.config.js'].includes(file)).sort();
  assert.deepEqual(scripts.map(([,file])=>file).sort(),runtimeFiles,'Every first-party runtime module is declared exactly once in the page');
  for(const file of ['app.js','data-loader.js','data-quality.js','permissions.js','rest-areas.js','rig-profile.js','route-elevation.js','clearances.js'])assert.ok(runtimeFiles.includes(file),`Required runtime module: ${file}`);
  for(const [,file,query]of scripts){
    assert.equal(query,`?v=${version}`,file);
    const source=fs.readFileSync(path.join(root,file),'utf8');
    if(file==='app.js'){
      assert.ok(source.includes(`?.content !== '${version}'`),'HTML handshake uses package version');
      assert.ok(source.includes(`module?.version!=='${version}'`),'Module handshake uses package version');
    }else assert.match(source,new RegExp(`(?:version:\\s*|const VERSION\\s*=\\s*)'${version.replaceAll('.','\\.')}'`),file);
  }
  for(const file of ['app.css','manifest.json'])assert.ok(html.includes(`href="${file}?v=${version}"`),file);
});

test('built release contains agency index dependencies and supports a custom-domain install',()=>{
  const env={...process.env};delete env.KAMPTRAIL_PUBLIC_URL;
  execFileSync(process.execPath,['scripts/build-release.js'],{cwd:root,env,stdio:'pipe'});
  assert.match(fs.readFileSync(path.join(out,'index.html'),'utf8'),/<link rel="canonical" href="https:\/\/prowebpromo\.github\.io\/kamptrail\/">/);
  const index=JSON.parse(fs.readFileSync(path.join(out,'data/campsites/agency/index.json'),'utf8'));
  assert.ok(index.states.length>0,'The built app must include its agency data');
  for(const code of index.states){
    const file=path.join(out,'data/campsites/agency',`${code}.geojson`);
    const data=JSON.parse(fs.readFileSync(file,'utf8'));
    assert.equal(data.type,'FeatureCollection',`${code} must be a usable packaged dataset`);
    assert.equal(data.features.length,index.counts[code]);
  }
  execFileSync(process.execPath,['scripts/build-release.js'],{cwd:root,env:{...env,KAMPTRAIL_PUBLIC_URL:'https://kamptrail.com/'},stdio:'pipe'});
  const html=fs.readFileSync(path.join(out,'index.html'),'utf8');
  assert.equal(html.match(/<meta name="kamptrail-version" content="([^"]+)">/)?.[1],require('../package.json').version,'Packaged app metadata must match the release version');
  assert.match(html,/<link rel="canonical" href="https:\/\/kamptrail\.com\/">/);
  assert.match(html,/<meta property="og:url" content="https:\/\/kamptrail\.com\/">/);
  assert.match(html,/<meta property="og:image" content="https:\/\/kamptrail\.com\/og.png">/);
  const howTo=fs.readFileSync(path.join(out,'how-to.html'),'utf8');
  assert.match(howTo,/<link rel="canonical" href="https:\/\/kamptrail\.com\/how-to\.html">/);
  const videos=JSON.parse(howTo.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
  assert.equal(videos.length,3);
  for(const video of videos){assert.equal(video['@type'],'VideoObject');for(const key of ['name','description','thumbnailUrl','uploadDate','duration','embedUrl'])assert.ok(video[key],`VideoObject missing ${key}`);}
  for(const [,url]of howTo.matchAll(/(?:src|href)="([^"]+)"/g)){
    if(/^(?:https?:|#|\.\/$)/.test(url))continue;
    assert.ok(fs.existsSync(path.join(out,url)),`Missing how-to dependency: ${url}`);
  }
  const permissionDir=path.join(out,'api','_data','permissions');
  assert.equal(fs.readFileSync(path.join(permissionDir,'.htaccess'),'utf8'),'Require all denied\n','Generated identity data must be denied over HTTP');
  assert.equal(fs.readdirSync(permissionDir).filter(name=>/^[a-f0-9]{2}\.json$/.test(name)).length,256,'Every protected identity bucket is packaged');
  assert.ok(fs.existsSync(path.join(out,'permissions.js')));
  const amenities=JSON.parse(fs.readFileSync(path.join(out,'data/campsites/ridb-amenities.json'),'utf8'));
  assert.equal(require('../data-quality.js').validRIDBAmenities(amenities),true);
  assert.equal(fs.readFileSync(path.join(out,'data/campsites/ridb-amenities.json'),'utf8'),fs.readFileSync(path.join(root,'data/campsites/ridb-amenities.json'),'utf8'));
  assert.ok(!fs.existsSync(path.join(out,'data/campsites/ridb-amenities-audit.json')),'Build audit is not a runtime dependency');
  assert.ok(fs.existsSync(path.join(out,'locale.js')));
  assert.ok(fs.existsSync(path.join(out,'api','permissions.php')));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(permissionDir,'official.json'),'utf8')),JSON.parse(fs.readFileSync(path.join(root,'data','permissions','official.json'),'utf8')),'Packaged evidence matches the reviewed source records');
  const htaccess=fs.readFileSync(path.join(out,'.htaccess'),'utf8');
  assert.match(htaccess,/^DirectoryIndex index.html\n/);
  assert.ok(htaccess.includes('RewriteRule (^|/)\\.(?!well-known/) - [F,L]'),'Git metadata must not be served');
  // Root-relative installation must retain the PWA's local asset paths.
  for(const [,url]of html.matchAll(/(?:src|href)="([^"]+)"/g)){
    if(/^(?:https?:|#)/.test(url))continue;
    const asset=url.split(/[?#]/,1)[0];
    assert.ok(fs.existsSync(path.join(out,asset)),`Missing page dependency: ${url}`);
  }
  // The contributions API ships its public entry points and private helpers, never configuration.
  for(const file of ['rig-profile.js','route-elevation.js','api/route-elevation.php','api/_lib/route-elevation.php','rest-areas.js','data/rest-areas/TX.json','data/rest-areas/state-policies.json','clearances.js','data/clearances/RI.json','services.js','data/services/index.json','forecast.js','api/forecast.php','api/_lib/forecast.php','data/campsites/coordinate-index.json','environment.js','api/environment.php','api/_lib/environment.php','routes.js','api/route.php','api/_lib/routing.php','data/health.json','community.js','community-discovery.js','api/community-discovery.php','api/_lib/observations.php','api/community.php','api/photo.php','api/_lib/community.php','api/_lib/community-admin.php','api/health.php','api/submit.php','api/status.php','api/admin.php','api/fcc-setup.php','api/_lib/bootstrap.php','api/_lib/migrations.php','api/.htaccess','api/_lib/.htaccess'])
    assert.ok(fs.existsSync(path.join(out,file)),`Missing API file: ${file}`);
  const services=JSON.parse(fs.readFileSync(path.join(out,'data/services/index.json'),'utf8'));
  assert.equal(services.version,2);let serviceTotal=0;
  for(const shard of services.shards){const raw=fs.readFileSync(path.join(out,'data/services',shard.url));assert.equal(raw.length,shard.bytes);assert.equal(require('node:crypto').createHash('sha256').update(raw).digest('hex'),shard.sha256);serviceTotal+=JSON.parse(raw).items.length;}
  assert.equal(serviceTotal,services.total);
  assert.ok(!fs.existsSync(path.join(out,'data/sources/services')),'Raw and canonical pipeline sources must stay outside browser release');
  assert.match(fs.readFileSync(path.join(out,'api/_lib/.htaccess'),'utf8'),/Require all denied/);
  const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
  for(const file of walk(out)){
    assert.ok(!/kamptrail-config|\.env$|private[\/]/.test(file),`Configuration must not be packaged: ${file}`);
  }
});
