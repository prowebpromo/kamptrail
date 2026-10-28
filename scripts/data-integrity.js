const fs = require('node:fs/promises');

function validCoordinates(coords) {
  return Array.isArray(coords) && coords.length >= 2 && coords.slice(0, 2).every(Number.isFinite)
    && Math.abs(coords[0]) <= 180 && Math.abs(coords[1]) <= 90;
}

async function saveGeoJSON(file, data) {
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features) || !data.features.length
      || data.features.some(f => f?.geometry?.type !== 'Point' || !validCoordinates(f.geometry.coordinates))) {
    throw new Error(`Refusing empty or invalid dataset: ${file}`);
  }
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`);
  await fs.rename(temporary, file);
}

module.exports = { validCoordinates, saveGeoJSON };
