// Small local static server. Both / and /kamptrail/ work for deployment-path checks.
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const root=path.resolve(process.env.KAMPTRAIL_SERVE_DIR||path.resolve(__dirname,'..'));
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.geojson':'application/geo+json','.png':'image/png','.svg':'image/svg+xml','.md':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8','.xml':'application/xml','.webp':'image/webp','.ico':'image/x-icon'};
const {createReadStream}=require('node:fs');
const port=Number(process.env.PORT || 8765);
http.createServer(async(req,res)=>{
  try {
    let pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(pathname.startsWith('/kamptrail/'))pathname=pathname.slice('/kamptrail'.length);
    if(pathname.endsWith('/'))pathname+='index.html';
    const file=path.resolve(root,'.'+pathname);
    if(!file.startsWith(root+path.sep)||pathname.split('/').some(p=>p.startsWith('.'))||pathname.includes('/node_modules/'))throw new Error('Not found');
    if(pathname==='/vendor/fcc-pmtiles/reader.js' && root===path.resolve(__dirname,'..')){
      res.writeHead(200,{'Content-Type':'application/javascript'});
      return res.end(await require('./build-fcc-reader.js')());
    }
    if(path.extname(file)==='.pmtiles'){
      const stat=await fs.stat(file);
      const headers={'Content-Type':'application/vnd.pmtiles','Accept-Ranges':'bytes',
        ETag:'"'+stat.size+'-'+Math.trunc(stat.mtimeMs)+'"'};
      let start=0,end=stat.size-1,status=200;
      if(req.headers.range){
        const match=/^bytes=(\d+)-(\d+)$/.exec(req.headers.range);
        if(!match || Number(match[1])>Number(match[2]) || Number(match[1])>=stat.size){
          res.writeHead(416,{'Content-Range':'bytes */'+stat.size});return res.end();
        }
        if(req.headers['if-match'] && req.headers['if-match']!==headers.ETag){res.writeHead(412);return res.end();}
        start=Number(match[1]);end=Math.min(Number(match[2]),stat.size-1);status=206;
        headers['Content-Range']='bytes '+start+'-'+end+'/'+stat.size;
      }
      res.writeHead(status,{...headers,'Content-Length':end-start+1});
      if(req.method==='HEAD')return res.end();
      const stream=createReadStream(file,{start,end});res.on('close',()=>stream.destroy());return stream.pipe(res);
    }
    const body=await fs.readFile(file);
    res.writeHead(200,{'Content-Type':types[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-cache'});
    if(req.method!=='HEAD')res.end(body);else res.end();
  }catch{res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log(`KampTrail: http://127.0.0.1:${port}/`));
