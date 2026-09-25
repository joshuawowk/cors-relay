# cors-relay

A ~120-line Node service that re-serves any public URL with
`Access-Control-Allow-Origin: *`, so browser-engine clients can read feeds and
APIs that send no CORS header of their own.

Built for the **RSS Reader iCUE widget** (`net.jwowk.icue.rss`) on the Xeneon
Edge: the Valley Breeze (and every other BLOX/TownNews paper) publishes a real
RSS feed but no CORS header, rss2json's fetcher is refused by the site, and
feedrapp answers roughly half the time. Nothing public was reliable enough.

## Where it runs

| | |
|---|---|
| Host | t630 (192.168.0.164) |
| Path | `/docker/cors-relay/` |
| URL | `http://192.168.0.164:8787/?url=<encoded>` |
| Health | `http://192.168.0.164:8787/healthz` |
| Image | `node:22-alpine`, no build, `server.js` bind-mounted read-only |

Source of truth is this repo on desktop2; deploy by copying `app/server.js` and
`docker-compose.yml` to `/docker/cors-relay/` on t630 and running
`docker compose up -d`.

## Request forms

```
/?url=https%3A%2F%2Fexample.com%2Ffeed     # preferred
/?q=…  /?quest=…                            # rss2json / codetabs style
/https://example.com/feed                   # path form
```

## Guard rails

- `GET`/`HEAD` only; `OPTIONS` answered for preflight.
- Targets that resolve to a private, loopback, link-local or CGNAT address are
  refused — the relay cannot be used to reach the rest of the LAN.
- `ALLOW_HOSTS` (comma-separated hostname suffixes) narrows it further; empty
  means any public host.
- 10 s upstream timeout, 5 MB response cap, `Cache-Control: public, max-age=60`.
- Sends a desktop-browser `User-Agent` — several newspaper CDNs refuse default
  library agents.
- LAN only: no reverse-proxy entry, no TLS, not published through NPM.

## Widget setup

In the RSS Reader widget's settings:

```
Custom Proxy URL : http://192.168.0.164:8787/?url={url}
Feed URL n       : Valley Breeze|https://www.valleybreeze.com/search/?f=rss&t=article&c=news/north_smithfield_and_blackstone&l=15&s=start_time&sd=desc
```

The widget tries a direct fetch first and only falls back to this relay, so
feeds that already send CORS headers never touch it.
