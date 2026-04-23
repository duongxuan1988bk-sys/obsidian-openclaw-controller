#!/usr/bin/env python3
"""
pdf_to_obsidian.py
Generic PDF -> Obsidian raw markdown converter.
Works best for text PDFs by default. Image extraction and OCR are optional.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import re
import sys
import uuid
from pathlib import Path

import fitz  # PyMuPDF

try:
    from rapidocr_onnxruntime import RapidOCR

    _rapid_ocr = RapidOCR()
    _HAS_RAPIDOCR = True
except Exception as err:
    _HAS_RAPIDOCR = False
    _rapid_ocr = None
    print(f"Warning: RapidOCR unavailable: {err}", file=sys.stderr)


DEFAULT_OUTPUT_DIR = Path.cwd()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]


def safe_filename(name: str) -> str:
    name = re.sub(r"[\\/:*?\"<>|]+", "_", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name[:120] or "pdf-note"


def detect_doc_type(text_blocks: list, image_count: int, total_text_len: int) -> str:
    """
    Decide whether the PDF is 'sop' (text-dominant) or 'paper' (image-dominant).
    Paper: many images, relatively little prose text (typical of academic papers with figures).
    SOP: mostly prose, few images.
    """
    if image_count >= 5 and total_text_len > 0:
        ratio = total_text_len / max(image_count, 1)
        if ratio < 300:
            return "paper"
    # Also check if first 3 pages are mostly images (scanned-like)
    pages_with_little_text = 0
    for block in text_blocks[:10]:
        if block["page"] > 3:
            break
        if len(block["text"].strip()) < 50:
            pages_with_little_text += 1
    if pages_with_little_text >= 2 and image_count >= 3:
        return "paper"
    return "sop"


# ---------------------------------------------------------------------------
# Image extraction
# ---------------------------------------------------------------------------

FIGURE_CAPTION_RE = re.compile(
    r"(?i)^\s*(fig(?:ure)?\.?\s*\d+[a-z]?|scheme\s*\d+[a-z]?)\b"
)


def _rect_area(rect: fitz.Rect) -> float:
    return max(0.0, rect.width) * max(0.0, rect.height)


def _rect_distance(a: fitz.Rect, b: fitz.Rect) -> float:
    dx = max(a.x0 - b.x1, b.x0 - a.x1, 0)
    dy = max(a.y0 - b.y1, b.y0 - a.y1, 0)
    return (dx * dx + dy * dy) ** 0.5


def _merged_rect(rects: list[fitz.Rect]) -> fitz.Rect:
    merged = fitz.Rect(rects[0])
    for rect in rects[1:]:
        merged.include_rect(rect)
    return merged


def _page_image_blocks(page: fitz.Page) -> list[fitz.Rect]:
    rects: list[fitz.Rect] = []
    for block in page.get_text("dict").get("blocks", []):
        if block.get("type") != 1:
            continue
        rect = fitz.Rect(block["bbox"])
        if _is_decorative_corner_visual(page, rect):
            continue
        if rect.width >= 8 and rect.height >= 8:
            rects.append(rect)
    return rects


def _is_decorative_corner_visual(page: fitz.Page, rect: fitz.Rect) -> bool:
    return (
        rect.x0 > page.rect.width * 0.70
        and rect.y0 > page.rect.height * 0.70
        and rect.width > 50
        and rect.height > 50
    )


def _is_full_page_scan_image(page: fitz.Page, rect: fitz.Rect) -> bool:
    page_area = _rect_area(page.rect)
    if page_area <= 0:
        return False
    area_ratio = _rect_area(rect) / page_area
    width_ratio = rect.width / page.rect.width if page.rect.width else 0
    height_ratio = rect.height / page.rect.height if page.rect.height else 0
    return area_ratio >= 0.70 or (width_ratio >= 0.85 and height_ratio >= 0.85)


def _page_visual_rects(page: fitz.Page) -> list[fitz.Rect]:
    page_area = _rect_area(page.rect)
    rects = _page_image_blocks(page)

    for drawing in page.get_drawings():
        rect = fitz.Rect(drawing["rect"])
        if _is_decorative_corner_visual(page, rect):
            continue
        if rect.is_empty or rect.width < 4 or rect.height < 4:
            continue
        area = _rect_area(rect)
        if area < 20 or area > page_area * 0.65:
            continue
        rects.append(rect)

    return rects


def _cluster_rects(rects: list[fitz.Rect], max_gap: float = 8.0) -> list[fitz.Rect]:
    clusters: list[list[fitz.Rect]] = []
    for rect in rects:
        target = None
        for cluster in clusters:
            expanded = _merged_rect(cluster) + (-max_gap, -max_gap, max_gap, max_gap)
            if expanded.intersects(rect):
                target = cluster
                break
        if target is None:
            clusters.append([rect])
        else:
            target.append(rect)

    changed = True
    while changed:
        changed = False
        merged_clusters: list[list[fitz.Rect]] = []
        for cluster in clusters:
            cluster_rect = _merged_rect(cluster) + (-max_gap, -max_gap, max_gap, max_gap)
            for existing in merged_clusters:
                existing_rect = _merged_rect(existing) + (-max_gap, -max_gap, max_gap, max_gap)
                if existing_rect.intersects(cluster_rect):
                    existing.extend(cluster)
                    changed = True
                    break
            else:
                merged_clusters.append(cluster)
        clusters = merged_clusters

    return [_merged_rect(cluster) for cluster in clusters]


def _caption_blocks(page: fitz.Page) -> list[tuple[str, fitz.Rect]]:
    captions: list[tuple[str, fitz.Rect]] = []
    for block in page.get_text("blocks", sort=True):
        text = " ".join(block[4].split())
        if FIGURE_CAPTION_RE.search(text):
            captions.append((text, fitz.Rect(block[:4])))
    return captions


def _render_clip(page: fitz.Page, clip: fitz.Rect, out_path: Path) -> None:
    clip = fitz.Rect(
        max(0, clip.x0),
        max(0, clip.y0),
        min(page.rect.width, clip.x1),
        min(page.rect.height, clip.y1),
    )
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), clip=clip, alpha=False)
    pix.save(str(out_path))


def _extract_rendered_figure_regions(
    pdf_doc: fitz.Document,
    assets_dir: Path,
    seen_hashes: set[str],
) -> list[dict]:
    saved: list[dict] = []

    for page_num, page in enumerate(pdf_doc):
        captions = _caption_blocks(page)
        if not captions:
            continue

        visual_clusters = [
            rect for rect in _cluster_rects(_page_visual_rects(page))
            if rect.width >= 40 and rect.height >= 25 and _rect_area(rect) >= 1500
        ]
        if not visual_clusters:
            continue

        for cap_idx, (caption, cap_rect) in enumerate(captions):
            candidate_clusters = [
                cluster for cluster in visual_clusters
                if cluster.y0 >= cap_rect.y0 - 520
                and cluster.y0 <= cap_rect.y1 + 120
                and _rect_distance(cluster, cap_rect) <= 340
            ]
            if not candidate_clusters:
                continue

            clip = _merged_rect(candidate_clusters)
            # Include nearby labels that PyMuPDF reports as text, while keeping
            # the caption itself as markdown instead of baking it into the image.
            clip = clip + (-35, -30, 14, 14)
            temp_pix = page.get_pixmap(matrix=fitz.Matrix(0.25, 0.25), clip=clip, alpha=False)
            h = sha256(temp_pix.samples)
            if h in seen_hashes:
                continue
            seen_hashes.add(h)

            filename = f"p{page_num + 1:03d}-figure-{cap_idx + 1:02d}-{h[:12]}.png"
            out_path = assets_dir / filename
            _render_clip(page, clip, out_path)
            saved.append({
                "page": page_num + 1,
                "hash": h,
                "rel_path": out_path.as_posix(),
                "caption": caption[:200],
                "filename": filename,
                "source": "rendered-region",
            })

    return saved


def _repeated_image_hashes(pdf_doc: fitz.Document) -> set[str]:
    counts: dict[str, int] = {}
    for page in pdf_doc:
        for img in page.get_images(full=True):
            try:
                base_image = pdf_doc.extract_image(img[0])
            except Exception:
                continue
            h = sha256(base_image.get("image", b""))
            counts[h] = counts.get(h, 0) + 1
    return {h for h, count in counts.items() if count >= 4}

def extract_images(
    pdf_doc: fitz.Document,
    title: str,
    assets_dir: Path,
    *,
    skip_full_page_scan_images: bool = False,
) -> tuple[list[dict], Path]:
    """
    Extract all images from PDF.
    Saves extracted images under the provided assets directory.
    Returns list of {page, hash, rel_path, caption} and the assets dir path.
    """
    assets_dir.mkdir(parents=True, exist_ok=True)

    saved: list[dict] = []
    seen_hashes: set[str] = set()
    repeated_hashes = _repeated_image_hashes(pdf_doc)

    for page_num, page in enumerate(pdf_doc):
        image_list = page.get_images(full=True)
        for img_idx, img in enumerate(image_list):
            xref = img[0]
            try:
                base_image = pdf_doc.extract_image(xref)
            except Exception:
                continue
            image_bytes = base_image["image"]
            image_ext = (base_image["ext"] or "png").lower()
            if image_ext == "jpx":
                image_ext = "jp2"
            if image_ext not in {"jpg", "jpeg", "png", "jp2", "webp", "tif", "tiff"}:
                continue
            h = sha256(image_bytes)
            if h in seen_hashes or h in repeated_hashes:
                continue

            if skip_full_page_scan_images:
                rects = page.get_image_rects(xref)
                if rects and any(_is_full_page_scan_image(page, fitz.Rect(rect)) for rect in rects):
                    continue

            width = int(base_image.get("width") or 0)
            height = int(base_image.get("height") or 0)
            if width < 160 or height < 120 or width * height < 25000:
                continue

            seen_hashes.add(h)

            filename = f"p{page_num+1:03d}-{h[:12]}.{image_ext}"
            out_path = assets_dir / filename
            out_path.write_bytes(image_bytes)

            # Try to derive a caption from nearby text
            caption = _find_caption_for_image(page, img_idx, xref)

            saved.append({
                "page": page_num + 1,
                "hash": h,
                "rel_path": out_path.as_posix(),
                "caption": caption,
                "filename": filename,
                "source": "embedded-image",
            })

    saved.extend(_extract_rendered_figure_regions(pdf_doc, assets_dir, seen_hashes))

    return saved, assets_dir


def _find_caption_for_image(
    page: fitz.Page, img_idx: int, xref: int
) -> str:
    """
    Heuristic: look for text immediately before or after the image in the
    page's text blocks, or look for a nearby paragraph with 'fig' / 'figure'.
    """
    blocks = page.get_text("dict")["blocks"]
    page_width = page.rect.width
    page_height = page.rect.height

    # Get image position
    img_rect = None
    for block in blocks:
        if block.get("type") != 1:  # not image block
            continue
        for img_item in block.get("images", []):
            if img_item.get("xref") == xref:
                img_rect = fitz.Rect(block["bbox"])
                break

    caption_candidates: list[tuple[float, str]] = []  # (distance, text)

    for block in blocks:
        if block.get("type") != 0:
            continue
        block_text = ""
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                block_text += span["text"]
        block_text = block_text.strip()
        if not block_text or len(block_text) > 300:
            continue

        # Check for figure/table keywords
        lower = block_text.lower()
        is_caption = any(kw in lower for kw in [
            "fig", "figure", "图", "图表", "scheme", "scheme"
        ])
        if not is_caption:
            continue

        # Distance from image
        block_rect = fitz.Rect(block["bbox"])
        if img_rect:
            dist = abs(block_rect.y0 - img_rect.y0) / page_height
        else:
            dist = 1.0
        caption_candidates.append((dist, block_text))

    caption_candidates.sort(key=lambda x: x[0])
    if caption_candidates:
        return caption_candidates[0][1][:200]
    return ""


# ---------------------------------------------------------------------------
# Text extraction
# ---------------------------------------------------------------------------

def _ocr_page(pdf_page: fitz.Page) -> str:
    """
    Render a single PDF page to an image and run RapidOCR.
    Returns the recognized text, or an empty string on failure.
    """
    if not _HAS_RAPIDOCR or _rapid_ocr is None:
        return ""
    try:
        mat = fitz.Matrix(2, 2)  # 2x zoom for better OCR accuracy
        pix = pdf_page.get_pixmap(matrix=mat, alpha=False)
        img_bytes = pix.tobytes("png")
        result, _ = _rapid_ocr(img_bytes)
        if not result:
            return ""
        # Join all recognized lines with spaces; preserve line breaks via \n
        lines: list[str] = []
        for item in result:
            text = item[1]
            if text.strip():
                lines.append(text)
        return "\n".join(lines)
    except Exception:
        return ""


def _ocr_pdf_with_rapidocr(pdf_doc: fitz.Document) -> list[dict]:
    """
    Run RapidOCR on every page of the PDF and return text blocks
    in the same format as extract_text_blocks().
    """
    blocks: list[dict] = []
    for page_num, page in enumerate(pdf_doc):
        text = _ocr_page(page)
        for line in text.splitlines():
            line = line.strip()
            if not line or should_skip_text_block(line, (0.0, 0.0, 0.0, 0.0)):
                continue
            blocks.append({
                "page": page_num + 1,
                "text": line,
                "bbox": (0.0, 0.0, 0.0, 0.0),
                "type": 0,
            })
    return blocks


_OCR_TEXT_LEN_THRESHOLD = 200


def extract_text_blocks(pdf_doc: fitz.Document) -> tuple[list[dict], bool]:
    """
    Extract text blocks in reading order (top-to-bottom, left-to-right).
    For scanned PDFs (very little extractable text), automatically falls back
    to RapidOCR if available.
    Returns (blocks, used_ocr).
    """
    blocks: list[dict] = []
    for page_num, page in enumerate(pdf_doc):
        page_blocks = page.get_text("blocks", sort=True)
        for block in page_blocks:
            raw_text = block[4].strip()
            if not raw_text:
                continue
            blocks.append({
                "page": page_num + 1,
                "text": raw_text,
                "bbox": (block[0], block[1], block[2], block[3]),
                "type": block[6] if len(block) > 6 else 0,
            })

    total_len = sum(len(b["text"]) for b in blocks)
    if total_len < _OCR_TEXT_LEN_THRESHOLD and _HAS_RAPIDOCR:
        ocr_blocks = _ocr_pdf_with_rapidocr(pdf_doc)
        if sum(len(b["text"]) for b in ocr_blocks) > total_len:
            blocks = ocr_blocks
            return blocks, True

    return blocks, False


def get_page_heading_levels(
    page: fitz.Page, font_sizes_on_page: list[float]
) -> dict[float, int]:
    """
    Given font sizes on a page, assign heading level (1-4) based on
    size rank. Largest = h1, next = h2, etc.
    """
    if not font_sizes_on_page:
        return {}
    unique_sizes = sorted(set(font_sizes_on_page), reverse=True)
    return {size: min(2, unique_sizes.index(size) + 1) for size in unique_sizes}


# ---------------------------------------------------------------------------
# Markdown conversion
# ---------------------------------------------------------------------------

BLOCKLIST_RE = re.compile(
    r"(?i)"
    r"(copyright|©|all rights reserved|doi:|issn:|isbn:)"
    r"|"
    r"^(advertisement|publisher|contact us|powered by)"
    r"|"
    r"^[\.\-_*#]{3,}$"
)

RUNNING_TEXT_RE = re.compile(
    r"(?i)"
    r"(BI82CH17-Muyldermans\s+ARI\s+4 March 2013\s+19:59)"
    r"|"
    r"(^BI82CH17-Muyldermans$)"
    r"|"
    r"(^ARI$)"
    r"|"
    r"(^4 March 2013$)"
    r"|"
    r"(^\d{1,2}:\d{2}$)"
    r"|"
    r"(Annu\. Rev\. Biochem\..*Downloaded from)"
    r"|"
    r"(by Yale University.*For personal use only)"
    r"|"
    r"(Changes may still occur before final publication)"
    r"|"
    r"(Review in Advance first posted online)"
    r"|"
    r"(^on March 13, 2013\.)"
    r"|"
    r"(^still occur before final publication$)"
    r"|"
    r"(^online and in print)"
    r"|"
    r"(^www\.annualreviews\.org\s+•)"
    r"|"
    r"(^17\.\d+\s*$)"
)


def should_skip_text_block(raw: str, bbox: tuple[float, float, float, float]) -> bool:
    normalized = " ".join(raw.split())
    if not normalized:
        return True
    if RUNNING_TEXT_RE.search(normalized):
        return True
    if len(normalized) <= 2 and re.fullmatch(r"[A-Z]", normalized):
        return True
    return False


def blocks_to_markdown(
    text_blocks: list[dict],
    pdf_doc: fitz.Document,
    doc_type: str,
    images: list[dict],
) -> str:
    """
    Convert PDF text blocks to clean markdown.
    Handles:
    - Heading inference (bold + font size rank)
    - List detection (numbered, hyphen, bullet)
    - Table detection (basic)
    - Blocklist filter (copyright, ads, etc.)
    - Figure/image references with obsidian ![] paths
    """
    lines: list[str] = []
    in_table = False
    prev_was_blank = True

    for block in text_blocks:
        if block["type"] != 0:
            continue
        raw = block["text"].strip()
        if not raw:
            continue

        # Filter garbage
        if BLOCKLIST_RE.search(raw) or should_skip_text_block(raw, block["bbox"]):
            continue

        page_num = block["page"]
        page = pdf_doc[page_num - 1]
        page_text_dict = page.get_text("dict")

        # Collect font info for this block
        block_font_sizes: list[float] = []
        block_bold = False
        for pg_block in page_text_dict.get("blocks", []):
            if pg_block.get("type") != 0:
                continue
            bbox = block["bbox"]
            if abs(pg_block["bbox"][0] - bbox[0]) < 5 and abs(pg_block["bbox"][1] - bbox[1]) < 5:
                for line in pg_block.get("lines", []):
                    for span in line.get("spans", []):
                        fs = round(span["size"], 1)
                        if fs > 5:
                            block_font_sizes.append(fs)
                        if "bold" in span.get("font", "").lower():
                            block_bold = True

        # Determine heading level
        heading_level = 0
        if block_bold:
            unique_sizes = sorted(set(block_font_sizes), reverse=True)
            if unique_sizes:
                top_size = unique_sizes[0]
                # Only call it a heading if text is short and size is notably large
                if len(raw) < 80 and block_font_sizes and max(block_font_sizes) >= 12:
                    level = 1
                    for i, sz in enumerate(unique_sizes):
                        if sz < top_size * 0.85:
                            level = min(i + 2, 4)
                            break
                    heading_level = level

        # Check for list
        list_match = re.match(r"^(\d+[\.\)]\s+|[a-z][\.\)]\s+|[-•*]\s+|→\s+)", raw)
        is_list = bool(list_match)

        # Check for table row
        is_table_row = "\t" in raw or re.match(r"^\|.*\|$", raw)

        # Build output line
        if heading_level > 0:
            if not prev_was_blank:
                lines.append("")
            lines.append(f"{'#' * heading_level} {raw}")
            lines.append("")
            prev_was_blank = True
        elif is_list:
            prefix = re.match(r"^(\d+[\.\)]\s+|[a-z][\.\)]\s+|[-•*]\s+|→\s+)", raw).group(1)
            content = raw[len(prefix):].strip()
            indent = "  " if re.match(r"^\d", prefix) else ""
            lines.append(f"{indent}- {content}")
            prev_was_blank = False
        elif is_table_row:
            if not in_table:
                lines.append("")
                in_table = True
            # Normalize to markdown table
            cells = [c.strip() for c in raw.strip("|").split("|")]
            sep = "|" + "|".join("---" for _ in cells) + "|"
            if not any("---" in c for c in lines[-2:] if lines):
                lines.append(sep)
            lines.append("|" + "|".join(cells) + "|")
            prev_was_blank = False
        else:
            in_table = False
            if not prev_was_blank:
                lines.append("")
            lines.append(raw)
            lines.append("")
            prev_was_blank = False

    # Add a figure gallery for extracted embedded images or rendered figure regions.
    if images:
        if lines and lines[-1].strip():
            lines.append("")
        lines.append("\n## Figures\n")
        for img in images:
            rel = img["rel_path"]
            caption = img["caption"] or f"Figure (p.{img['page']})"
            lines.append(f"**{caption}**\n![[{rel}]]\n")

    # Clean trailing whitespace
    while lines and not lines[-1].strip():
        lines.pop()
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Frontmatter builder
# ---------------------------------------------------------------------------

def build_markdown(
    title: str,
    body: str,
    source: str,
    doc_type: str,
    image_count: int,
    page_count: int,
    *,
    used_ocr: bool = False,
) -> str:
    date = dt.date.today().isoformat()
    ocr_tag = ", ocr" if used_ocr else ""
    extraction_method = "RapidOCR" if used_ocr else "PyMuPDF"
    return f"""---
