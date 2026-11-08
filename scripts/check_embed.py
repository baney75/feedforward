"""Record which videos and Shorts allow embedding (YouTube oEmbed answers 401 when the owner disabled it).
Writes data/cache/embed.json {id: 1|0}. Reruns only check ids not seen yet. Usage: python3 scripts/check_embed.py"""
import json, time, urllib.request, urllib.error, concurrent.futures as cf, threading
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data/cache/embed.json"
have = json.loads(OUT.read_text()) if OUT.exists() else {}
lock = threading.Lock()
ids = []
for d in ("shorts", "yt"):
    for f in sorted((ROOT / "data/raw" / d).glob("*.json")):
        ids += [v["id"] for v in json.loads(f.read_text())["videos"]]
# Only check what the app can show: labeled, on-topic items.
labels = json.loads((ROOT / "data/cache/class.json").read_text())
ids = [i for i in dict.fromkeys(ids) if i not in have and ((labels.get("v:" + i) or labels.get("s:" + i) or ["off"])[0] != "off")]
print(len(ids), "to check", flush=True)
def check(i):
    url = f"https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v={i}"
    for k in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=15) as r:
                return i, 1
        except urllib.error.HTTPError as e:
            if e.code in (401, 403): return i, 0
            if e.code in (400, 404): return i, -1   # removed or private
            time.sleep(2 * (k + 1))
        except Exception:
            time.sleep(2 * (k + 1))
    return i, None
n = 0
with cf.ThreadPoolExecutor(12) as ex:
    for i, ok in ex.map(check, ids):
        if ok is not None: have[i] = ok
        n += 1
        if n % 1000 == 0:
            with lock: OUT.write_text(json.dumps(have))
            print(n, flush=True)
OUT.write_text(json.dumps(have))
print("done", sum(1 for v in have.values() if v == 1), "embeddable,", sum(1 for v in have.values() if v == 0), "blocked,", sum(1 for v in have.values() if v == -1), "gone")
