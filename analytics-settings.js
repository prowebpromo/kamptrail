/* Optional beta measurement stays off until a reviewed release changes these flags. */
(function(win){
  'use strict';
  const VERSION='2.46.2';
  const container=win.document.getElementById('kt-analytics-choice');
  if(!container||!win.KampTrailAnalyticsBootstrap)return;
  win.KampTrailAnalytics=win.KampTrailAnalyticsBootstrap.mount({container,release:{enabled:false,loadGoogleTag:false,automaticCollectionReviewed:false},consent:{introText:'Optional beta usage measurement is currently off. Saving a choice does not turn it on. Declining does not affect reading articles, using the map or saving stops.'}});
  container.dataset.version=VERSION;
})(window);
