Feole Pitching - website files
===========================

This folder is the whole website. It is static (no server code), so any web host works.

Fastest way to put it online (about 5 minutes):
1. Buy a domain, e.g. jppitching.com, at a registrar such as Cloudflare, Namecheap or Squarespace Domains.
2. Go to https://app.netlify.com/drop and drag this "jp-pitching" folder onto the page.
   Netlify gives you a live address right away (something like jp-pitching-123.netlify.app).
3. In Netlify: Site configuration > Domain management > Add a domain, type your domain,
   and follow the steps it shows to point the domain at Netlify. HTTPS is set up automatically.

Other hosts that work the same way: Cloudflare Pages, GitHub Pages, Vercel.

Notes
- Max accuracy uses a stronger body tracker (RTMPose-x) that runs on your computer's graphics chip. It is included in this folder (the rtm and ort folders), so nothing is downloaded from other sites.
- Use Chrome or Edge on a Mac or PC for the graphics-chip speed. Other browsers fall back to the processor (slower) or the built-in tracker.
- Everything runs in the visitor's browser. Videos are never uploaded to the server.
- The site must be served over https (all the hosts above do this) for video and the tracker to work.
- "Export angles (CSV)" downloads a file directly on the website.
