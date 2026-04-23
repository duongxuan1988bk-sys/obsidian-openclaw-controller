#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import html
import json
import os
import re
import ssl
import subprocess
import sys
import urllib.request
from pathlib import Path
from shutil import which
from urllib.error import URLError
from urllib.parse import urljoin, urlparse

DEFAULT_OUTPUT_DIR = Path.cwd()
WECHAT_HOSTS = {"mp.weixin.qq.com"}
MIN_CONTENT_LENGTH = 280


class BrowserExtractionError(RuntimeError):
    pass


class BrowserAutomationDisabled(BrowserExtractionError):
    pass


class FetchError(RuntimeError):
    pass


def detect_input_type(text: str) -> str:
    t = text.strip()
    return "url" if re.match(r"^https?://", t, re.I) else "text"


def is_wechat_url(url: str) -> bool:
    host = urlparse(url).netloc.lower()
    return host in WECHAT_HOSTS


def parse_browser_result(output: str) -> tuple[str, str]:
    marker = "\n<<<SEP>>>\n"
    if marker not in output:
        raise BrowserExtractionError("Browser automation returned an unexpected result.")

    title, content = output.split(marker, 1)
    return title.strip(), content.strip()


def run_osascript(lines: list[str], args: list[str]) -> str:
    cmd = ["osascript"]
    for line in lines:
        cmd.extend(["-e", line])
    cmd.extend(args)

    try:
        completed = subprocess.run(cmd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as err:
        message = (err.stderr or err.stdout or str(err)).strip()
        if "Allow Apple Events" in message or "Allow JavaScript from Apple Events" in message:
            raise BrowserAutomationDisabled(message) from err
        raise BrowserExtractionError(message) from err

    return completed.stdout.strip()


def browser_title_script() -> str:
    return (
        "(() => { "
        "const selectors = ['#activity-name', 'h1.rich_media_title', '.rich_media_title']; "
        "for (const selector of selectors) { "
        "const el = document.querySelector(selector); "
        "if (el && el.innerText && el.innerText.trim()) return el.innerText.trim(); "
        "} "
        "return document.title || ''; "
        "})();"
    )


def browser_body_script() -> str:
    return (
        "(() => { "
        "const el = document.querySelector('#js_content, .rich_media_content, section.rich_media_content'); "
        "return (el && el.innerText) ? el.innerText : document.body.innerText; "
        "})();"
    )


def extract_with_chrome(url: str) -> tuple[str, str]:
    if not Path("/Applications/Google Chrome.app").exists():
        raise BrowserExtractionError("Google Chrome is not installed.")

    lines = [
        "on run argv",
        "set urlStr to item 1 of argv",
        "tell application \"Google Chrome\"",
        "activate",
        "set newWindow to make new window",
        "set URL of active tab of newWindow to urlStr",
        "delay 2",
        f"set articleTitle to execute active tab of newWindow javascript {json.dumps(browser_title_script())}",
        f"set articleBody to execute active tab of newWindow javascript {json.dumps(browser_body_script())}",
        "close newWindow",
        "return articleTitle & linefeed & \"<<<SEP>>>\" & linefeed & articleBody",
        "end tell",
        "end run",
    ]
    return parse_browser_result(run_osascript(lines, [url]))


def extract_with_safari(url: str) -> tuple[str, str]:
    if not Path("/Applications/Safari.app").exists():
        raise BrowserExtractionError("Safari is not installed.")

    lines = [
        "on run argv",
        "set urlStr to item 1 of argv",
        "tell application \"Safari\"",
        "activate",
        "set newDocument to make new document",
        "set URL of newDocument to urlStr",
        "delay 2",
        f"set articleTitle to do JavaScript {json.dumps(browser_title_script())} in current tab of front window",
        f"set articleBody to do JavaScript {json.dumps(browser_body_script())} in current tab of front window",
        "close front window",
        "return articleTitle & linefeed & \"<<<SEP>>>\" & linefeed & articleBody",
        "end tell",
        "end run",
    ]
    return parse_browser_result(run_osascript(lines, [url]))


def extract_with_browser(url: str) -> tuple[str, str]:
    attempts: list[str] = []

    if which("osascript") is None:
        raise BrowserExtractionError("osascript is not available on this system.")

    for browser_name, extractor in (("Chrome", extract_with_chrome), ("Safari", extract_with_safari)):
        try:
            return extractor(url)
        except BrowserAutomationDisabled as err:
            attempts.append(f"{browser_name}: {err}")
        except BrowserExtractionError as err:
            attempts.append(f"{browser_name}: {err}")

    raise BrowserExtractionError(" | ".join(attempts))


def looks_like_block_page(title: str, content: str) -> bool:
    sample = f"{title}\n{content}".lower()
    keywords = [
        "环境异常",
        "访问过于频繁",
        "当前环境异常",
        "请在微信客户端打开链接",
        "anti-spam",
        "freq control",
    ]
    return any(keyword.lower() in sample for keyword in keywords)


def fetch_url_html(url: str) -> tuple[str, str]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/123.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Referer": "https://mp.weixin.qq.com/",
        },
    )
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
            final_url = resp.geturl()
            data = resp.read()
            charset = resp.headers.get_content_charset() or "utf-8"
    except (ssl.SSLCertVerificationError, URLError) as err:
        reason = getattr(err, "reason", err)
        if not isinstance(reason, ssl.SSLCertVerificationError):
            raise FetchError(str(reason)) from err
        try:
            with urllib.request.urlopen(req, timeout=30, context=ssl._create_unverified_context()) as resp:
                final_url = resp.geturl()
                data = resp.read()
                charset = resp.headers.get_content_charset() or "utf-8"
        except URLError as retry_err:
            raise FetchError(str(getattr(retry_err, "reason", retry_err))) from retry_err
    return final_url, data.decode(charset, errors="replace")


