const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function jpegSize(raw){assert.equal(raw.readUInt16BE(0),0xffd8);let i=2;while(i<raw.length){assert.equal(raw[i],255);const marker=raw[i+1],length=raw.readUInt16BE(i+2);if([0xc0,0xc1,0xc2].includes(marker))return [raw.readUInt16BE(i+7),raw.readUInt16BE(i+5)];i+=2+length;}throw Error('No JPEG size');}
const html=fs.readFileSync('index.html','utf8');
test('homepage actions reach the working map, workflow and private feedback',()=>{for(const id of ['explore','how-it-works','feedback-panel']){assert.match(html,new RegExp(`href="#${id}"`));assert.equal([...html.matchAll(new RegExp(`id="${id}"`,'g'))].length,1);}assert.match(html,/<form id="search-form" role="search">/);assert.match(html,/id="map" role="region"/);assert.equal([...html.matchAll(/data-install-open aria-haspopup="dialog"/g)].length,2);assert.match(html,/data-feedback-kind="bug"/);assert.match(html,/data-feedback-kind="feature"/);});
test('workflow screenshots use real dimensions, lazy loading and translated alternatives',()=>{const c={};vm.runInNewContext(fs.readFileSync('locale-fr.js','utf8'),c);for(const img of html.matchAll(/<img [^>]*src="(media\/onboarding\/[^\"]+)"[^>]*>/g)){const raw=fs.readFileSync(img[1]),[w,h]=jpegSize(raw);assert.ok(img[0].includes(`width="${w}" height="${h}"`));assert.match(img[0],/loading="lazy"/);const alt=img[0].match(/data-i18n-alt="([^"]+)"/)[1];assert.ok(c.KampTrailI18nFr.messages[alt]);}assert.match(fs.readFileSync('locale.js','utf8'),/'title', 'alt'/);});
test('install guide keeps device instructions and connection limits visible without a native prompt',()=>{const guide=html.split('id="install-guide"')[1].split('id="feedback-panel"')[0];for(const phrase of ['iPhone and iPad','Android','Windows and other computers','Mac with Safari','Installation does not download maps.','New routes, fresh weather and sending feedback need a connection.'])assert.ok(guide.includes(phrase));const m=JSON.parse(fs.readFileSync('manifest.json','utf8'));assert.equal(m.start_url,'./?source=pwa');assert.equal(m.scope,'./');assert.equal(m.screenshots[0].src,'media/onboarding/browse.jpg');assert.equal(m.screenshots[0].sizes,'375x750');});
test('brand and gallery ship while optional screenshots cannot block offline-shell install',()=>{const build=fs.readFileSync('scripts/build-release.js','utf8'),sw=fs.readFileSync('service-worker.js','utf8');for(const file of ['brand-mark.svg','media/onboarding/browse.jpg','media/onboarding/filters.jpg','media/onboarding/offline.jpg'])assert.ok(build.includes(file));assert.ok(sw.includes('brand-mark.svg'));assert.ok(!sw.includes('media/onboarding/'));assert.match(sw,/const VERSION = 'kt-v\d+'/);});

test('new homepage marked copy and alternatives exist in both translated catalogues',()=>{const es={window:null},fr={};es.window=es;vm.runInNewContext(fs.readFileSync('locale.js','utf8'),es);vm.runInNewContext(fs.readFileSync('locale-fr.js','utf8'),fr);const sections=[html.match(/<section class="kt-home-hero"[\s\S]*?<\/section>/)[0],html.match(/<section id="how-it-works"[\s\S]*?<\/section>/)[0],html.match(/<section id="install-guide"[\s\S]*?<\/section>/)[0]].join('');const esKeys=new Set([...fs.readFileSync('locale-es.js','utf8').matchAll(/^  ("(?:[^"\\]|\\.)*"):/gm)].map(m=>JSON.parse(m[1])));const keys=[...sections.matchAll(/data-i18n(?:-alt)?="([^"]+)"/g)].map(x=>x[1]);for(const key of keys){assert.ok(Object.hasOwn(fr.KampTrailI18nFr.messages,key),key);assert.ok(esKeys.has(key),key);}});
const testLegalFiles=['safety.js','terms.html','safety.html','privacy.html','legal.css'];
test('safety gate loads before guarded features and legal documents ship offline',()=>{const sw=fs.readFileSync('service-worker.js','utf8'),build=fs.readFileSync('scripts/build-release.js','utf8');for(const name of testLegalFiles){assert.ok(sw.includes("'"+name+"'"),name);assert.ok(build.includes("'"+name+"'"),name);}const gate=html.indexOf('src="safety.js?');assert.ok(gate>=0);for(const name of ['offline-maps.js','install.js'])assert.ok(gate<html.indexOf('src="'+name+'?'));assert.match(html,/<nav class="kt-legal-nav"/);for(const page of ['terms','safety','privacy'])assert.ok(html.includes('href="'+page+'.html"'));assert.ok(html.includes('Owned and operated by Adirondack Mfg Corp'));});

test('beta preview links resolve and its marked text has Spanish and French translations', () => {
  const updates = fs.readFileSync('updates.html', 'utf8');
  const spanish = fs.readFileSync('locale-es.js', 'utf8');
  const french = {};
  vm.runInNewContext(fs.readFileSync('locale-fr.js', 'utf8'), french);
  const spanishKeys = new Set([...spanish.matchAll(/^  ("(?:[^"\\]|\\.)*"):/gm)].map(match => JSON.parse(match[1])));
  const sections = ['about-chuck', 'beta-testing', 'beta-faq'].map(id => {
    const section = html.match(new RegExp(`<section id="${id}"[\\s\\S]*?</section>`));
    assert.ok(section, id);
    return section[0];
  }).join('') + updates;
  for (const match of sections.matchAll(/data-i18n(?:-alt)?="([^"]+)"/g)) {
    const key = match[1].replaceAll('&amp;', '&');
    assert.ok(spanishKeys.has(key), key);
    assert.ok(Object.hasOwn(french.KampTrailI18nFr.messages, key), key);
  }
  const howTo = fs.readFileSync('how-to.html', 'utf8');
  for (const match of html.matchAll(/href="how-to.html#([^"]+)"/g)) {
    assert.ok(howTo.includes(`id="${match[1]}"`), match[1]);
  }
  for (const file of ['updates.html', 'media/about/chuck-and-cindy.jpg']) {
    assert.ok(fs.readFileSync('scripts/build-release.js', 'utf8').includes(file), file);
  }
  assert.ok(fs.readFileSync('service-worker.js', 'utf8').includes("'updates.html'"));
  assert.equal([...html.matchAll(/<details>/g)].length, 10);
});

test('resource directories ship existing BoB tools with explicit formats and working local destinations', () => {
  const build = fs.readFileSync('scripts/build-release.js', 'utf8');
  const worker = fs.readFileSync('service-worker.js', 'utf8');
  for (const name of ['tools.html', 'guides.html', 'resources.css']) {
    assert.ok(build.includes("'" + name + "'"), name);
    assert.ok(worker.includes("'" + name + "'"), name);
  }
  const tools = fs.readFileSync('tools.html', 'utf8');
  for (const label of ['Interactive calculator', 'Interactive planner', 'Printable PDFs', 'Formula and worked examples', 'Web app with sign-in']) {
    assert.ok(tools.includes(label), label);
  }
  for (const name of ['tools.html', 'guides.html']) {
    const source = fs.readFileSync(name, 'utf8');
    assert.match(source, /<html lang="en">/);
    assert.ok(source.includes(`href="${name}" aria-current="page"`));
    for (const match of source.matchAll(/(?:href|src)="([^"#]+)"/g)) {
      if (/^https?:/.test(match[1])) continue;
      const destination = match[1].split(/[?#]/)[0];
      assert.ok(fs.existsSync(destination), destination);
    }
  }
});
