"""Fetch each YouTube channel's avatar URL into data/cache/yt_avatars.json."""
import json, subprocess, concurrent.futures as cf
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
out = ROOT / "data/cache/yt_avatars.json"; out.parent.mkdir(parents=True, exist_ok=True)
have = json.loads(out.read_text()) if out.exists() else {}
people = [p for p in json.loads((ROOT / "data/roster.json").read_text())["people"] if p.get("yt") and p["yt"] not in have]
def get(p):
    r = subprocess.run(["yt-dlp", "-J", "--flat-playlist", "-I", "0", f"https://www.youtube.com/{p['yt']}"], capture_output=True, text=True, timeout=120)
    try:
        th = json.loads(r.stdout).get("thumbnails") or []
        av = next((t["url"] for t in th if t.get("id") == "avatar_uncropped"), None)
        return p["yt"], av
    except Exception:
        return p["yt"], None
with cf.ThreadPoolExecutor(6) as ex:
    for h, u in ex.map(get, people):
        if u: have[h] = u
        print(h, bool(u), flush=True)
out.write_text(json.dumps(have, indent=1))
