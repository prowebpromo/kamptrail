# KampTrail on Hostinger

Target: `https://kamptrail.com/`, PHP/HTML website on the existing Cloud Startup plan.
This document records package preparation. It does not assert that an upload or automatic Hostinger deployment has completed.

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

The existing GitHub data refresh updates the repository and GitHub Pages. It does not automatically copy files to Hostinger. A one-time archive upload is a snapshot, not a self-updating Hostinger deployment.

Keep the current primary links until a tested Hostinger release/deployment workflow is in place. That workflow should publish validated application/data output, preserve a previous release for rollback and report upload failures.

The existing Sunday 03:00 UTC schedule defaults to `CA CO UT AZ OR WA MT WY`. It does not target all 50 states or automatically select the 23 states that previously failed. Use an explicit state list for a retry or change the scheduled selection in a separately reviewed refresh change.

## Saved data during a domain move

Browser storage and offline maps are specific to the origin. Existing saved stops on the GitHub Pages origin do not automatically appear on kamptrail.com. Preserve access to the old app, provide an export/import path and have users download needed offline maps at the new origin before retiring the old location.
