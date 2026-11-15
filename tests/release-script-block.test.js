'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {replaceScriptBlock}=require('../scripts/release-script-block.js');
const version=require('../package.json').version,mapModules=require('../scripts/map-modules.json');
const analytics=['consent-analytics.js','consent-controls.js','analytics-bootstrap.js','analytics-settings.js'];
const mapTags=mapModules.map(file=>`  <script type="application/x-kamptrail-map" data-src="${file}?v=${version}"></script>\n`).join('');
const analyticsTags=analytics.map(file=>`  <script defer src="${file}?v=${version}"></script>\n`).join('');
function bundle(html){
  html=replaceScriptBlock(html,mapTags,`  <script type="application/x-kamptrail-map" data-src="app.bundle.js?v=${version}"></script>\n`,'Map');
  return replaceScriptBlock(html,analyticsTags,`  <script defer src="analytics.bundle.js?v=${version}"></script>\n`,'Analytics');
}
test('LF and Windows CRLF HTML both request only the bundles cached by the production shell',()=>{
  const source=fs.readFileSync(require.resolve('../index.html'),'utf8').replace(/\r\n?/g,'\n'),lf=bundle(source),crlf=bundle(source.replace(/\n/g,'\r\n'));
  assert.equal(crlf,lf);assert.match(lf,/data-src="app\.bundle\.js/);assert.match(lf,/src="analytics\.bundle\.js/);
  for(const file of [...mapModules,...analytics])assert.equal(lf.includes(`="${file}?v=`),false,file+' must not be requested outside the cached bundle');
});
test('missing or duplicate script blocks fail the build instead of producing an offline-broken shell',()=>{
  assert.throws(()=>replaceScriptBlock('<html></html>',mapTags,'bundle','Map'),/does not match/);
  assert.throws(()=>replaceScriptBlock(mapTags+mapTags,mapTags,'bundle','Map'),/more than once/);
});
