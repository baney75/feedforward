"""Tag every video and post with a topic and a teaching-value score using Claude Haiku (claude -p).

Results are cached in data/cache/class.json as {"v:<id>": [topic, q], "p:<id>": [topic, q]}, so reruns
only classify new items. Usage: python3 scripts/classify.py [videos|shorts|posts|all]
"""
import json, subprocess, sys, os, threading, concurrent.futures as cf
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data/cache/class.json"; CACHE.parent.mkdir(parents=True, exist_ok=True)
cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
lock = threading.Lock()
TOPICS = ["foundations", "local", "agents", "research", "math", "cs", "systems", "making", "labs", "off"]

GUIDE = """You label items for LocalTube, a learning feed about AI, computer science, and CAD/3D printing.
For each item give a topic code and a quality score q.

Topic codes:
- foundations: how neural networks and LLMs work, ML basics, training, architectures, tutorials that teach these
- local: running models on your own hardware, open weights, quantization, llama.cpp, Ollama, MLX, LM Studio, home GPU rigs
- agents: AI agents, coding agents and harnesses (Claude Code, Codex, Pi, opencode, Cursor), tools, MCP, prompting, evals, building apps with LLMs
- research: papers, researcher interviews, interpretability, alignment and safety research, benchmarks, where AI capability is going
- math: mathematics (linear algebra, calculus, probability, statistics, geometry, puzzles with real math)
- cs: computer science and programming not specifically about AI: algorithms, OS, compilers, digital logic, languages, web dev, security
- systems: GPUs, kernels, CUDA, chips and semiconductors, inference serving, distributed training, datacenters as compute
- making: CAD, 3D printing, machining, robotics and electronics builds
- labs: model or product announcements and company news from AI labs
- off: non-technical content only. Always off: politics, elections, government policy fights, culture war, religion, personal life, family, sports, travel, food, jokes or memes with no technical content, giveaways, sponsorships and ads, hiring posts, drama about people, generic life or career advice.

These sources are hand-picked experts, so most technical posts belong to a topic. Building software with AI tools counts as agents. Security research counts as cs. When an item is technical but fits no topic well, pick the closest one. Use off only for content that is not technical at all.

q (teaching value for a curious learner):
3 = teaches something real or is a substantive release/insight worth a learner's time
2 = solid technical content
1 = thin: a one-liner, hype, short reaction, vague teaser
0 = no value

Reply with ONLY a JSON array, one entry per item, in the same order: [["<id>","<topic>",<q>], ...]. No prose."""


def ask(lines, model="haiku"):
    err = None
    prompt = GUIDE + "\n\nItems:\n" + "\n".join(lines)
    for _ in range(3):
        try:
            r = subprocess.run(["claude", "-p", "--model", model, "--tools", "", "--no-session-persistence",
                                "--setting-sources", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}'],
                               input=prompt, capture_output=True, text=True, timeout=300,
                               env={k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"})
            out = r.stdout
            a, b = out.find("["), out.rfind("]")
            return json.loads(out[a:b + 1])
        except Exception as e:
            err = e
    print("batch failed", err, file=sys.stderr, flush=True)
    return []


def run(prefix, items, size, model="haiku"):
    todo = [it for it in items if f"{prefix}:{it[0]}" not in cache]
    batches = [todo[i:i + size] for i in range(0, len(todo), size)]
    print(f"{prefix}: {len(items)} items, {len(todo)} to classify in {len(batches)} batches", flush=True)

    def work(batch):
        res = ask([line for _, line in batch], model)
        ok = 0
        with lock:
            for row in res:
                try:
                    i, t, q = str(row[0]), row[1], int(row[2])
                except Exception:
                    continue
                if t in TOPICS:
                    cache[f"{prefix}:{i}"] = [t, max(0, min(3, q))]; ok += 1
        return ok

    done = 0
    with cf.ThreadPoolExecutor(8) as ex:
        for n, ok in enumerate(ex.map(work, batches)):
            done += ok
            if n % 10 == 0:
                with lock:
                    CACHE.write_text(json.dumps(cache))
                print(f"  {prefix} batch {n + 1}/{len(batches)} ({done} labeled)", flush=True)
    CACHE.write_text(json.dumps(cache))


def clip(s, n):
    s = " ".join((s or "").split())
    return s if len(s) <= n else s[:n] + "..."


what = sys.argv[1] if len(sys.argv) > 1 else "all"
if what in ("videos", "all"):
    items = []
    for f in sorted((ROOT / "data/raw/yt").glob("*.json")):
        d = json.loads(f.read_text())
        for v in d["videos"]:
            items.append((v["id"], f'{v["id"]} | channel: {d["channel"]} | title: {clip(v["t"], 160)}'))
    run("v", items, 120)
if what in ("shorts", "all"):
    items = []
    for f in sorted((ROOT / "data/raw/shorts").glob("*.json")):
        d = json.loads(f.read_text())
        for v in d["videos"]:
            items.append((v["id"], f'{v["id"]} | channel: {d["channel"]} | short video title: {clip(v["t"], 160)}'))
    run("s", items, 120)
if what in ("posts", "all"):
    items = []
    for f in sorted((ROOT / "data/raw/x").glob("*.json")):
        d = json.loads(f.read_text())
        for p in d["posts"]:
            extra = ""
            if p.get("quote"): extra += f' | quoting: {clip(p["quote"].get("text"), 200)}'
            if p.get("card") and p["card"].get("title"): extra += f' | link: {clip(p["card"]["title"], 100)}'
            who = (p.get("author") or {}).get("screen_name") or d["handle"]
            items.append((p["id"], f'{p["id"]} | @{who} | {clip(p["text"], 500)}{extra}'))
    run("p", items, 50, "sonnet")
