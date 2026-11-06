/* Optional beta measurement activates only in an independently verified release. */
(function(win){
  'use strict';
  const VERSION='2.46.6';
  const container=win.document.getElementById('kt-analytics-choice');
  if(!container||!win.KampTrailAnalyticsBootstrap)return;
  container.dataset.version=VERSION;
  win.KampTrailAnalytics=win.KampTrailAnalyticsBootstrap.mount({container,release:{enabled:true,loadGoogleTag:true,automaticCollectionReviewed:true},consent:{introText:'You can allow Google Analytics to measure how KampTrail is used so we can improve the beta. It records the referral article path, map mode and actions such as searches, marker views, saved stops, installation and feedback submission. It does not send your search text, precise location, trip notes, saved-stop identifiers or feedback text. Google receives technical connection information when analytics is allowed. Analytics cookies last up to 60 days. Declining does not affect the map or your saved stops. Your choice applies here in this browser. Boondock or Bust asks separately.'}});
})(window);
