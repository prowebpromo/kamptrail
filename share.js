/* Share links (#site=ID, #spot=lat,lng) and community correction links (GitHub issue forms). */
(function () {
  'use strict';
  const t = (key, params) => (typeof window !== 'undefined' ? window.KampTrailI18n : globalThis.KampTrailI18n)?.t(key, params) ?? String(key).replace(/\{([a-zA-Z0-9_]+)\}/g, (token, name) => Object.hasOwn(params || {}, name) ? String(params[name]) : token);
  const REPO = 'https://github.com/prowebpromo/kamptrail';
  // Links carry the listing's id in the published index, whichever member this browser shows.
  const publishedId = id => String(window.KampTrailData?.publishedId?.(id) ?? id);
  function baseUrl() { return location.href.split('#')[0].split('?')[0]; }
  function linkFor(target) {
    let hash=target.site!=null?'site='+encodeURIComponent(publishedId(target.site)):Array.isArray(target.spot)?'spot='+target.spot[0].toFixed(5)+','+target.spot[1].toFixed(5):'';
    const f=target.elevation||window.kamptrailFilters||{},range=window.DataQuality?.elevationRange(f);
    if(hash&&range?.active&&range.valid){if(range.min!==null)hash+='&emin='+range.min;if(range.max!==null)hash+='&emax='+range.max;hash+='&eunit='+(f.elevationUnit==='m'?'m':'ft');}
    const forecast=target.forecast||window.kamptrailFilters||{},bounds=window.KampTrailForecast?.range(forecast);
    if(hash&&bounds?.active&&bounds.valid){if(bounds.min!==null)hash+='&fmin='+bounds.min;if(bounds.max!==null)hash+='&fmax='+bounds.max;hash+='&fhours='+bounds.hours+'&funit='+(forecast.forecastUnit==='C'?'C':'F');}
    return baseUrl()+(hash?'#'+hash:'');
  }
  async function share(target, title) {
    const url = linkFor(target);
    try {
      if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || '')) { await navigator.share({title: `${title} | KampTrail`, url}); return url; }
    } catch (e) { if (e && e.name === 'AbortError') return url; }
    try { await navigator.clipboard.writeText(url); window.showToast?.(t("Link copied. Anyone with the link can open this location in KampTrail.")); }
    catch { window.prompt?.(t("Copy this link:"), url); }
    return url;
  }
  function parse(hash = location.hash) {
    const parts=String(hash||'').replace(/^#/,'').split('&'),h=parts.shift();let target=null;
    const site=h.match(/^site=(.+)$/);
    if(site){try{target={site:decodeURIComponent(site[1]).slice(0,200)};}catch{return null;}}
    const spot=h.match(/^spot=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
    if(spot){const lat=+spot[1],lng=+spot[2];if(Math.abs(lat)<=90&&Math.abs(lng)<=180)target={spot:[lat,lng]};}
    if(!target)return null;
    const params=new URLSearchParams(parts.join('&'));
    if(params.has('emin')||params.has('emax')){
      if(['emin','emax','eunit'].some(k=>params.getAll(k).length>1))return null;
      const number=k=>!params.has(k)?null:/^-?\d+(?:\.\d+)?$/.test(params.get(k))?Number(params.get(k)):NaN;
      const e={elevationMin:number('emin'),elevationMax:number('emax'),elevationUnit:params.get('eunit')==='m'?'m':'ft'};
      if(!window.DataQuality?.elevationRange(e).valid)return null;target.elevation=e;
    }
    if(params.has('fmin')||params.has('fmax')){
      if(['fmin','fmax','fhours','funit'].some(k=>params.getAll(k).length>1))return null;
      const number=k=>!params.has(k)?null:/^-?\d+(?:\.\d+)?$/.test(params.get(k))?Number(params.get(k)):NaN;
      const forecast={forecastMinC:number('fmin'),forecastMaxC:number('fmax'),forecastHours:params.has('fhours')?number('fhours'):24,forecastUnit:params.get('funit')==='C'?'C':'F'};
      if(!window.KampTrailForecast?.range(forecast).valid)return null;target.forecast=forecast;
    }
    return target;
  }
  function issueUrl(kind, site) {
    const p = new URLSearchParams();
    if (kind === 'new') {
      p.set('template', 'new-campsite.yml');
      p.set('title', 'New campsite: ');
      if (site && site.lat != null) p.set('coordinates', `${site.lat.toFixed(5)}, ${site.lng.toFixed(5)}`);
    } else {
      const props = site.properties, [lng, lat] = site.geometry.coordinates;
      p.set('template', 'campsite-correction.yml');
      p.set('title', `Correction: ${String(props.name || '').slice(0, 80)}`);
      const id = publishedId(props.id);
      p.set('campsite', `${props.name} (${id})`);
      p.set('link', linkFor({site: id}));
      p.set('coordinates', `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    }
    return `${REPO}/issues/new?${p}`;
  }
  window.KampTrailShare = {version: '2.34.0', linkFor, share, parse, issueUrl, REPO};
})();