def evaluate_extraction(title: str, content: str, url: str, method: str, warnings: list[str]) -> tuple[str, list[str]]:
    notes = list(warnings)
    normalized = content.strip()

    if not normalized:
        notes.append("未提取到正文，请补发全文或在 Mac 上手动打开链接后再次处理。")
        return "failed-extract", notes

    if looks_like_block_page(title, normalized):
        notes.append("页面疑似返回了微信风控或校验页，正文未成功提取。")
        notes.append("建议补发全文，或稍后重试同一链接。")
        return "failed-extract", notes

    if method == "http" and is_wechat_url(url) and len(normalized) < MIN_CONTENT_LENGTH:
        notes.append("仅提取到较短内容，可能是摘要、校验页或残缺正文。")
        notes.append("如果这篇文章很重要，建议补发全文以避免信息缺失。")
        return "partial", notes

    return "unprocessed", notes


def fetch_url(url: str) -> tuple[str, str, str, list[str], str, str]:
    warnings: list[str] = []
    raw_html = ""
    final_url_out = url  # default to input URL; browser branch has no redirect

    if is_wechat_url(url):
        try:
            title, content = extract_with_browser(url)
            status, warnings = evaluate_extraction(title or url, content, url, "browser", warnings)
            return title or url, content, status, ["browser-dom", *warnings], raw_html, final_url_out
        except BrowserExtractionError as err:
            warnings.append(f"浏览器提取未成功，已退回 HTTP 抓取。原因：{err}")

    final_url, html_text = fetch_url_html(url)
    final_url_out = final_url
    raw_html = html_text
    title = extract_title(html_text) or final_url
    content = extract_wechat_body(html_text) or extract_main_text(html_text)
    status, warnings = evaluate_extraction(title, content, final_url, "http", warnings)
    return title, content, status, ["http-fetch", *warnings], raw_html, final_url_out


def extract_title(html_text: str) -> str:
    patterns = [
        r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\'](.*?)["\']',
        r'<meta[^>]+name=["\']title["\'][^>]+content=["\'](.*?)["\']',
        r"<title[^>]*>(.*?)</title>",
    ]
    for pat in patterns:
        m = re.search(pat, html_text, re.I | re.S)
        if m:
            title = re.sub(r"\s+", " ", html.unescape(m.group(1))).strip()
            if title:
                return title
    return ""


