#!/usr/bin/env python3
"""Wiki Lint: 程序化健康检查（孤儿页/死链/出链/索引同步/frontmatter/tag/陈旧页/超长页）。"""
import os
import re
import sys
from collections import defaultdict
from datetime import date, datetime

WIKI = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("OBSIDIAN_VAULT", "")
if not WIKI:
    raise SystemExit("Pass the vault path or set OBSIDIAN_VAULT")
TODAY = date.today()
EXCLUDE_DIRS = {".obsidian", "raw", ".git"}
EXCLUDE_FILES = {"index", "log", "SCHEMA"}
REQ_FM = ["title", "created", "updated", "type", "tags", "sources"]
MIN_OUTLINKS = 2
STALE_DAYS = 90
MAX_LINES = 200

pages = {}
for root, dirs, files in os.walk(WIKI):
    dirs[:] = [directory for directory in dirs if directory not in EXCLUDE_DIRS]
    for filename in files:
        if not filename.endswith(".md"):
            continue
        name = os.path.splitext(filename)[0]
        if name in EXCLUDE_FILES:
            continue
        with open(os.path.join(root, filename), encoding="utf-8") as handle:
            pages[name] = handle.read()


def parse_frontmatter(content):
    match = re.match(r"^---\n(.*?)\n---\n", content, re.S)
    if not match:
        return None
    frontmatter = {}
    for line in match.group(1).splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            frontmatter[key.strip()] = value.strip().strip('"[]').strip()
    return frontmatter


outlinks = {name: {link.strip() for link in re.findall(r"\[\[([^\]|#]+)", content) if link.strip()} for name, content in pages.items()}
inlinks = defaultdict(set)
for name, links in outlinks.items():
    for link in links:
        inlinks[link].add(name)

with open(os.path.join(WIKI, "index.md"), encoding="utf-8") as handle:
    index_entries = set(re.findall(r"\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]", handle.read()))
with open(os.path.join(WIKI, "SCHEMA.md"), encoding="utf-8") as handle:
    schema = handle.read()
taxonomy = set(re.findall(r"[\w-]+", schema[schema.index("## Tag Taxonomy"):schema.index("## Page Thresholds")]))

issues = []
orphans = [name for name in pages if not inlinks.get(name)]
if orphans:
    issues.append(f"[孤儿页] 无入链: {sorted(orphans)}")
for name, links in outlinks.items():
    dead = links - set(pages.keys())
    if dead:
        issues.append(f"[死链] {name} -> {sorted(dead)}")
    if len(links) < MIN_OUTLINKS:
        issues.append(f"[出链不足] {name} 仅 {len(links)} 条 (<{MIN_OUTLINKS})")
missing_index = set(pages) - index_entries
ghost_index = index_entries - set(pages)
if missing_index:
    issues.append(f"[索引缺失] 文件存在但 index 无条目: {sorted(missing_index)}")
if ghost_index:
    issues.append(f"[幽灵条目] index 有但文件不存在: {sorted(ghost_index)}")
for name, content in pages.items():
    frontmatter = parse_frontmatter(content)
    if frontmatter is None:
        issues.append(f"[frontmatter] {name} 缺失")
        continue
    missing = [field for field in REQ_FM if field not in frontmatter]
    if missing:
        issues.append(f"[frontmatter] {name} 缺字段: {missing}")
    if "tags" in frontmatter:
        bad_tags = {tag.strip() for tag in frontmatter["tags"].split(",") if tag.strip()} - taxonomy
        if bad_tags:
            issues.append(f"[tag越界] {name}: {sorted(bad_tags)} 不在 SCHEMA taxonomy")
    if "updated" in frontmatter:
        try:
            updated = datetime.strptime(frontmatter["updated"], "%Y-%m-%d").date()
            if (TODAY - updated).days > STALE_DAYS:
                issues.append(f"[陈旧页] {name} 上次更新 {(TODAY - updated).days} 天前")
        except ValueError:
            issues.append(f"[日期格式] {name}: {frontmatter['updated']}")
    if len(content.splitlines()) > MAX_LINES:
        issues.append(f"[超长页] {name}: {len(content.splitlines())} 行 > {MAX_LINES}")

if issues:
    print(f"发现 {len(issues)} 个问题:")
    for issue in issues:
        print("  -", issue)
    sys.exit(1)
print(f"OK: {len(pages)} 页全部通过（无孤儿/死链/索引偏差/frontmatter/tag/陈旧/超长问题）")
