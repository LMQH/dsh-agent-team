#!/usr/bin/env python3
"""Wiki Ingest Helper: raw/ 原始资料的 frontmatter 生成与源漂移检测。

用法:
  python3 wiki_ingest.py --add <file>            # 为 raw 文件补 frontmatter（幂等，已存在则跳过）
  python3 wiki_ingest.py --check <file>          # 校验单个文件 sha256 是否漂移
  python3 wiki_ingest.py --check-all [raw_dir]   # 校验 raw/ 下所有带 frontmatter 的文件
  python3 wiki_ingest.py --add-all [raw_dir]     # 为 raw/ 下所有缺 frontmatter 的文件补齐
  python3 wiki_ingest.py --rehash <file>         # 按当前 body 语义重算并更新 sha256（历史迁移）
  python3 wiki_ingest.py --rehash-all [raw_dir]  # 全量重算（仅更新不匹配项）

sha256 仅对 frontmatter 之后的 body 计算（与 SCHEMA.md 约定一致）。
退出码: 0 = 无漂移/全部成功; 1 = 存在漂移或错误
"""
import hashlib
import os
import re
import sys
from datetime import date

DEFAULT_RAW = os.path.join(os.environ.get("OBSIDIAN_VAULT", ""), "raw")
FM_TMPL = "---\nsource_url: {url}\ningested: {ingested}\nsha256: {sha}\n---\n\n"


def split_frontmatter(content):
    """返回 (frontmatter_dict_or_None, body)"""
    match = re.match(r"^---\n(.*?)\n---\n\n?", content, re.S)
    if not match:
        return None, content
    frontmatter = {}
    for line in match.group(1).splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            frontmatter[key.strip()] = value.strip().strip('"').strip()
    return frontmatter, content[match.end():]


def body_sha256(body):
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def add_frontmatter(path, source_url=""):
    with open(path, encoding="utf-8") as handle:
        content = handle.read()
    frontmatter, body = split_frontmatter(content)
    if frontmatter is not None and "sha256" in frontmatter:
        print(f"[skip] {path}: frontmatter 已存在")
        return True
    if frontmatter is not None:
        existing = "".join(f"{key}: {value}\n" for key, value in frontmatter.items())
        digest = body_sha256(body)
        new_content = f"---\n{existing}source_url: {source_url}\ningested: {date.today().isoformat()}\nsha256: {digest}\n---\n\n" + body
    else:
        digest = body_sha256(content)
        new_content = FM_TMPL.format(url=source_url, ingested=date.today().isoformat(), sha=digest) + content
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(new_content)
    print(f"[add] {path}: sha256={digest[:12]}... ingested={date.today().isoformat()}")
    return True


def check_drift(path):
    with open(path, encoding="utf-8") as handle:
        content = handle.read()
    frontmatter, body = split_frontmatter(content)
    if frontmatter is None or "sha256" not in frontmatter:
        print(f"[?] {path}: 无 sha256 frontmatter（可 --add 补齐）")
        return True
    digest = body_sha256(body)
    if digest == frontmatter["sha256"]:
        print(f"[ok] {path}: sha256 一致")
        return True
    print(f"[DRIFT] {path}: body 已变更！存储 {frontmatter['sha256'][:12]}... != 当前 {digest[:12]}...（raw/ 不可变，需调查）")
    return False


def rehash(path):
    with open(path, encoding="utf-8") as handle:
        content = handle.read()
    frontmatter, body = split_frontmatter(content)
    if frontmatter is None or "sha256" not in frontmatter:
        print(f"[?] {path}: 无 sha256 frontmatter，跳过")
        return True
    digest = body_sha256(body)
    if digest == frontmatter["sha256"]:
        print(f"[ok] {path}: 已一致，无需 rehash")
        return True
    new_content = re.sub(r"^(sha256:).*$", f"sha256: {digest}", content, count=1, flags=re.M)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(new_content)
    print(f"[rehash] {path}: {frontmatter['sha256'][:12]}... -> {digest[:12]}...")
    return True


def walk_raw(raw_dir):
    for root, dirs, files in os.walk(raw_dir):
        for filename in sorted(files):
            if filename.endswith((".md", ".txt", ".markdown")):
                yield os.path.join(root, filename)


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 1
    command = args[0]
    ok = True
    if command == "--add" and len(args) == 2:
        ok = add_frontmatter(args[1])
    elif command == "--check" and len(args) == 2:
        ok = check_drift(args[1])
    elif command == "--check-all":
        raw_dir = args[1] if len(args) > 1 else DEFAULT_RAW
        if len(args) < 2 and not os.environ.get("OBSIDIAN_VAULT"):
            raise SystemExit("Pass raw_dir or set OBSIDIAN_VAULT")
        checked = 0
        for path in walk_raw(raw_dir):
            if not check_drift(path):
                ok = False
            checked += 1
        print(f"\n校验 {checked} 个文件")
    elif command == "--add-all":
        raw_dir = args[1] if len(args) > 1 else DEFAULT_RAW
        if len(args) < 2 and not os.environ.get("OBSIDIAN_VAULT"):
            raise SystemExit("Pass raw_dir or set OBSIDIAN_VAULT")
        processed = 0
        for path in walk_raw(raw_dir):
            if add_frontmatter(path):
                processed += 1
        print(f"\n处理 {processed} 个文件")
    elif command == "--rehash" and len(args) == 2:
        ok = rehash(args[1])
    elif command == "--rehash-all":
        raw_dir = args[1] if len(args) > 1 else DEFAULT_RAW
        if len(args) < 2 and not os.environ.get("OBSIDIAN_VAULT"):
            raise SystemExit("Pass raw_dir or set OBSIDIAN_VAULT")
        processed = 0
        for path in walk_raw(raw_dir):
            if rehash(path):
                processed += 1
        print(f"\n处理 {processed} 个文件")
    else:
        print(__doc__)
        return 1
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
