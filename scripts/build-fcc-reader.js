'use strict';
const path = require('node:path');
const {build} = require('esbuild');
let bundle;
module.exports = function coverageReader() {
  bundle ||= build({
    entryPoints:[path.join(__dirname,'../integrations/fcc-pmtiles/reader.mjs')],
    bundle:true, minify:true, write:false, format:'esm', platform:'browser', target:'es2020', legalComments:'eof'
  }).then(result=>result.outputFiles[0].contents);
  return bundle;
};
