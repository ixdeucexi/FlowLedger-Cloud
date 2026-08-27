import hashlib
import json
from pathlib import Path

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "artifacts" / "mobile" / "public" / "FlowLedger-User-Guide.pdf"
CONTENT = ROOT / "artifacts" / "mobile" / "lib" / "userGuideContent.json"
PAGE_WIDTH, PAGE_HEIGHT = letter

NAVY = HexColor("#050817")
CARD = HexColor("#10182B")
CARD_ALT = HexColor("#121D34")
BORDER = HexColor("#293552")
PURPLE = HexColor("#A45BFF")
CYAN = HexColor("#35D3E5")
GREEN = HexColor("#32D078")
GOLD = HexColor("#F6B82E")
RED = HexColor("#FF6682")
MUTED = HexColor("#AAB3C8")
SOFT = HexColor("#D9DEEA")


def pdf_text(text):
    return (
        str(text)
        .replace("\u2192", "->")
        .replace("\u2014", "-")
        .replace("\u2013", "-")
        .replace("\u2019", "'")
        .replace("\u201c", '"')
        .replace("\u201d", '"')
    )


def wrapped_lines(text, font_name, font_size, max_width):
    text = pdf_text(text)
    words = text.split()
    lines = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if current and stringWidth(candidate, font_name, font_size) > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def draw_wrapped(c, text, x, y, width, font="Helvetica", size=10.5, color=SOFT, leading=14):
    c.setFont(font, size)
    c.setFillColor(color)
    for line in wrapped_lines(text, font, size, width):
        c.drawString(x, y, line)
        y -= leading
    return y


def rounded_card(c, x, y, width, height, fill=CARD, stroke=BORDER, radius=16):
    c.setFillColor(fill)
    c.setStrokeColor(stroke)
    c.setLineWidth(0.8)
    c.roundRect(x, y, width, height, radius, fill=1, stroke=1)


def page_base(c, page_number, eyebrow, title, intro, accent=PURPLE):
    c.setFillColor(NAVY)
    c.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, fill=1, stroke=0)
    c.setFillColor(accent)
    c.circle(PAGE_WIDTH - 20, PAGE_HEIGHT - 45, 86, fill=1, stroke=0)
    c.setFillColor(NAVY)
    c.circle(PAGE_WIDTH - 8, PAGE_HEIGHT - 33, 67, fill=1, stroke=0)
    c.setFillColor(PURPLE)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(42, PAGE_HEIGHT - 42, "FLOWLEDGER")
    c.setFillColor(accent)
    c.setFont("Helvetica-Bold", 8.5)
    c.drawString(42, PAGE_HEIGHT - 69, eyebrow.upper())
    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 27)
    c.drawString(42, PAGE_HEIGHT - 104, title)
    intro_bottom = draw_wrapped(c, intro, 42, PAGE_HEIGHT - 128, PAGE_WIDTH - 84, size=10.5, color=MUTED, leading=14)
    c.setStrokeColor(BORDER)
    c.line(42, intro_bottom - 6, PAGE_WIDTH - 42, intro_bottom - 6)
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 8)
    c.drawString(42, 24, "FlowLedger User Guide - Updated August 27, 2026")
    c.drawRightString(PAGE_WIDTH - 42, 24, f"Page {page_number}")
    return intro_bottom - 25


def section_title(c, text, x, y, color=CYAN):
    c.setFillColor(color)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(x, y, text.upper())
    return y - 18


def bullet(c, number, title, body, x, y, width, accent=PURPLE):
    body_lines = wrapped_lines(body, "Helvetica", 9.6, width - 50)
    height = max(58, 36 + len(body_lines) * 13)
    rounded_card(c, x, y - height, width, height, fill=CARD_ALT)
    c.setFillColor(accent)
    c.circle(x + 23, y - 25, 13, fill=1, stroke=0)
    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 9)
    c.drawCentredString(x + 23, y - 28, str(number))
    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(x + 44, y - 22, title)
    draw_wrapped(c, body, x + 44, y - 39, width - 58, size=9.6, color=MUTED, leading=13)
    return y - height - 9


def callout(c, title, body, y, accent=GREEN):
    body_lines = wrapped_lines(body, "Helvetica", 9.5, PAGE_WIDTH - 124)
    height = 47 + len(body_lines) * 13
    rounded_card(c, 42, y - height, PAGE_WIDTH - 84, height, fill=CARD, stroke=accent)
    c.setFillColor(accent)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(58, y - 22, title)
    draw_wrapped(c, body, 58, y - 39, PAGE_WIDTH - 116, size=9.5, color=SOFT, leading=13)
    return y - height - 8


def finish_page(c):
    c.showPage()


def item_height(item, width):
    body_lines = wrapped_lines(item["body"], "Helvetica", 8.6, width - 28)
    title_lines = wrapped_lines(item["title"], "Helvetica-Bold", 9.5, width - 28)
    return max(49, 22 + len(title_lines) * 11 + len(body_lines) * 11)


