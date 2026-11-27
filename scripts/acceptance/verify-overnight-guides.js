'use strict';

// Run from the PR checkout with Node 20 or newer.
const path = require('node:path');
const {fetchDirectory, links} = require(path.join(process.cwd(), 'overnight-guides.js'));
const origin = 'https://kamptrail.com';

async function verify() {
  const directory = await fetchDirectory(async (url, options) => {
    const response = await fetch(url, {
      ...options, headers: {Origin: origin}, redirect: 'manual', signal: AbortSignal.timeout(25000)
    });
    const allowed = response.headers.get('access-control-allow-origin');
    console.log('WordPress directory', response.status, 'CORS', allowed, url);
    if (allowed !== '*' && allowed !== origin) throw new Error('KampTrail cannot read the guide directory from a browser');
    return response;
  });
  if (!directory.states.size || !directory.interstates.size) throw new Error('The directory is missing a guide type');
  const hub = links(null).stateUrl;
  const destinations = [hub, ...directory.states.values(), ...directory.interstates.values()];
  console.log(directory.states.size + ' states, ' + directory.interstates.size + ' interstate guides and the hub');
  const failures = [];
  for (const url of destinations) {
    try {
      const response = await fetch(url, {redirect: 'manual', signal: AbortSignal.timeout(25000)});
      const html = await response.text();
      const fragmentMatches = url !== hub || /\bid=["']state-guides["']/i.test(html);
      console.log(response.status, fragmentMatches ? 'ok' : 'missing hub section', url);
      if (response.status !== 200 || !fragmentMatches) failures.push(url);
    } catch (error) {
      failures.push(url);
      console.error(url, error.message);
    }
  }
  if (failures.length) throw new Error(failures.length + ' guide destinations failed');
}

verify().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
