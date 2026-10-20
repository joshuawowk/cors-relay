# cors-relay

[![Release](https://img.shields.io/github/v/release/joshuawowk/cors-relay)](https://github.com/joshuawowk/cors-relay/releases)
[![License: MIT](https://img.shields.io/github/license/joshuawowk/cors-relay)](LICENSE)

A ~120-line Node service that re-serves any public URL with
`Access-Control-Allow-Origin: *`, so browser-engine clients can read feeds and
APIs that send no CORS header of their own.

Built for the **RSS Reader iCUE widget** on the Xeneon
Edge: the Valley Breeze (and every other BLOX/TownNews paper) publishes a real
RSS feed but no CORS header, rss2json's fetcher is refused by the site, and
feedrapp answers roughly half the time. Nothing public was reliable enough.

## Install

Multi-arch image (linux/amd64, linux/arm64) on GHCR:

```bash
docker run -d --name cors-relay --restart unless-stopped \
  -p 8787:8787 ghcr.io/joshuawowk/cors-relay:latest
```

Or with Compose (see [`docker-compose.yml`](docker-compose.yml)):

```bash
docker compose up -d
```

Then:

| | |
|---|---|
| Relay | `http://<relay-host>:8787/?url=<encoded>` |
| Health | `http://<relay-host>:8787/healthz` |

Configuration is via environment variables: `PORT` (8787), `TIMEOUT_MS`
(10000), `MAX_BYTES` (5000000) and `ALLOW_HOSTS` (comma-separated hostname
suffixes; empty = any public host).

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
- Meant for LAN use: no TLS or authentication. Put it behind a reverse proxy
  and set `ALLOW_HOSTS` if you expose it beyond your network.

## Widget setup

In the RSS Reader widget's settings:

```
Custom Proxy URL : http://<relay-host>:8787/?url={url}
Feed URL n       : Valley Breeze|https://www.valleybreeze.com/search/?f=rss&t=article&c=news/north_smithfield_and_blackstone&l=15&s=start_time&sd=desc
```

The widget tries a direct fetch first and only falls back to this relay, so
feeds that already send CORS headers never touch it.
