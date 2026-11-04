/* Start the map near the workspace, or immediately for a returning/deep-linked visit. */
(function(){'use strict';const VERSION='2.46.1';let pending=null,started=false;
  function script(src){return new Promise((resolve,reject)=>{const node=document.createElement('script');node.src=src;node.onload=resolve;node.onerror=()=>{node.remove();reject(Error(src));};document.head.append(node);});}
  async function start(){
    if(pending)return pending;
    pending=(async()=>{
      await window.KampTrailI18n?.ready;
      for(const href of ['vendor/leaflet/leaflet.css','vendor/markercluster/MarkerCluster.css','vendor/markercluster/MarkerCluster.Default.css']){const link=document.createElement('link');link.rel='stylesheet';link.href=href;document.head.append(link);}
      try{window.KampTrailProviders=await (await fetch('provider-config.json')).json();}catch{}
      await script('vendor/leaflet/leaflet.js');await script('vendor/markercluster/leaflet.markercluster.js');
      for(const tag of document.querySelectorAll('script[type="application/x-kamptrail-map"]'))await script(tag.dataset.src);
      started=true;
      window.dispatchEvent(new Event('kamptrail:mapready'));
      const action=new URLSearchParams(location.search).get('action');
      if(action==='saved')document.getElementById('trip')?.click();
      if(action==='near')document.getElementById('near')?.click();
    })().catch(()=>{pending=null;window.showToast?.('Map files could not load. Reconnect and try again. Saved data has not been removed.','error',0);const retry=document.createElement('button');retry.type='button';retry.textContent='Retry map';retry.onclick=()=>{retry.remove();start();};document.getElementById('toast')?.append(retry);});
    return pending;
  }
  window.KampTrailMapLoader={version:VERSION,start};
  const explore=document.getElementById('explore');
  document.addEventListener('click',event=>{const link=event.target.closest('a[href="#explore"],#explore,#about-data');if(link&&!started){const control=event.target.closest('button');if(control?.id==='install-kamptrail')return;if(control){event.preventDefault();event.stopImmediatePropagation();start().then(()=>{if(started)control.click();});}else start();}},true);
  document.getElementById('search-form')?.addEventListener('submit',event=>{if(!started){event.preventDefault();event.stopImmediatePropagation();start().then(()=>{if(started)document.getElementById('search-form').requestSubmit();});}},true);
  let returning=false;try{returning=!!localStorage.getItem('kt_last_position')||!!localStorage.getItem('kt_trip');}catch{}
  if(returning||location.hash||new URLSearchParams(location.search).get('source')==='pwa'||document.body.classList.contains('kt-workspace'))start();
  else if('IntersectionObserver' in window){const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();start();}},{rootMargin:'300px'});observer.observe(explore);}
  else start();
})();
