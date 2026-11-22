import {PMTiles, SharedPromiseCache, bytesToHeader} from 'pmtiles';

const MAX_RANGE = 1024 * 1024;
const MAX_PNG = 320 * 1024;
const MAX_DIRECTORY = 2 * 1024 * 1024;
const jobs = [];
let active = 0;
function runNext() {
  while (active < 4 && jobs.length) {
    const {job,signal,resolve,reject} = jobs.shift();
    if (signal?.aborted) { reject(signal.reason); continue; }
    active++;
    Promise.resolve().then(job).then(resolve,reject).finally(() => { active--; runNext(); });
  }
}
function enqueue(job, signal) {
  return new Promise((resolve,reject) => { jobs.push({job,signal,resolve,reject}); runNext(); });
}
async function bounded(stream, limit) {
  const reader = stream.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const {done,value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw Error('Oversized archive response'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk,offset); offset += chunk.byteLength; }
  return data.buffer;
}
function png(data) {
  if (data.byteLength < 33 || data.byteLength > MAX_PNG) return false;
  const v = new DataView(data);
  return v.getUint32(0) === 0x89504e47 && v.getUint32(4) === 0x0d0a1a0a &&
    v.getUint32(12) === 0x49484452 && v.getUint32(16) === 256 && v.getUint32(20) === 256;
}
async function decompressDirectory(buffer, compression) {
  if (compression === 1 && png(buffer)) return buffer;
  const raw = compression === 2
    ? await bounded(new Response(buffer).body.pipeThrough(new DecompressionStream('gzip')),MAX_DIRECTORY)
    : compression === 1 ? buffer : null;
  if (!raw || raw.byteLength > MAX_DIRECTORY) throw Error('Unsupported PMTiles directory');
  // Every entry uses at least four varint bytes in the directory.
  const bytes = new Uint8Array(raw);
  let count = 0;
  for (let i = 0; i < 4 && i < bytes.length; i++) {
    count += (bytes[i] & 127) * 128 ** i;
    if (!(bytes[i] & 128)) {
      if (count > 0 && count <= 60000 && 4 * count <= bytes.length - i - 1) return raw;
      break;
    }
  }
  throw Error('Invalid PMTiles directory size');
}
export class RangeSource {
  constructor(url, region, fetcher = globalThis.fetch.bind(globalThis)) {
    this.url = url;
    this.region = region;
    this.fetcher = fetcher;
    this.etag = '';
    this.sections = null;
  }
  getKey() { return this.url; }
  validateHeader(data) {
    if (new TextDecoder().decode(data.slice(0,7)) !== 'PMTiles' || new Uint8Array(data)[7] !== 3) throw Error('Expected PMTiles v3');
    const h = bytesToHeader(data);
    if (h.tileType !== 2 || h.tileCompression !== 1 || ![1,2].includes(h.internalCompression) ||
        h.minZoom !== this.region.minZoom || h.maxZoom !== this.region.maxZoom) throw Error('Unexpected PMTiles coverage profile');
    const areas = [
      [h.rootDirectoryOffset,h.rootDirectoryLength],[h.jsonMetadataOffset,h.jsonMetadataLength],
      [h.leafDirectoryOffset,h.leafDirectoryLength],[h.tileDataOffset,h.tileDataLength]
    ].filter(([,length])=>length !== 0).sort(([a],[b])=>a-b);
    let end = 127;
    for (const [offset,length] of areas) {
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < end ||
          length < 1 || offset + length > this.region.archive.bytes) throw Error('Invalid archive section');
      end = offset + length;
    }
    if (h.rootDirectoryOffset < 127 || !h.rootDirectoryLength || h.rootDirectoryOffset + h.rootDirectoryLength > data.byteLength ||
        !h.tileDataLength) throw Error('Missing archive index or tile data');
    this.sections = [[h.rootDirectoryOffset,h.rootDirectoryLength],[h.leafDirectoryOffset,h.leafDirectoryLength],[h.tileDataOffset,h.tileDataLength]];
  }
  async getBytes(offset, length, signal, etag) {
    const total = this.region.archive.bytes, header = offset === 0 && length === 16384;
    if (header) length = Math.min(length,total);
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length <= 0 ||
        length > MAX_RANGE || offset + length > total || (!header && !this.sections?.some(([start,n]) => offset >= start && offset + length <= start + n))) {
      throw Error('Archive range outside declared section');
    }
    const last = offset + length - 1;
    const headers = {Range:'bytes='+offset+'-'+last};
    if (etag) headers['If-Match'] = etag;
    const timer = AbortSignal.timeout(12000);
    const response = await this.fetcher(this.url, {headers,cache:'no-store', redirect:'error',
      signal: signal ? AbortSignal.any([timer,signal]) : timer});
    const declared = response.headers.get('Content-Length'), encoding = response.headers.get('Content-Encoding');
    const tag = response.headers.get('ETag');
    const strongTag = tag && /^"[^"]+"$/.test(tag) ? tag : undefined;
    if (response.status !== 206 || response.headers.get('Content-Range') !== 'bytes '+offset+'-'+last+'/'+total ||
        (declared !== null && Number(declared) !== length) || (encoding && encoding !== 'identity') ||
        (this.etag && this.etag !== strongTag)) {
      await response.body?.cancel();
      throw Error('Archive range response rejected');
    }
    const data = await bounded(response.body,length);
    if (data.byteLength !== length) throw Error('Truncated archive range');
    if (header) { this.validateHeader(data); this.etag = strongTag || ''; }
    return {data,etag:strongTag};
  }
}
let writes = Promise.resolve();
async function save(cache,key,data) {
  if (!cache) return;
  writes = writes.then(async () => {
    await cache.put(key,new Response(data,{headers:{'Content-Type':'image/png'}}));
    const keys = await cache.keys();
    await Promise.all(keys.slice(0,Math.max(0,keys.length-256)).map(k=>cache.delete(k)));
  }).catch(()=>{});
  await writes;
}
export function openCoverageArchive(url, region, scope, options = {}) {
  const source = new RangeSource(url,region,options.fetcher);
  const archive = new PMTiles(source,new SharedPromiseCache(16, true, decompressDirectory),decompressDirectory);
  const cachePromise = (async () => {
    try { return await (options.caches ?? globalThis.caches)?.open('kamptrail:'+scope+':fcc-packed-v1'); } catch { return null; }
  })();
  return async (coords, signal) => {
    const key = new URL(url);
    key.searchParams.set('tile',[coords.z,coords.x,coords.y].join('/'));
    const cache = await cachePromise;
    try {
      const saved = await cache?.match(key.href);
      if (saved) {
        const data = await bounded(saved.body, MAX_PNG);
        if (png(data)) return new Blob([data],{type:'image/png'});
        await cache.delete(key.href);
      }
    } catch {}
    return enqueue(async () => {
      const result = await archive.getZxy(coords.z,coords.x,coords.y,signal);
      if (!result || !png(result.data)) throw Error('Absent or invalid coverage tile');
      await save(cache,key.href,result.data);
      return new Blob([result.data],{type:'image/png'});
    },signal);
  };
}