title: {title}
date: {date}
source: {source}
tags: [raw, pdf, {doc_type}{ocr_tag}]
type: raw
status: draft
domain: general
workflow: pdf_to_raw
---

# {title}

## Source

> Source: {source} | Pages: {page_count} | Images: {image_count} | Type: {doc_type.upper()} | Extraction: {extraction_method}

## Original Content

{body}

---
"""


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Convert PDF to Obsidian raw markdown. "
                    "Images and OCR are optional."
    )
    parser.add_argument("input", help="PDF file path")
    parser.add_argument("--stdout", action="store_true", help="Print markdown to stdout instead of writing file")
    parser.add_argument("--title", default="", help="Override title")
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help="Output directory when not using --stdout. Default: current working directory.",
    )
    parser.add_argument(
        "--assets-dir",
        default="",
        help="Optional directory for extracted figures. If omitted in stdout mode, figures are skipped.",
    )
    args = parser.parse_args()

    pdf_path = Path(args.input).expanduser().resolve()
    if not pdf_path.exists():
        print(f"Error: PDF not found: {pdf_path}", file=sys.stderr)
        return 1

    try:
        pdf_doc = fitz.open(str(pdf_path))
    except Exception as e:
        print(f"Error opening PDF: {e}", file=sys.stderr)
        return 1

    metadata = pdf_doc.metadata
    page_count = len(pdf_doc)
    title = (
        args.title.strip()
        or metadata.get("title", "").strip()
        or ""
    )
    if not title:
        title = pdf_path.stem
    title = safe_filename(title) or "PDF Note"
    out_dir = Path(args.output_dir).expanduser()

    # Extract
    text_blocks, used_ocr = extract_text_blocks(pdf_doc)
    total_text_len = sum(len(b["text"]) for b in text_blocks)
    assets_dir_arg = args.assets_dir.strip()
    should_extract_images = bool(assets_dir_arg) or not args.stdout
    if should_extract_images:
        if assets_dir_arg:
            assets_dir = Path(assets_dir_arg).expanduser()
        else:
            assets_dir = out_dir.parent / "Assets" / safe_filename(title)
        images, _ = extract_images(
            pdf_doc,
            title,
            assets_dir,
            skip_full_page_scan_images=used_ocr,
        )
        for image in images:
            try:
                image["rel_path"] = Path(image["rel_path"]).relative_to(out_dir).as_posix()
            except Exception:
                image["rel_path"] = Path(image["rel_path"]).as_posix()
    else:
        images = []
    image_count = len(images)
    doc_type = detect_doc_type(text_blocks, image_count, total_text_len)

    body_md = blocks_to_markdown(text_blocks, pdf_doc, doc_type, images)

    md = build_markdown(
        title=title,
        body=body_md,
        source=str(pdf_path),
        doc_type=doc_type,
        image_count=image_count,
        page_count=page_count,
        used_ocr=used_ocr,
    )

    if args.stdout:
        print(md)
        return 0

    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{safe_filename(title)}.md"
    out_path.write_text(md, encoding="utf-8")

    # Print result path for the plugin caller
    print(str(out_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
