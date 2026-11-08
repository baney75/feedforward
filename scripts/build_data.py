"""Build the app's data files in public/data from the raw crawl, the topic labels and the roster.

Outputs:
  public/data/people.json  people with avatars and links
  public/data/videos.json  {"rows": [[id, title, seconds, views, ts, person, topic, q, score], ...]}
  public/data/posts.json   {"rows": [{...}, ...]}
  public/data/meta.json    counts and build time
Run: python3 scripts/build_data.py
"""
import json, math, re, statistics, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public/data"; OUT.mkdir(parents=True, exist_ok=True)
TOPICS = ["foundations", "local", "agents", "research", "math", "cs", "systems", "making", "labs"]
roster = json.loads((ROOT / "data/roster.json").read_text())
labels = json.loads((ROOT / "data/cache/class.json").read_text())
EMBED = json.loads((ROOT / "data/cache/embed.json").read_text()) if (ROOT / "data/cache/embed.json").exists() else {}
playable = lambda vid: EMBED.get(vid, 1) == 1   # 0: owner blocked embedding, -1: removed or private
yt_av = json.loads((ROOT / "data/cache/yt_avatars.json").read_text()) if (ROOT / "data/cache/yt_avatars.json").exists() else {}
NOW = time.time()

# Words that always remove a post or video from the feed, as a backstop to the classifier.
BLOCK = re.compile(r"\b(trump|biden|harris|vance|democrat|republican|maga|election|congress|senate|"
                   r"immigra\w*|abortion|israel|gaza|palestin\w*|ukraine|putin|woke|left-wing|right-wing|"
                   r"jesus|christ|bible|god|allah|religio\w*|sponsor(ed)?|giveaway|discount code|promo code)\b", re.I)


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


people, by_yt, by_x = [], {}, {}
for p in roster["people"]:
    i = len(people)
    yt_file = ROOT / "data/raw/yt" / f"{p['yt'].strip('@').lower()}.json" if p.get("yt") else None
    yt = json.loads(yt_file.read_text()) if yt_file and yt_file.exists() else None
    x_file = ROOT / "data/raw/x" / f"{p['x'].lower()}.json" if p.get("x") else None
    xd = json.loads(x_file.read_text()) if x_file and x_file.exists() else None
    xav = None
    if xd:
        for post in xd["posts"]:
            a = post.get("author") or {}
            if (a.get("screen_name") or "").lower() == p["x"].lower() and a.get("avatar_url"):
                xav = a["avatar_url"]; break
    people.append({
        "i": i, "slug": slug(p["name"]), "name": p["name"], "topic": p["topic"], "why": p["why"],
        "yt": p.get("yt"), "ytId": yt and yt.get("channel_id"), "ytSubs": yt and yt.get("followers"),
        "x": p.get("x"), "twitch": p.get("twitch"), "av": xav or yt_av.get(p.get("yt") or "") or None,
        "mode": p.get("ytMode", "all"),
    })
    if yt: by_yt[i] = yt
    if xd: by_x[i] = xd

# ---------- Videos ----------
rows = []
for i, yt in by_yt.items():
    person = people[i]
    vids = [v for v in yt["videos"] if v.get("t") and (v.get("d") or 0) >= 60]
    logs = [math.log10((v.get("v") or 0) + 1) for v in vids]
    med = statistics.median(logs) if logs else 0
    for v in vids:
        lab = labels.get(f"v:{v['id']}")
        if not playable(v["id"]):
            continue
        topic, q = (lab or [person["topic"], 2])
        # "off" means ads, politics, religion, personal or other non-technical content: drop it from every channel.
        if topic == "off":
            continue
        if person["mode"] == "ai" and (not lab or q < 1):
            continue
        if person["mode"] == "ai" and BLOCK.search(v["t"]):
            continue
        views = v.get("v") or 0
        ts = v.get("ts") or 0
        rel = max(-2, min(2, math.log10(views + 1) - med))
        age_years = (NOW - ts) / 31557600 if ts else 5
        recency = max(0, 8 - 2.5 * age_years)
        score = round(max(0, min(100, 50 + 14 * rel + 7 * (q - 2) + recency)))
        rows.append([v["id"], v["t"], v.get("d") or 0, views, ts, i, TOPICS.index(topic), q, score])

seen = set(); uniq = []
for r in rows:
    if r[0] not in seen:
        seen.add(r[0]); uniq.append(r)
rows = uniq
rows.sort(key=lambda r: -r[8])
(OUT / "videos.json").write_text(json.dumps({"cols": ["id", "title", "sec", "views", "ts", "person", "topic", "q", "score"], "rows": rows},
                                            ensure_ascii=False, separators=(",", ":")))

# ---------- Posts ----------
def media(p):
    m = {}
    if p.get("photos"):
        m["ph"] = [[x["url"], x.get("w"), x.get("h")] for x in p["photos"][:4] if x.get("url")]
    if p.get("videos"):
        v = p["videos"][0]
        if v.get("url"):
            m["vd"] = [v["url"], v.get("thumb"), v.get("w"), v.get("h")]
    if p.get("card") and p["card"].get("url") and p["card"].get("title"):
        m["cd"] = [p["card"]["url"], p["card"]["title"], p["card"].get("description") or "", p["card"].get("image")]
    return m


