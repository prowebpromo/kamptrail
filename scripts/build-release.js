const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),out=path.join(root,'dist','kamptrail');
const files=['index.html','how-to.html','app.js','app.css','manifest.json','service-worker.js','data-quality.js','data-loader.js','filters.js','trip-planner.js','routes.js','spot-info.js','share.js','layers.js','mvum.js','offline-maps.js','contributions.js','community.js','permissions.js','rest-areas.js','community-discovery.js','environment.js','forecast.js','services.js','icon-192.png','icon-512.png','og.png','LICENSE','DATA_SOURCES.md'];
(async()=>{
  require('node:child_process').execFileSync(process.execPath,[path.join(root,'scripts/build-permissions.js')],{cwd:root,stdio:'inherit'});
  await fs.rm(out,{recursive:true,force:true});await fs.mkdir(out,{recursive:true});
  for(const file of files)await fs.copyFile(path.join(root,file),path.join(out,file));
  for(const dir of ['leaflet','markercluster'])await fs.cp(path.join(root,'vendor',dir),path.join(out,'vendor',dir),{recursive:true});
  await fs.cp(path.join(root,'media','how-to'),path.join(out,'media','how-to'),{recursive:true});
  await fs.mkdir(path.join(out,'data','campsites'),{recursive:true});
  for(const file of await fs.readdir(path.join(root,'data','campsites'))){if(/^[A-Z]{2}_merged\.geojson$/.test(file)||['index.json','search-index.json','ridb-sites.json','coordinate-index.json'].includes(file))await fs.copyFile(path.join(root,'data','campsites',file),path.join(out,'data','campsites',file));}
  const amenityPath=path.join(root,'data','campsites','ridb-amenities.json');
  if(await fs.stat(amenityPath).then(s=>s.isFile()).catch(()=>false)){
    const raw=await fs.readFile(amenityPath);if(raw.length>2*1024*1024||!require('../data-quality.js').validRIDBAmenities(JSON.parse(raw)))throw new Error('Invalid optional RIDB amenity evidence');
    await fs.writeFile(path.join(out,'data','campsites','ridb-amenities.json'),raw);
  }
  // The runtime loads this index and its state files separately from merged snapshots.
  await fs.cp(path.join(root,'data','campsites','agency'),path.join(out,'data','campsites','agency'),{recursive:true});
  const elevationRoot=path.join(root,'data','campsites','elevation');
  if(await fs.stat(elevationRoot).then(s=>s.isDirectory()).catch(()=>false))await fs.cp(elevationRoot,path.join(out,'data','campsites','elevation'),{recursive:true,filter:source=>{const rel=path.relative(elevationRoot,source).split(path.sep).join('/');return rel===''||rel==='index.json'||rel==='snapshots'||/^snapshots\/[a-f0-9]{24}(?:\/[A-Z]{2}\.json)?$/.test(rel);}});
  await fs.mkdir(path.join(out,'data','services'),{recursive:true});await fs.copyFile(path.join(root,'data','services','services.json'),path.join(out,'data','services','services.json'));
  const restPath=path.join(root,'data','rest-areas','TX.json');
  if(await fs.realpath(restPath)!==restPath)throw new Error('Official rest-area release must not follow symlinks');
  const restRaw=await fs.readFile(restPath);
  if(restRaw.length>512*1024)throw new Error('Official rest-area catalogue exceeds release bound');
  require('../rest-areas.js').validate(JSON.parse(restRaw));
  await fs.mkdir(path.join(out,'data','rest-areas'),{recursive:true});await fs.writeFile(path.join(out,'data','rest-areas','TX.json'),restRaw);
  const serviceRoot=path.join(root,'data','services'),serviceRaw=await fs.readFile(path.join(serviceRoot,'index.json'));
  async function copyServiceGeneration(raw,expectedId){
    if(raw.length>1024*1024)throw new Error('Services manifest exceeds release bound');
    const index=JSON.parse(raw);
    if(index.version!==2||!/^[a-f0-9]{24}$/.test(index.snapshot_id)||(expectedId&&index.snapshot_id!==expectedId)||!Array.isArray(index.shards)||index.shards.length>4096)throw new Error('Invalid services release manifest');
    let count=0;const ids=new Set();
    for(const entry of index.shards){
      if(!/^[A-Za-z0-9_]{1,80}$/.test(entry.id)||ids.has(entry.id)||entry.url!==`snapshots/${index.snapshot_id}/${entry.id}.json`||!/^[a-f0-9]{64}$/.test(entry.sha256)||!Number.isSafeInteger(entry.bytes)||entry.bytes<1||entry.bytes>512*1024||!Number.isSafeInteger(entry.count)||entry.count<1||entry.count>1500)throw new Error('Invalid services release shard');
      ids.add(entry.id);const source=path.join(serviceRoot,entry.url),real=await fs.realpath(source);
      if(real!==source)throw new Error('Services release must not follow symlinks');
      const bytes=await fs.readFile(source);if(bytes.length!==entry.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw new Error('Services release checksum mismatch');
      const data=JSON.parse(bytes);if(data.version!==2||data.snapshot_id!==index.snapshot_id||data.shard_id!==entry.id||!Array.isArray(data.items)||data.items.length!==entry.count)throw new Error('Services shard identity mismatch');
      const target=path.join(out,'data','services',entry.url);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes);count+=entry.count;
    }
    if(count!==index.total)throw new Error('Services release count mismatch');
    const manifest=path.join(out,'data','services','snapshots',index.snapshot_id,'manifest.json');await fs.mkdir(path.dirname(manifest),{recursive:true});await fs.writeFile(manifest,raw);
    return index;
  }
  const serviceIndex=await copyServiceGeneration(serviceRaw);
  const prior=[];
  for(const entry of await fs.readdir(path.join(serviceRoot,'snapshots'),{withFileTypes:true})){
    if(entry.name===serviceIndex.snapshot_id||!/^[a-f0-9]{24}$/.test(entry.name))continue;
    if(!entry.isDirectory()||entry.isSymbolicLink())throw new Error('Invalid services snapshot directory');
    const file=path.join(serviceRoot,'snapshots',entry.name,'manifest.json');if(await fs.realpath(file)!==file)throw new Error('Services manifest must not follow symlinks');
    const raw=await fs.readFile(file);if(raw.length>1024*1024)throw new Error('Services predecessor manifest exceeds bound');
    const index=JSON.parse(raw),stamp=Date.parse(index.generated_at);if(index.snapshot_id!==entry.name||!Number.isFinite(stamp))throw new Error('Invalid services predecessor identity');
    prior.push({id:entry.name,raw,stamp});
  }
  if(prior.length>2)throw new Error('Services source snapshot retention exceeds release bound');
  for(const item of prior.sort((a,b)=>b.stamp-a.stamp))await copyServiceGeneration(item.raw,item.id);
  await fs.writeFile(path.join(out,'data','services','index.json'),serviceRaw);
  for(const file of ['places-us.json','places-us.LICENSE.txt','health.json'])await fs.copyFile(path.join(root,'data',file),path.join(out,'data',file));
  if(process.env.KAMPTRAIL_PUBLIC_URL){
    const base=new URL(process.env.KAMPTRAIL_PUBLIC_URL);
    if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw new Error('KAMPTRAIL_PUBLIC_URL must be an HTTPS website URL without credentials, query or fragment');
    if(!base.pathname.endsWith('/'))base.pathname+='/';
    for(const name of ['index.html','how-to.html']){
      const page=path.join(out,name),pageUrl=name==='index.html'?base.href:new URL(name,base).href;
      let html=await fs.readFile(page,'utf8');
      html=html.replace(/(<link rel="canonical" href=")[^"]*(">)/,`$1${pageUrl}$2`)
        .replace(/(<meta property="og:url" content=")[^"]*(">)/,`$1${pageUrl}$2`)
        .replace(/(<meta property="og:image" content=")[^"]*(">)/,`$1${new URL('og.png',base).href}$2`);
      await fs.writeFile(page,html);
    }
  }
  // Contributions API: only these public PHP entry points and their private helpers. Never configuration or credentials.
  const apiFiles=['api/.htaccess','api/health.php','api/environment.php','api/_lib/environment.php','api/forecast.php','api/_lib/forecast.php','api/route.php','api/_lib/routing.php','api/community.php','api/community-discovery.php','api/_lib/observations.php','api/photo.php','api/submit.php','api/status.php','api/admin.php','api/fcc-setup.php','api/_lib/.htaccess','api/_lib/bootstrap.php','api/_lib/community.php','api/_lib/community-admin.php','api/_lib/migrations.php','api/permissions.php','api/_lib/permissions.php','api/_lib/permissions-migration.php','api/_lib/permissions-admin.php','api/_lib/permission-evidence.php'];
  await fs.mkdir(path.join(out,'api','_lib'),{recursive:true});
  for(const file of apiFiles)await fs.copyFile(path.join(root,file),path.join(out,file));
  const permissionRoot=path.join(root,'api','_data','permissions');
  for(const file of await fs.readdir(permissionRoot)){
    if(!/^(?:[a-f0-9]{2}\.json|official\.json|manifest\.json|\.htaccess)$/.test(file))throw new Error('Unexpected protected permission asset');
    const rel=path.posix.join('api','_data','permissions',file),stat=await fs.lstat(path.join(root,rel));
    if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Invalid protected permission asset');
    await fs.mkdir(path.dirname(path.join(out,rel)),{recursive:true});await fs.copyFile(path.join(root,rel),path.join(out,rel));apiFiles.push(rel);
  }
  for(const file of await fs.readdir(path.join(root,'api'),{recursive:true})){
    const rel=path.posix.join('api',file.split(path.sep).join('/'));
    if((await fs.stat(path.join(root,rel))).isFile()&&!apiFiles.includes(rel))throw new Error(`Unlisted API file would be skipped: ${rel}. Add it to apiFiles deliberately.`);
  }
  // Prefer the app over a hosting provider's default landing page.
  await fs.writeFile(path.join(out,'.htaccess'),'DirectoryIndex index.html\n<IfModule mod_rewrite.c>\nRewriteEngine On\nRewriteRule (^|/)\\.(?!well-known/) - [F,L]\n</IfModule>\n');
  console.log(`MVP static release built: ${out}`);
})().catch(error=>{console.error(error);process.exitCode=1;});
