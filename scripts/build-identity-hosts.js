#!/usr/bin/env node
'use strict';
// Derive data/campsites/identity-hosts.json from the committed search index. The browser uses it to
// elect the same canonical host as the index build, whatever order states load in. The search index is
// read, never written. See docs/DETERMINISTIC_IDENTITY.md.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function identityHosts(indexText) {
  const index = JSON.parse(indexText), hosts = {};
  if (index?.version !== 1 || !Array.isArray(index.sites)) throw new Error('Invalid search index');
  const rows = [...index.sites].filter(s => (s.legacy_ids || []).length).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const s of rows) hosts[s.id] = [...s.legacy_ids];
  return {version: 1, index_sites: index.sites.length, index_sha256: crypto.createHash('sha256').update(indexText, 'utf8').digest('hex'), hosts};
}

if (require.main === module) {
  const directory = path.resolve(__dirname, '../data/campsites');
  const text = fs.readFileSync(path.join(directory, 'search-index.json'), 'utf8');
  const data = identityHosts(text), output = path.join(directory, 'identity-hosts.json');
  fs.writeFileSync(output + '.tmp', JSON.stringify(data) + '\n');
  fs.renameSync(output + '.tmp', output);
  console.log(`Identity hosts: ${Object.keys(data.hosts).length} multi-record listings, ${fs.statSync(output).size} bytes.`);
}

module.exports = {identityHosts};
