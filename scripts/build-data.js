#!/usr/bin/env node
/**
 * KampTrail build-data.js
 * Convert iOverlander CSV (places.csv) to /data/campsites/[STATE].geojson + index.json
 *
 * Usage:
 *   1) Download https://www.ioverlander.com/places.csv → save as ioverlander.csv (repo root)
 *   2) node scripts/build-data.js
 */
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'data', 'campsites');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, {recursive:true});

const US = {"Alabama":"AL","Alaska":"AK","Arizona":"AZ","Arkansas":"AR","California":"CA","Colorado":"CO","Connecticut":"CT","Delaware":"DE","Florida":"FL","Georgia":"GA","Hawaii":"HI","Idaho":"ID","Illinois":"IL","Indiana":"IN","Iowa":"IA","Kansas":"KS","Kentucky":"KY","Louisiana":"LA","Maine":"ME","Maryland":"MD","Massachusetts":"MA","Michigan":"MI","Minnesota":"MN","Mississippi":"MS","Missouri":"MO","Montana":"MT","Nebraska":"NE","Nevada":"NV","New Hampshire":"NH","New Jersey":"NJ","New Mexico":"NM","New York":"NY","North Carolina":"NC","North Dakota":"ND","Ohio":"OH","Oklahoma":"OK","Oregon":"OR","Pennsylvania":"PA","Rhode Island":"RI","South Carolina":"SC","South Dakota":"SD","Tennessee":"TN","Texas":"TX","Utah":"UT","Vermont":"VT","Virginia":"VA","Washington":"WA","West Virginia":"WV","Wisconsin":"WI","Wyoming":"WY"};

function parseCSV(text){
  const lines = text.split(/\r?\n/); if (!lines.length) return [];
  const head = lines[0].split(',').map(h=>h.replace(/^"|"$/g,''));
  const rows=[];
  for(let i=1;i<lines.length;i++){
    const L=lines[i]; if(!L) continue;
    const vals=[]; let cur=''; let q=false;
    for (const ch of L){
      if (ch === '"'){ q=!q; continue; }
      if (ch === ',' && !q){ vals.push(cur); cur=''; }
      else cur+=ch;
    }
    vals.push(cur);
    const obj={}; head.forEach((h,idx)=>obj[h]= (vals[idx]||'').replace(/^"|"$/g,''));
    rows.push(obj);
  }
  return rows;
}

function typeFrom(row){
  const t=(row.type||row.category||'').toLowerCase();
  const d=(row.description||'').toLowerCase();
  if (t.includes('wild')||t.includes('dispersed')||d.includes('dispersed')||d.includes('boondock')) return 'dispersed';
  if (t.includes('campground')||t.includes('rv')) return 'established';
  if (t.includes('parking')||d.includes('parking')) return 'parking';
  return 'other';
}
function costFrom(row){
  const d=(row.description||'').toLowerCase();
  if (d.includes('free')) return 0;
  const m=(d.match(/\$(\d+)/)||[])[1]; return m?parseInt(m,10):null;
}

function toFeature(row, idx){
  const lat=parseFloat(row.latitude||row.lat), lng=parseFloat(row.longitude||row.lon||row.lng);
  if (isNaN(lat)||isNaN(lng)) return null;
  const state = US[row.state] || row.state;
  if (!state || state.length!==2) return null; // skip non-US
  return {
    type:'Feature',
    geometry:{type:'Point', coordinates:[lng,lat]},
    properties:{
      id:`io_${idx}`,
      source:'iOverlander',
      name: row.name || 'Unnamed site',
      type: typeFrom(row),
      cost: costFrom(row),
      description: (row.description||'').slice(0,400),
      state, city: row.city||null,
      rating: row.rating?parseFloat(row.rating):null
    }
  };
}

(function main(){
  const input = path.join(__dirname,'..','ioverlander.csv');
  if (!fs.existsSync(input)){
    console.error('❌ ioverlander.csv not found at repo root.');
    console.log('Download from https://www.ioverlander.com/places.csv and save as ioverlander.csv');
    process.exit(1);
  }
  console.log('📖 Reading CSV...');
  const rows = parseCSV(fs.readFileSync(input,'utf8'));
  console.log('Rows:', rows.length);

  const byState={}; let kept=0;
  rows.forEach((r,i)=>{ const f=toFeature(r,i); if(!f) return; kept++; (byState[f.properties.state] ||= []).push(f); });

  const index = {generated:new Date().toISOString(), total_sites:kept, states:[]};

  Object.keys(byState).sort().forEach(st=>{
    const gj={type:'FeatureCollection', metadata:{state:st,count:byState[st].length,source:'iOverlander'}, features:byState[st]};
    fs.writeFileSync(path.join(OUT_DIR, `${st}.geojson`), JSON.stringify(gj));
    index.states.push({state:st, count:byState[st].length});
    console.log(`✓ ${st}.geojson (${byState[st].length})`);
  });

  fs.writeFileSync(path.join(OUT_DIR,'index.json'), JSON.stringify(index, null, 2));
  console.log('✅ Done.');
})();
