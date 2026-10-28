# KampTrail on Hostinger

Target: `https://kamptrail.com/`, PHP/HTML website on the existing Cloud Startup plan.
This document records the deployment design. Confirm the live state in hPanel before treating the Hostinger connection as complete.

## Build the custom-domain package

Use Node.js 22 or newer. Install dependencies, run the tests and build:

```sh
npm ci
npm test
KAMPTRAIL_PUBLIC_URL=https://kamptrail.com/ npm run build
```

Upload only the contents of `dist/kamptrail/`, with `index.html` at the website root. Do not upload repository sources, credentials, `.git`, or `node_modules`.

The release includes `data/campsites/agency/index.json` and every agency state file referenced by that index. These are required for the separate Forest Service and BLM listings; merged state files alone are insufficient.

`KAMPTRAIL_PUBLIC_URL` changes the built canonical URL and Open Graph page/image URLs. It does not change the repository's GitHub Pages defaults. Relative app assets, the manifest and service-worker scope work at either the domain root or the existing project subpath. The release's `.htaccess` gives `index.html` priority over a provider's default landing page.

Before changing Boondock or Bust embeds, verify the live version, national state totals, city and campsite searches, a shared link, fee evidence from an agency listing, saved stops, and offline reload. Check an agency JSON URL directly as well as the page HTML; an HTTP 200 placeholder is not a successful app deployment.

## Refresh and deployment are separate

`Publish Hostinger release` builds the current main branch after code pushes and successful data-refresh runs. The workflow-run triggers cover bot data commits, which do not trigger normal push workflows. It checks Node, Python and browser tests before publishing built files to the `hostinger` branch. It never downloads or executes an upstream run's artifacts. A failed test leaves the previous release in place.

Connect the Hostinger Git integration to `prowebpromo/kamptrail`, branch `hostinger`, in the domain's document root and enable automatic deployment. Do not deploy `main`, which contains source scripts and raw source snapshots. The release branch retains each previous release as its parent. `release.json` identifies the exact source commit. A one-time archive upload remains a snapshot until this Git connection is enabled and tested.

The Sunday 03:00 UTC schedule covers all 50 states. Manual refreshes retain their explicit selection and the eight-state default in the manual dispatch form. Failed sources keep their previously saved data, and the refresh summary reports failures. This retries previously failing states without deleting the expanded catalogue.

Verify one automatic deployment by matching the live `release.json` to the release branch after a new tested publication. Then switch public links. If publication or deployment fails, inspect the GitHub Actions run and hPanel deployment status. To roll back, deploy the previous release commit. The Git metadata and other dotfiles are denied HTTP access by the packaged `.htaccess`.

## Saved data during a domain move

Browser storage and offline maps are specific to the origin. Existing saved stops on the GitHub Pages origin do not automatically appear on kamptrail.com. Preserve access to the old app, provide an export/import path and have users download needed offline maps at the new origin before retiring the old location.
