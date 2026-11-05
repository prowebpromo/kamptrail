<?php
/**
 * affiliate_click: network-agnostic GA4 affiliate click event.
 * Added 2026-09-27. Fires one GA4 event per click on a known affiliate link.
 * Networks: Everflow (harvest-hosts.com/RJQTWQ/<code>/) and Awin (awin1.com, awinmid 111454).
 * Parameters: affiliate_program, affiliate_network, affiliate_code, offer_id, page_path, link_url.
 * Sends nothing when gtag is absent (Site Kit disables GA4 for logged-in users).
 */
add_action( 'wp_footer', function () {
	if ( is_admin() ) { return; }
	?>
<script id="bob-affiliate-click">
(function(){
  var EF={M2GJW:{o:'13',p:'Harvest Hosts'},'2CTPL':{o:'1',p:'Harvest Hosts'},'6JHXF':{o:'4',p:'Boondockers Welcome'},J8P3N:{o:'11',p:'Escapees Getaway Event'},FGXLG:{o:'9',p:'Escapees RV Club'}};
  function parse(href){
    var u;try{u=new URL(href,location.href);}catch(e){return null;}
    var h=u.hostname.replace(/^www\./,'');
    if(h==='harvest-hosts.com'){
      var m=u.pathname.match(/^\/RJQTWQ\/([A-Za-z0-9]+)\/?/);if(!m)return null;
      var c=m[1].toUpperCase(),d=EF[c]||{o:'',p:'Harvest Hosts'};
      return {affiliate_program:d.p,affiliate_network:'Everflow',affiliate_code:c,offer_id:d.o};
    }
    if(h==='awin1.com'||h==='tidd.ly'){
      var mid=u.searchParams.get('awinmid')||'',aff=u.searchParams.get('awinaffid')||'',ref=u.searchParams.get('clickref')||'',dest=(u.searchParams.get('ued')||u.searchParams.get('p')||'').toLowerCase();
      var prog=mid==='111454'||dest.indexOf('harvesthosts')>-1?'Harvest Hosts':'Awin advertiser '+mid;
      if(dest.indexOf('boondockerswelcome')>-1)prog='Boondockers Welcome';
      return {affiliate_program:prog,affiliate_network:'Awin',affiliate_code:ref||aff,offer_id:mid};
    }
    return null;
  }
  var last=0;
  function onClick(e){
    if(e.type==='auxclick'&&e.button!==1)return;
    var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;if(!a)return;
    var p=parse(a.getAttribute('href'));if(!p)return;
    var now=Date.now();if(now-last<500)return;last=now;
    if(typeof window.gtag!=='function')return;
    p.page_path=location.pathname;p.link_url=a.href;p.transport_type='beacon';p.send_to='G-895FCE9MJX';
    window.gtag('event','affiliate_click',p);
  }
  document.addEventListener('click',onClick,true);
  document.addEventListener('auxclick',onClick,true);
})();
</script>
	<?php
}, 99 );
