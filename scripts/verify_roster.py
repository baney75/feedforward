"""Resolve every YouTube handle and X account in data/roster.json.

Writes data/roster.resolved.json with channel ids and X profile data.
Exits 1 if any source fails to resolve, listing each failure.
"""
import json, subprocess, sys, time, urllib.request, concurrent.futures as cf
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
roster = json.loads((ROOT / "data/roster.json").read_text())
UA = "Mozilla/5.0 Feedforward/1.0 (+https://feedforward.dbaney.com)"


def fx(path, tries=6):
    for i in range(tries):
        try:
            req = urllib.request.Request("https://api.fxtwitter.com/" + path, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=20) as r:
                d = json.load(r)
                if d.get("code") == 200:
                    return d
        except Exception:
            pass
        time.sleep(1.5 * (i + 1))
    return None


def yt(handle):
    # One flat entry is enough to learn the channel id and title.
    p = subprocess.run(
        ["yt-dlp", "--flat-playlist", "-I", "1", "-J", f"https://www.youtube.com/{handle}/videos"],
        capture_output=True, text=True, timeout=120,
    )
    if p.returncode:
        return None, p.stderr.strip().splitlines()[-1:] if p.stderr else ["?"]
    d = json.loads(p.stdout)
    return {"id": d.get("channel_id") or d.get("id"), "title": d.get("channel") or d.get("title"),
            "followers": d.get("channel_follower_count")}, None


def resolve(person):
    out, errs = dict(person), []
    if person.get("yt"):
        info, err = yt(person["yt"])
        if info:
            out["ytInfo"] = info
        else:
            errs.append(f"yt {person['yt']}: {err}")
    if person.get("x"):
        d = fx(person["x"])
        if d:
            u = d["user"]
            out["xInfo"] = {"name": u.get("name"), "followers": u.get("followers"),
                            "avatar": u.get("avatar_url"), "bio": u.get("description")}
        else:
            errs.append(f"x {person['x']}: not found")
    return out, errs


people, failures = [], []
with cf.ThreadPoolExecutor(6) as ex:
    for out, errs in ex.map(resolve, roster["people"]):
        people.append(out)
        failures += [f"{out['name']}: {e}" for e in errs]
        print(("FAIL " if errs else "ok   ") + out["name"], *errs, flush=True)

(ROOT / "data/roster.resolved.json").write_text(json.dumps({**roster, "people": people}, indent=1))
print(f"\n{len(people)} people, {len(failures)} failures")
for f in failures:
    print("  ", f)
sys.exit(1 if failures else 0)
