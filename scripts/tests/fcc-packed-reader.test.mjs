import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {RangeSource,openCoverageArchive} from '../../integrations/fcc-pmtiles/reader.mjs';
import client from '../../carrier-coverage.js';
const packed=process.env.FCC_PACKED_DIR, xyz=process.env.FCC_XYZ_DIR, base='http://127.0.0.1:8765/data/fcc-coverage/';
const data=JSON.parse(await fs.readFile(path.join(packed,'manifest.json')));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
test('reference PNG bytes from each real FCC regional archive are identical to the original XYZ tiles', async()=>{
  assert.ok(client.validManifest(data));
  const original = JSON.parse(await fs.readFile(path.join(xyz,'manifest.json')));
  let matches=0,ranges=0;
  for(const carrier of data.carriers) for(const region of carrier.regions){
    const rel=[data.release,carrier.id,region.id].join('/');
    const originalRegion = path.join(xyz,original.release,carrier.id,region.id);
    const full=await fs.readFile(path.join(packed,rel+'.pmtiles'));
    assert.equal(full.length,region.archive.bytes); assert.equal(digest(full),region.archive.sha256);
    const url=base+rel+'.pmtiles?sha256='+region.archive.sha256;
    const fetcher=async (input,init)=>{const r=await fetch(input,init);assert.equal(r.status,206);assert.match(init.headers.Range,/^bytes=\d+-\d+$/);ranges++;return r;};
    const read=openCoverageArchive(url,region,base,{fetcher});
    await assert.rejects(()=>read({z:region.minZoom,x:0,y:0}),/Absent or invalid/);
    for(const entry of await fs.readdir(originalRegion,{recursive:true})){
      if(!entry.endsWith('.png'))continue;
      const [z,x,y]=entry.slice(0,-4).split(path.sep).map(Number);
      const blob=await read({z,x,y});
      assert.deepEqual(Buffer.from(await blob.arrayBuffer()),await fs.readFile(path.join(originalRegion,entry)));
      matches++;
    }
  }
  assert.equal(matches,60);console.log('Real RI tiles byte-identical',matches,'bounded HTTP 206 responses',ranges);
});
test('rejects a full response, incorrect range/total/body length, compressed ranges and ETag changes',async()=>{
  const c=data.carriers[0],r=c.regions[0],full=await fs.readFile(path.join(packed,data.release,c.id,r.id+'.pmtiles'));
  const n=Math.min(16384,full.length);
  async function call(opts={}){
    const headers={'Content-Range':'bytes 0-'+(n-1)+'/'+full.length,'Content-Length':String(n),ETag:'"v1"',...opts.headers};
    const source=new RangeSource(base+'test.pmtiles',r,async()=>new Response(opts.body??full.subarray(0,n),{status:opts.status||206,headers}));
    if(opts.tag)source.etag=opts.tag;
    return source.getBytes(0,16384);
  }
  assert.equal((await call()).data.byteLength,n);
  for(const bad of [{status:200},{headers:{'Content-Range':'bytes 0-4/5'}},{headers:{'Content-Length':'2'}},
    {headers:{'Content-Encoding':'gzip'}},{body:full.subarray(0,n-1)},{tag:'"older"'}]) await assert.rejects(()=>call(bad));
});
test('schema 1 XYZ remains compatible and Alaska split footprints never imply a spanning bbox',()=>{
  const a=structuredClone(data),region=a.carriers[0].regions[0];
  region.id='AK';region.footprints=[[170,50,180,58],[-180,51,-130,72]];delete region.bounds;
  assert.ok(client.validManifest(a));region.footprints=[[170,50,-130,72]];assert.equal(client.validManifest(a),false);
  const old=structuredClone(data);old.schema=1;for(const c of old.carriers)for(const r of c.regions){delete r.archive;delete r.footprints;}
  assert.ok(client.validManifest(old));old.carriers[0].regions[0].archive=data.carriers[0].regions[0].archive;assert.equal(client.validManifest(old),false);
});
