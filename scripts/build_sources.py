"""Write worker/sources.json: what the cron job checks for fresh uploads and posts."""
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
people = json.loads((ROOT / "public/data/people.json").read_text())
src = [{"i": p["i"], "name": p["name"], "yt": p.get("ytId"), "mode": p.get("mode", "all"), "x": p.get("x"), "twitch": p.get("twitch"), "topic": p["topic"]} for p in people if p.get("ytId") or p.get("x") or p.get("twitch")]
(ROOT / "worker/sources.json").write_text(json.dumps(src))
print(len(src), "sources")
