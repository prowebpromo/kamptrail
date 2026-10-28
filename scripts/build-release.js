const fs=require('node:fs/promises'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'dist','kamptrail');
const files=['index.html','app.js','app.css','manifest.json','service-worker.js','data-quality.js','data-loader.js','filters.js','trip-planner.js','spot-info.js','share.js','layers.js','offline-maps.js','icon-192.png','icon-512.png','og.png','LICENSE','DATA_SOURCES.md'];
(async()=>{
  await fs.rm(out,{recursive:true,force:true});await fs.mkdir(out,{recursive:true});
  for(const file of files)await fs.copyFile(path.join(root,file),path.join(out,file));
  for(const dir of ['leaflet','markercluster'])await fs.cp(path.join(root,'vendor',dir),path.join(out,'vendor',dir),{recursive:true});
  await fs.mkdir(path.join(out,'data','campsites'),{recursive:true});
  for(const file of await fs.readdir(path.join(root,'data','campsites'))){if(/^[A-Z]{2}_merged\.geojson$/.test(file)||['index.json','search-index.json','ridb-sites.json'].includes(file))await fs.copyFile(path.join(root,'data','campsites',file),path.join(out,'data','campsites',file));}
  // The runtime loads this index and its state files separately from merged snapshots.
  await fs.cp(path.join(root,'data','campsites','agency'),path.join(out,'data','campsites','agency'),{recursive:true});
  await fs.mkdir(path.join(out,'data','services'),{recursive:true});await fs.copyFile(path.join(root,'data','services','services.json'),path.join(out,'data','services','services.json'));
  for(const file of ['places-us.json','places-us.LICENSE.txt'])await fs.copyFile(path.join(root,'data',file),path.join(out,'data',file));
  if(process.env.KAMPTRAIL_PUBLIC_URL){
    const base=new URL(process.env.KAMPTRAIL_PUBLIC_URL);
    if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw new Error('KAMPTRAIL_PUBLIC_URL must be an HTTPS website URL without credentials, query or fragment');
    if(!base.pathname.endsWith('/'))base.pathname+='/';
    const page=path.join(out,'index.html');
    let html=await fs.readFile(page,'utf8');
    html=html.replace(/(<link rel="canonical" href=")[^"]*(">)/,`$1${base.href}$2`)
      .replace(/(<meta property="og:url" content=")[^"]*(">)/,`$1${base.href}$2`)
      .replace(/(<meta property="og:image" content=")[^"]*(">)/,`$1${new URL('og.png',base).href}$2`);
    await fs.writeFile(page,html);
  }
  // Prefer the app over a hosting provider's default landing page.
  await fs.writeFile(path.join(out,'.htaccess'),'DirectoryIndex index.html\n');
  console.log(`MVP static release built: ${out}`);
})().catch(error=>{console.error(error);process.exitCode=1;});
