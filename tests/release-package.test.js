'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const out=path.join(root,'dist','kamptrail');

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
  assert.match(html,/<link rel="canonical" href="https:\/\/kamptrail\.com\/">/);
  assert.match(html,/<meta property="og:url" content="https:\/\/kamptrail\.com\/">/);
  assert.match(html,/<meta property="og:image" content="https:\/\/kamptrail\.com\/og.png">/);
  assert.equal(fs.readFileSync(path.join(out,'.htaccess'),'utf8'),'DirectoryIndex index.html\n');
  // Root-relative installation must retain the PWA's local asset paths.
  for(const [,url]of html.matchAll(/(?:src|href)="([^"]+)"/g)){
    if(/^(?:https?:|#)/.test(url)||url.includes('?'))continue;
    assert.ok(fs.existsSync(path.join(out,url)),`Missing page dependency: ${url}`);
  }
});
