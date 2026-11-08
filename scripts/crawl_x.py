"""Fetch recent posts for every X account via the public fxtwitter API into data/raw/x/<handle>.json.
Usage: python3 scripts/crawl_x.py [pages=8]"""
import json, sys, time, urllib.request, urllib.parse, concurrent.futures as cf
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data/raw/x"; OUT.mkdir(parents=True, exist_ok=True)
PAGES = int(sys.argv[1]) if len(sys.argv) > 1 else 8
UA = "Mozilla/5.0 Feedforward/1.0 (+https://feedforward.dbaney.com)"

def get(url, tries=6):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=25) as r:
                d = json.load(r)
                if d.get("code") == 200 and d.get("results"): return d
        except Exception: pass
        time.sleep(2 * (i + 1))
    return None

def slim(s):
    m = s.get("media") if isinstance(s.get("media"), dict) else {}
    q = s.get("quote")
    return {"id": s["id"], "text": s.get("text"), "ts": s.get("created_timestamp"), "likes": s.get("likes"),
            "reposts": s.get("reposts"), "replies": s.get("replies"), "views": s.get("views"),
            "bookmarks": s.get("bookmarks"), "lang": s.get("lang"),
            "reply_to": (s.get("replying_to") or {}).get("screen_name") if isinstance(s.get("replying_to"), dict) else s.get("replying_to"),
            "repost_by": (s.get("reposted_by") or {}).get("screen_name") if s.get("reposted_by") else None,
            "author": {k: (s.get("author") if isinstance(s.get("author"), dict) else {}).get(k) for k in ("screen_name", "name", "avatar_url")},
            "photos": [{"url": p.get("url"), "w": p.get("width"), "h": p.get("height")} for p in (m.get("photos") or [])],
            "videos": [{"thumb": v.get("thumbnail_url"), "url": v.get("url"), "w": v.get("width"), "h": v.get("height"), "d": v.get("duration")} for v in (m.get("videos") or [])],
            "card": {k: s["embed_card"].get(k) for k in ("title", "description", "url", "image")} if isinstance(s.get("embed_card"), dict) else None,
            "quote": slim(q) if isinstance(q, dict) and q.get("id") else None,
            "note": bool(s.get("community_note"))}

def crawl(handle):
    posts, cursor = {}, None
    for _ in range(PAGES):
        url = f"https://api.fxtwitter.com/2/profile/{handle}/statuses" + (f"?cursor={urllib.parse.quote(cursor)}" if cursor else "")
        d = get(url)
        if not d: break
        for s in d["results"]:
            try:
                if s.get("id"): posts[s["id"]] = slim(s)
            except Exception as e: print("skip", handle, s.get("id"), e, flush=True)
        cursor = (d.get("cursor") or {}).get("bottom")
        if not cursor: break
        time.sleep(0.8)
    (OUT / f"{handle.lower()}.json").write_text(json.dumps({"handle": handle, "posts": list(posts.values())}))
    return handle, len(posts)

hs = [p["x"] for p in json.loads((ROOT / "data/roster.json").read_text())["people"] if p.get("x")]
with cf.ThreadPoolExecutor(3) as ex:
    for h, n in ex.map(crawl, hs): print(h, n, flush=True)