def guide_item(c, item, x, y, width, accent):
    height = item_height(item, width)
    rounded_card(c, x, y - height, width, height, fill=CARD_ALT)
    c.setFillColor(accent)
    c.circle(x + 14, y - 17, 4, fill=1, stroke=0)
    title_y = draw_wrapped(
        c,
        item["title"],
        x + 25,
        y - 15,
        width - 36,
        font="Helvetica-Bold",
        size=9.5,
        color=white,
        leading=11,
    )
    draw_wrapped(
        c,
        item["body"],
        x + 14,
        title_y - 4,
        width - 28,
        size=8.6,
        color=MUTED,
        leading=11,
    )
    return y - height - 7


def draw_section_column(c, section, x, y, width, accent):
    y = section_title(c, section["title"], x, y, accent)
    for item in section["items"]:
        y = guide_item(c, item, x, y, width, accent)
    return y


def draw_catalog_page(c, page_number, slide):
    accent = HexColor(slide["accent"])
    y = page_base(
        c,
        page_number,
        slide["eyebrow"],
        slide["title"],
        slide["intro"],
        accent,
    )
    sections = slide["sections"]
    gap = 14
    column_width = (PAGE_WIDTH - 84 - gap) / 2

    if len(sections) == 1:
        section = sections[0]
        y = section_title(c, section["title"], 42, y, accent)
        items = section["items"]
        midpoint = (len(items) + 1) // 2
        left_y = y
        right_y = y
        for item in items[:midpoint]:
            left_y = guide_item(c, item, 42, left_y, column_width, accent)
        for item in items[midpoint:]:
            right_y = guide_item(
                c,
                item,
                42 + column_width + gap,
                right_y,
                column_width,
                accent,
            )
    else:
        draw_section_column(c, sections[0], 42, y, column_width, accent)
        draw_section_column(
            c,
            sections[1],
            42 + column_width + gap,
            y,
            column_width,
            accent,
        )

    callout(c, slide["callout"]["title"], slide["callout"]["body"], 104, accent)
    finish_page(c)


def build():
    catalog_bytes = CONTENT.read_bytes()
    source_hash = hashlib.sha256(
        catalog_bytes + b"\0" + Path(__file__).read_bytes()
    ).hexdigest()
    catalog = json.loads(catalog_bytes.decode("utf-8"))
    if len(catalog) != 10:
        raise ValueError(f"Expected 10 guide pages, found {len(catalog)}")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    # Keep guide text inspectable by the release artifact scanner. The file is
    # small, and verifiable public copy is more important than PDF compression.
    c = canvas.Canvas(str(OUTPUT), pagesize=letter, pageCompression=0)
    c.setTitle("FlowLedger User Guide")
    c.setAuthor("FlowLedger")
    c.setSubject("Current Dashboard, Activity, Bills, Forecast, payoff, Flo, and Settings guidance")
    c.setKeywords(f"FlowLedgerGuideSourceSHA256:{source_hash}")

    cover = catalog[0]
    cover_accent = HexColor(cover["accent"])
    c.setFillColor(NAVY)
    c.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, fill=1, stroke=0)
    c.setFillColor(PURPLE)
    c.circle(PAGE_WIDTH - 42, PAGE_HEIGHT - 52, 118, fill=1, stroke=0)
    c.setFillColor(NAVY)
    c.circle(PAGE_WIDTH - 8, PAGE_HEIGHT - 22, 90, fill=1, stroke=0)
    c.setFillColor(cover_accent)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(48, PAGE_HEIGHT - 74, pdf_text(cover["eyebrow"]))
    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 34)
    title_lines = wrapped_lines(cover["title"], "Helvetica-Bold", 34, PAGE_WIDTH - 96)
    title_y = PAGE_HEIGHT - 125
    for line in title_lines:
        c.drawString(48, title_y, line)
        title_y -= 41
    draw_wrapped(c, cover["intro"], 48, title_y - 1, PAGE_WIDTH - 96, size=12, color=MUTED, leading=17)
    y = PAGE_HEIGHT - 285
    cover_items = cover["sections"][0]["items"]
    cover_colors = [GREEN, CYAN, GOLD, PURPLE]
    for number, (item, accent) in enumerate(zip(cover_items, cover_colors), 1):
        rounded_card(c, 48, y - 52, PAGE_WIDTH - 96, 52, fill=CARD_ALT, stroke=accent)
        c.setFillColor(accent)
        c.circle(74, y - 26, 13, fill=1, stroke=0)
        c.setFillColor(white)
        c.setFont("Helvetica-Bold", 9)
        c.drawCentredString(74, y - 29, str(number))
        c.setFont("Helvetica-Bold", 13)
        c.drawString(98, y - 22, pdf_text(item["title"]))
        c.setFont("Helvetica", 8.8)
        c.setFillColor(MUTED)
        c.drawString(98, y - 37, pdf_text(item["body"]))
        y -= 66
    callout(c, cover["callout"]["title"], cover["callout"]["body"], y - 3, accent=RED)
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 9)
    c.drawString(48, 30, "Phone, installed PWA, and desktop - updated August 27, 2026")
    finish_page(c)

    for page_number, slide in enumerate(catalog[1:], 2):
        draw_catalog_page(c, page_number, slide)

    c.save()
    print(f"Built {OUTPUT}")


if __name__ == "__main__":
    build()