def extract_meta_description(html_text: str) -> str:
    m = re.search(r'<meta[^>]+name=["\']description["\'][^>]+content=["\'](.*?)["\']', html_text, re.I | re.S)
    return re.sub(r"\s+", " ", html.unescape(m.group(1))).strip() if m else ""


def strip_tags_keep_breaks(text: str) -> str:
    text = re.sub(r"(?is)<(script|style|noscript).*?>.*?</\1>", " ", text)
    text = re.sub(r"(?is)<br\s*/?>", "\n", text)
    text = re.sub(r"(?is)</p\s*>", "\n\n", text)
    text = re.sub(r"(?is)</div\s*>", "\n", text)
    text = re.sub(r"(?is)<[^>]+>", " ", text)
    text = html.unescape(text)
    text = re.sub(r"[ \t\f\v]+", " ", text)
    text = re.sub(r"\n\s+", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def extract_tag_block(html_text: str, start_tag_pattern: str) -> str:
    start_match = re.search(start_tag_pattern, html_text, re.I | re.S)
    if not start_match:
        return ""

    open_tag_match = re.match(r"(?is)<\s*([a-zA-Z0-9:_-]+)\b", start_match.group(1))
    if not open_tag_match:
        return ""

    open_tag = open_tag_match.group(1).lower()
    pos = start_match.end()
    depth = 1
    tag_pattern = re.compile(r"(?is)<(/?)\s*([a-zA-Z0-9:_-]+)([^>]*)>")

    while depth > 0:
        tag_match = tag_pattern.search(html_text, pos)
        if not tag_match:
            return ""

        is_closing = tag_match.group(1) == "/"
        tag_name = tag_match.group(2).lower()
        attrs = tag_match.group(3) or ""
        is_self_closing = attrs.rstrip().endswith("/")

        if tag_name == open_tag and not is_self_closing:
            depth += -1 if is_closing else 1

        pos = tag_match.end()

    return html_text[start_match.end():tag_match.start()]


def extract_wechat_body(html_text: str) -> str:
    candidates = [
        r'(<div[^>]+id=["\']js_content["\'][^>]*>)',
        r'(<div[^>]+class=["\'][^"\']*\brich_media_content\b[^"\']*["\'][^>]*>)',
        r'(<section[^>]+class=["\'][^"\']*\brich_media_content\b[^"\']*["\'][^>]*>)',
    ]
    for pat in candidates:
        block = extract_tag_block(html_text, pat)
        if not block:
            continue

        body = strip_tags_keep_breaks(block)
        if body:
            return body
    return ""


def extract_main_text(html_text: str) -> str:
    body = strip_tags_keep_breaks(html_text)
    desc = extract_meta_description(html_text)
    if desc and desc not in body:
        return f"{desc}\n\n{body}".strip()
    return body


def build_markdown(title: str, content: str, source: str, status: str, extraction_notes: list[str], images: list[dict] | None = None) -> str:
    date = dt.date.today().isoformat()
    content = content.strip()
    notes_md = "\n".join(f"- {note}" for note in extraction_notes) if extraction_notes else "- 提取正常"

    # Build images section if we have images
    images_md = ""
    if images:
        image_count = len(images)
        images_md = f"\n\n## Images\n\n- 共提取 {image_count} 张图片\n"
        for img in images:
            rel = img["rel_path"]
            alt = img["alt"] or "image"
            images_md += f"\n![{alt}]({rel})"

    return f"""---
title: {title}
date: {date}
source: {source}
tags: [raw, wechat]
type: raw
status: {status}
domain: general
workflow: wechat_to_raw
---

# {title}

## Source

{notes_md}

## Original Content

{content}
{images_md}
"""


def safe_filename(name: str) -> str:
    name = re.sub(r"[\\/:*?\"<>|]+", "_", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name[:120] or "wechat-note"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]


def _image_extension_from_content_type(content_type: str) -> str:
    ext = "png"
    if "jpeg" in content_type or "jpg" in content_type:
        ext = "jpg"
    elif "gif" in content_type:
        ext = "gif"
    elif "webp" in content_type:
        ext = "webp"
    return ext


def _resolve_existing_hashed_image(assets_dir: Path, content_hash: str) -> Path | None:
    matches = sorted(assets_dir.glob(f"wechat-{content_hash}.*"))
    return matches[0] if matches else None


def _write_image_bytes(data: bytes, content_type: str, assets_dir: Path) -> tuple[str, str]:
    content_hash = sha256(data)
    existing = _resolve_existing_hashed_image(assets_dir, content_hash)
    if existing is not None:
        return existing.as_posix(), existing.name

    ext = _image_extension_from_content_type(content_type)
    out_path = assets_dir / f"wechat-{content_hash}.{ext}"
    out_path.write_bytes(data)
    return out_path.as_posix(), out_path.name


_IMG_ATTRS_PRIORITY = ["data-src", "data-original", "data-ow-lazy-src", "data-ks-lazyload", "data-url", "src"]


def extract_image_urls(html_text: str, base_url: str) -> list[tuple[str, str]]:
    """
    Extract image URLs from HTML content, supporting WeChat lazy-load attributes.
    Priority: data-src > data-original > src (微信常用 data-src 存真实地址).
    Returns list of (absolute_url, alt_text) tuples.
    """
    img_pattern = re.compile(r"<img[^>]+>", re.I | re.S)
    images: list[tuple[str, str]] = []

    for match in img_pattern.finditer(html_text):
        tag = match.group(0)

        # Extract alt text if present
        alt_match = re.search(r'\balt=["\']([^"\']*)["\']', tag, re.I)
        alt = alt_match.group(1) if alt_match else ""

        # Try each priority attribute in order
        src: str | None = None
        for attr in _IMG_ATTRS_PRIORITY:
            # Build a regex for attr="value" or attr='value'
            attr_pat = re.compile(
                r'\b' + re.escape(attr) + r'=["\']([^"\']*)["\']',
                re.I,
            )
            attr_match = attr_pat.search(tag)
            if attr_match:
                candidate = attr_match.group(1).strip()
                if candidate:
                    src = candidate
                    break  # found the highest priority non-empty value

        if not src:
            continue

        # Filter out invalid sources
        src_lower = src.lower()
        if (
            not src
            or src_lower.startswith("data:")
            or src_lower.startswith("javascript:")
            or src_lower.startswith("mailto:")
            or src.startswith("#")
        ):
            continue

        # Convert relative URLs to absolute
        abs_url = urljoin(base_url, src)
        images.append((abs_url, alt))

    return images


def download_image(url: str, assets_dir: Path, title: str) -> tuple[str, str] | None:
    """
    Download an image from URL to assets directory.
    Returns (relative_path, filename) on success, None on failure.
    Attempts SSL unverified context as fallback only on SSLCertVerificationError.
    """
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/123.0.0.0 Safari/537.36"
                ),
                "Referer": "https://mp.weixin.qq.com/",
            },
        )
        ctx = ssl.create_default_context()
        with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
            data = resp.read()
            content_type = resp.headers.get("Content-Type", "image/png")
            return _write_image_bytes(data, content_type, assets_dir)
    except (ssl.SSLCertVerificationError, URLError) as err:
        reason = getattr(err, "reason", err)
        if not isinstance(reason, ssl.SSLCertVerificationError):
            print(f"[download_image] failed to download {url}: {err}", file=sys.stderr)
            return None
        # Fallback: retry with unverified context — only for cert errors
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": (
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/123.0.0.0 Safari/537.36"
                    ),
                    "Referer": "https://mp.weixin.qq.com/",
                },
            )
            with urllib.request.urlopen(req, timeout=30, context=ssl._create_unverified_context()) as resp:
                data = resp.read()
                content_type = resp.headers.get("Content-Type", "image/png")
                return _write_image_bytes(data, content_type, assets_dir)
        except Exception as retry_err:
            print(f"[download_image] SSL fallback also failed for {url}: {retry_err}", file=sys.stderr)
            return None
    except Exception as err:
        # Other network errors: log and return None (not silently swallowed)
        print(f"[download_image] failed to download {url}: {err}", file=sys.stderr)
        return None


