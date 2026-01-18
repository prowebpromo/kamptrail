const { test, expect } = require('@playwright/test');

test.describe('Basic Functionality', () => {
  let server;

  test.beforeAll(async () => {
    // Start a simple server to serve the static files
    const http = require('http');
    const fs = require('fs');
    const path = require('path');

    server = http.createServer((req, res) => {
      const filePath = path.join(__dirname, '..', req.url === '/' ? 'index.html' : req.url);
      const extname = String(path.extname(filePath)).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
      };
      const contentType = mimeTypes[extname] || 'application/octet-stream';

      fs.readFile(filePath, (err, content) => {
        if (err) {
          if (err.code == 'ENOENT') {
            fs.readFile('./404.html', (error, content404) => {
              res.writeHead(404, { 'Content-Type': 'text/html' });
              res.end(content404, 'utf-8');
            });
          } else {
            res.writeHead(500);
            res.end('Sorry, check with the site admin for error: ' + err.code + ' ..\n');
          }
        } else {
          res.writeHead(200, { 'Content-Type': contentType });
          res.end(content, 'utf-8');
        }
      });
    }).listen(8000);
  });

  test.afterAll(() => {
    server.close();
  });

  test('should load the map and UI elements', async ({ page }) => {
    await page.goto('http://localhost:8000');

    // Check for the map container
    await expect(page.locator('#map')).toBeVisible();

    // Check for the header and title
    await expect(page.locator('header h1')).toHaveText('🏕️ KampTrail');

    // Check for the action buttons
    await expect(page.locator('#filters')).toBeVisible();
    await expect(page.locator('#trip')).toBeVisible();
    await expect(page.locator('#near')).toBeVisible();

    // Check for the search input
    await expect(page.locator('#search')).toBeVisible();
  });
});
