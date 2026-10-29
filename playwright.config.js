const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/browser',
  testMatch: ['app.spec.js','saved-stops.spec.js','upgrade.spec.js','features.spec.js','perf.spec.js','reports.spec.js','community.spec.js','routes.spec.js','mvum.spec.js','fcc-setup.spec.js','discovery.spec.js','environment.spec.js','fee-evidence.spec.js','elevation.spec.js','forecast.spec.js'],
  timeout: 45000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', {open:'never'}]],
  use: {
    baseURL: process.env.BASE_URL || 'http://127.0.0.1:8765',
    viewport: {width:1440,height:1000},
    launchOptions: process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']} : {},
    trace:'retain-on-failure'
  },
  webServer: {command:'node scripts/serve.js',url:'http://127.0.0.1:8765',reuseExistingServer:true,stdout:'ignore',stderr:'ignore'}
});
