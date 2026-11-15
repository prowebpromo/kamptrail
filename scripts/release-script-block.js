'use strict';
// Repository checkouts may use CRLF; bundled HTML and the worker must still name the same scripts.
function replaceScriptBlock(html,expected,replacement,label){
  const normalized=html.replace(/\r\n?/g,'\n');
  if(!normalized.includes(expected))throw Error(`${label} script block does not match the release module list`);
  const output=normalized.replace(expected,replacement);
  if(output.includes(expected))throw Error(`${label} script block occurs more than once`);
  return output;
}
module.exports={replaceScriptBlock};
