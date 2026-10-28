const fs=require('node:fs/promises'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'dist','kamptrail');
const files=['index.html','app.js','app.css','manifest.json','service-worker.js','data-quality.js','data-loader.js','filters.js','trip-planner.js','gpx-importer.js','campsite-compare.js','wikimedia-photos-service.js','icon-192.png','icon-512.png','og.png','LICENSE','DATA_SOURCES.md'];
(async()=>{
  await fs.rm(out,{recursive:true,force:true});await fs.mkdir(out,{recursive:true});
  for(const file of files)await fs.copyFile(path.join(root,file),path.join(out,file));
  for(const dir of ['vendor','overlays'])await fs.cp(path.join(root,dir),path.join(out,dir),{recursive:true});
  await fs.mkdir(path.join(out,'data','campsites'),{recursive:true});
  for(const file of await fs.readdir(path.join(root,'data','campsites'))){if(/^[A-Z]{2}_merged\.geojson$/.test(file)||file==='index.json')await fs.copyFile(path.join(root,'data','campsites',file),path.join(out,'data','campsites',file));}
  await fs.cp(path.join(root,'data','opencampingmap'),path.join(out,'data','opencampingmap'),{recursive:true});
  for(const file of ['poi_dump_water_propane.geojson','places-us.json','places-us.LICENSE.txt'])await fs.copyFile(path.join(root,'data',file),path.join(out,'data',file));
  await fs.writeFile(path.join(out,'README.txt'),'KampTrail 2.1.0\n\nUpload these files to a static HTTPS web host, or preview locally:\n  python3 -m http.server 8000\nThen open http://localhost:8000\nDo not double-click index.html (file:// blocks dataset fetching).\n\nCity search and saved campsite areas work offline after an online visit. Basemap tiles, land-access imagery, optional photos and directions require internet. Cell towers need an explicitly configured provider key.\n\nData is an incomplete source snapshot, not field verification or camping permission. Confirm fees, access, closures, water and rig suitability with the operator.\n\nFull source, tests, update workflows and documentation:\nhttps://github.com/prowebpromo/kamptrail\n');
  console.log(`Static release built: ${out}`);
})().catch(error=>{console.error(error);process.exitCode=1;});
