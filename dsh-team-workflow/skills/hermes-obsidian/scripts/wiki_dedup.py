#!/usr/bin/env python3
"""Report high-similarity Obsidian Markdown page candidates; never modifies the vault."""
import difflib
import os
import re
import sys
from itertools import combinations

WIKI = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("OBSIDIAN_VAULT", "")
if not WIKI:
    raise SystemExit("Pass the vault path or set OBSIDIAN_VAULT")
THRESHOLD = float(sys.argv[2]) if len(sys.argv) > 2 else 0.55
EXCLUDE_DIRS = {".obsidian", "raw", ".git"}
EXCLUDE_FILES = {"index", "log", "SCHEMA"}

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
            content = handle.read()
        pages[name] = re.sub(r"^---\n.*?\n---\n", "", content, flags=re.S)


def normalize(content):
    return re.sub(r"[\s\W_]+", "", content.lower())


def similarity(left, right):
    return difflib.SequenceMatcher(None, normalize(left), normalize(right)).ratio()


candidates = []
for (left_name, left_body), (right_name, right_body) in combinations(pages.items(), 2):
    if len(normalize(left_body)) < 40 or len(normalize(right_body)) < 40:
        continue
    score = similarity(left_body, right_body)
    if score >= THRESHOLD:
        candidates.append((score, left_name, right_name))

candidates.sort(reverse=True)
if not candidates:
    print(f"OK: {len(pages)} 页两两比较，无相似度 ≥ {THRESHOLD} 的重复候选")
    sys.exit(0)

print(f"发现 {len(candidates)} 对重复候选（阈值 {THRESHOLD}）:")
for score, left_name, right_name in candidates:
    left_lines = len(pages[left_name].splitlines())
    right_lines = len(pages[right_name].splitlines())
    print(f"  [{score:.2f}] {left_name} ({left_lines}行) <-> {right_name} ({right_lines}行)")
print("\n合并建议: 人工保留内容更全/更新的一页；本工具不改写、合并或删除笔记。")
sys.exit(1)
