/* Optional BoB enhancement. Load through the existing consent-aware tag setup. */
(function(){'use strict';
  const modes=new Set(['overnight-parking','rest-areas','dump-stations','free-camping','blm']);
  const safePath=/^\/[a-z0-9\/-]{0,240}$/i;
  function metric(event,mode){if(!safePath.test(location.pathname))return;window.dataLayer=window.dataLayer||[];window.dataLayer.push({event,kt_mode:mode,kt_article_path:location.pathname});}
  const links=[...document.querySelectorAll('a[data-kamptrail-mode]')].filter(a=>modes.has(a.dataset.kamptrailMode));
  for(const a of links){
    const mode=a.dataset.kamptrailMode,u=new URL(a.href,location.href);
    if(!['https://kamptrail.com','https://lightslategrey-emu-717044.hostingersite.com'].includes(u.origin))continue;
    u.searchParams.set('mode',mode);u.searchParams.set('near','1');
    // Page parameters can contain personal details. Pass only the canonical article path.
    if(safePath.test(location.pathname))u.searchParams.set('ref','https://boondockorbust.com'+location.pathname);
    a.href=u.href;a.addEventListener('click',()=>metric('kt_launch_clicked',mode));
    if('IntersectionObserver' in window){const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){metric('kt_launch_viewed',mode);observer.disconnect();}},{threshold:0.5});observer.observe(a);}
  }
})();