posts = []
for i, xd in by_x.items():
    handle = people[i]["x"].lower()
    mine = [p for p in xd["posts"] if (p.get("author") or {}).get("screen_name", "").lower() == handle and not p.get("repost_by")]
    likes = [math.log10((p.get("likes") or 0) + 1) for p in mine]
    med = statistics.median(likes) if likes else 0
    kept = []
    for p in mine:
        if p.get("reply_to") and p["reply_to"].lower() != handle:
            continue
        lab = labels.get(f"p:{p['id']}")
        if not lab or lab[0] == "off" or lab[1] < 2:
            continue
        text = p.get("text") or ""
        # A short hot take on top of someone else's post isn't teaching: keep it only if it scored top marks.
        if len(text.strip()) < 80 and lab[1] < 3:
            continue
        if BLOCK.search(text) or (p.get("quote") and BLOCK.search(p["quote"].get("text") or "")):
            continue
        rel = max(-2, min(2.5, math.log10((p.get("likes") or 0) + 1) - med))
        score = round(max(0, min(100, 50 + 14 * rel + 9 * (lab[1] - 2))))
        rec = {"id": p["id"], "p": i, "t": text, "ts": p.get("ts") or 0, "l": p.get("likes") or 0, "r": p.get("reposts") or 0,
               "c": p.get("replies") or 0, "v": p.get("views") or 0, "tp": TOPICS.index(lab[0]), "q": lab[1], "s": score}
        rec.update(media(p))
        qt = p.get("quote")
        if qt and qt.get("text") is not None:
            qa = qt.get("author") or {}
            rec["qt"] = {"id": qt["id"], "n": qa.get("name"), "h": qa.get("screen_name"), "a": qa.get("avatar_url"),
                         "t": qt.get("text") or "", "ts": qt.get("ts") or 0, **media(qt)}
        kept.append(rec)
    kept.sort(key=lambda r: -r["s"])
    posts += kept[:80]

posts.sort(key=lambda r: -r["ts"])
(OUT / "posts.json").write_text(json.dumps({"rows": posts}, ensure_ascii=False, separators=(",", ":")))

# ---------- Shorts ----------
shorts = []
for i, person in enumerate(people):
    if not person.get("yt"):
        continue
    f = ROOT / "data/raw/shorts" / f"{person['yt'].strip('@').lower()}.json"
    if not f.exists():
        continue
    vids = json.loads(f.read_text())["videos"]
    logs = [math.log10((v.get("v") or 0) + 1) for v in vids]
    med = statistics.median(logs) if logs else 0
    for v in vids:
        lab = labels.get(f"s:{v['id']}")
        if not lab or lab[0] == "off" or lab[1] < 2 or not v.get("t") or BLOCK.search(v["t"]) or not playable(v["id"]):
            continue
        rel = max(-2, min(2, math.log10((v.get("v") or 0) + 1) - med))
        score = round(max(0, min(100, 50 + 14 * rel + 8 * (lab[1] - 2))))
        shorts.append([v["id"], v["t"], v.get("v") or 0, i, TOPICS.index(lab[0]), lab[1], score])
shorts.sort(key=lambda r: -r[6])
(OUT / "shorts.json").write_text(json.dumps({"cols": ["id", "title", "views", "person", "topic", "q", "score"], "rows": shorts},
                                            ensure_ascii=False, separators=(",", ":")))

for p in people:
    p["nv"] = sum(1 for r in rows if r[5] == p["i"])
    p["np"] = sum(1 for r in posts if r["p"] == p["i"])
(OUT / "people.json").write_text(json.dumps(people, ensure_ascii=False, separators=(",", ":")))
meta = {"built": int(NOW), "videos": len(rows), "posts": len(posts), "people": len(people), "shorts": len(shorts),
        "byTopic": {t: sum(1 for r in rows if r[6] == k) for k, t in enumerate(TOPICS)},
        "postsByTopic": {t: sum(1 for r in posts if r["tp"] == k) for k, t in enumerate(TOPICS)}}
(OUT / "meta.json").write_text(json.dumps(meta))

# ---------- Starter bundle: enough to paint Home instantly; the full catalog loads behind it ----------
pick, seen_ids = [], set()
by_person = {}
for r in rows:
    by_person.setdefault(r[5], []).append(r)
for lst in by_person.values():
    for r in lst[:10]:
        if r[0] not in seen_ids:
            seen_ids.add(r[0]); pick.append(r)
for r in rows:
    if len(pick) >= 1100: break
    if r[7] >= 3 and r[0] not in seen_ids:
        seen_ids.add(r[0]); pick.append(r)
now_s = NOW
best = sorted(posts, key=lambda p: -(p["s"] + 18 * math.exp(-(now_s - p["ts"]) / (86400 * 21))))[:140]
latest = sorted(posts, key=lambda p: -p["ts"])[:60]
hp = {p["id"]: p for p in best + latest}
(OUT / "home.json").write_text(json.dumps({"people": people, "meta": meta, "videos": pick, "posts": list(hp.values()), "shorts": shorts[:40]},
                                          ensure_ascii=False, separators=(",", ":")))
print(json.dumps(meta, indent=1))
for f in ("home.json", "videos.json", "posts.json", "shorts.json", "people.json"):
    print(f, round((OUT / f).stat().st_size / 1e6, 2), "MB")
