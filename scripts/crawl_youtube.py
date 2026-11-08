"""Download every channel's upload list (regular videos) with yt-dlp into data/raw/yt/<handle>.json.
Skips channels already downloaded unless --force. Usage: python3 scripts/crawl_youtube.py [--force]"""
import json, subprocess, sys, concurrent.futures as cf
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data/raw/yt"; OUT.mkdir(parents=True, exist_ok=True)
people = [p for p in json.loads((ROOT / "data/roster.json").read_text())["people"] if p.get("yt")]
force = "--force" in sys.argv

def crawl(p):
    h = p["yt"]; f = OUT / f"{h.strip('@').lower()}.json"
    if f.exists() and not force: return h, "cached"
    r = subprocess.run(["yt-dlp", "--flat-playlist", "-J", "--extractor-args", "youtubetab:approximate_date",
                        f"https://www.youtube.com/{h}/videos"], capture_output=True, text=True, timeout=1800)
    if r.returncode: return h, "FAIL " + (r.stderr.strip().splitlines() or ["?"])[-1]
    d = json.loads(r.stdout)
    vids = [{"id": e["id"], "t": e.get("title"), "d": e.get("duration"), "v": e.get("view_count"),
             "ts": e.get("timestamp"), "ud": e.get("upload_date")} for e in d.get("entries") or [] if e.get("id")]
    f.write_text(json.dumps({"handle": h, "channel_id": d.get("channel_id"), "channel": d.get("channel"),
                             "followers": d.get("channel_follower_count"), "videos": vids}))
    return h, f"{len(vids)} videos"

with cf.ThreadPoolExecutor(4) as ex:
    for h, msg in ex.map(crawl, people): print(h, msg, flush=True)