def extract_and_download_images(
    html_text: str,
    base_url: str,
    title: str,
    assets_dir: Path,
) -> list[dict]:
    """
    Extract all images from HTML and download to assets directory.
    Deduplication strategy:
      1. URL layer: skip already-seen URLs before downloading
      2. Content layer: use sha256 of image bytes as filename; same content = same file
    Returns list of {rel_path, filename, alt} dicts.
    """
    assets_dir.mkdir(parents=True, exist_ok=True)

    image_urls = extract_image_urls(html_text, base_url)

    # URL-layer dedup: avoid redundant network requests
    seen_urls: set[str] = set()
    unique_urls: list[tuple[str, str]] = []
    for url, alt in image_urls:
        if url not in seen_urls:
            seen_urls.add(url)
            unique_urls.append((url, alt))

    downloaded: list[dict] = []
    seen_content_hashes: set[str] = set()  # dedup by content hash

    for url, alt in unique_urls:
        result = download_image(url, assets_dir, title)
        if result:
            rel_path, filename = result
            # Derive content hash from filename (format: wechat-{hash}.{ext})
            content_hash = filename.split("-", 1)[-1].rsplit(".", 1)[0] if "-" in filename else filename.rsplit(".", 1)[0]
            # Skip if same content hash already added (different URL → same image)
            if content_hash in seen_content_hashes:
                continue
            seen_content_hashes.add(content_hash)
            downloaded.append({
                "rel_path": rel_path,
                "filename": filename,
                "alt": alt,
            })

    return downloaded


