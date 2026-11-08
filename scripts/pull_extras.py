"""Add people that admins added on the site (people_extra in D1) to data/roster.json, so the next crawl
backfills their full history. Run before the crawl scripts: python3 scripts/pull_extras.py"""
import json, urllib.request
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
req = urllib.request.Request("https://feedforward.dbaney.com/api/people/extra", headers={"User-Agent": "Feedforward build"})
extra = json.load(urllib.request.urlopen(req, timeout=30))["people"]
roster = json.loads((ROOT / "data/roster.json").read_text())
have = {p["name"].lower() for p in roster["people"]}
added = 0
for p in extra:
    if p["name"].lower() in have:
        continue
    item = {"name": p["name"], "topic": p["topic"], "why": p["why"]}
    if p.get("yt"): item["yt"] = p["yt"]; item["ytMode"] = p.get("mode", "ai")
    if p.get("x"): item["x"] = p["x"]
    roster["people"].append(item); added += 1
(ROOT / "data/roster.json").write_text(json.dumps(roster, indent=1, ensure_ascii=False) + "\n")
print(added, "people added to the roster")