def main() -> int:
    parser = argparse.ArgumentParser(description="Convert WeChat link/text to Obsidian raw markdown")
    parser.add_argument("input", help="WeChat article URL or pasted text")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument(
        "--assets-dir",
        default="",
        help="Optional directory for downloaded images. If omitted, image download is skipped in stdout mode.",
    )
    parser.add_argument("--title", default="", help="Override title")
    parser.add_argument("--stdout", action="store_true", help="Print markdown to stdout instead of writing a file")
    args = parser.parse_args()

    input_type = detect_input_type(args.input)
    raw_html = ""
    if input_type == "url":
        title, content, status, extraction_notes, raw_html, final_url = fetch_url(args.input.strip())
        source = args.input.strip()
    else:
        title = "WeChat Note"
        content = args.input.strip()
        source = "wechat-text"
        status = "unprocessed"
        extraction_notes = ["pasted-text"]
        final_url = source

    if args.title.strip():
        title = args.title.strip()

    # Extract and download images if we have raw HTML
    # Use final_url (after redirects) as base for relative URL resolution
    images: list[dict] = []
    assets_dir_arg = args.assets_dir.strip()
    should_download_images = bool(assets_dir_arg) or not args.stdout
    if raw_html and should_download_images:
        if assets_dir_arg:
            assets_dir = Path(assets_dir_arg).expanduser()
        else:
            assets_dir = Path(args.output_dir).expanduser() / "assets" / safe_filename(title)
        images = extract_and_download_images(raw_html, final_url, title, assets_dir)
    elif raw_html and args.stdout:
        extraction_notes.append("stdout 模式默认不下载图片；如需图片，请额外传入 --assets-dir。")

    md = build_markdown(title, content, source, status, extraction_notes, images)
    if args.stdout:
        print(md)
        return 0

    out_dir = Path(args.output_dir).expanduser()
    out_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{dt.datetime.now().strftime('%Y-%m-%d %H%M%S')} - {safe_filename(title)}.md"
    out_path = out_dir / filename
    out_path.write_text(md, encoding="utf-8")
    print(str(out_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
