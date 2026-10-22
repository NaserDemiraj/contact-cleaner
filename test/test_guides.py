"""The search guides: each is a real page, listed in the sitemap, linked from the
home page, and leads to the tool. Static checks only; no browser needed.

Run: python -m pytest test/test_guides.py
"""
import re
from pathlib import Path
from urllib.parse import urldefrag

import pytest

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://naserdemiraj.github.io/contact-cleaner/"
GUIDES = sorted((ROOT / "guides").glob("*.html"))


def text(path):
    return path.read_text(encoding="utf-8")


def test_there_are_guides():
    assert len(GUIDES) >= 3


@pytest.mark.parametrize("page", GUIDES, ids=lambda p: p.name)
def test_each_guide_is_a_complete_page(page):
    html = text(page)
    title = re.search(r"<title>(.*?)</title>", html).group(1)
    desc = re.search(r'<meta name="description" content="(.*?)">', html).group(1)
    assert 25 <= len(title) <= 70, title
    assert 80 <= len(desc) <= 175, len(desc)
    url = f"{BASE}guides/{page.name}"
    assert f'<link rel="canonical" href="{url}">' in html
    assert f'<meta property="og:url" content="{url}">' in html
    assert html.count("<h1>") == 1
    assert "<script" not in html                      # nothing to execute on a static guide
    assert "connect-src" not in html or "'none'" in html
    assert 'href="../"' in html                       # leads to the tool
    assert "maker of Contact Cleaner" in html         # who is speaking, said plainly


def test_titles_and_descriptions_are_unique():
    titles = [re.search(r"<title>(.*?)</title>", text(p)).group(1) for p in GUIDES]
    descs = [re.search(r'name="description" content="(.*?)"', text(p)).group(1) for p in GUIDES]
    assert len(set(titles)) == len(titles) and len(set(descs)) == len(descs)


def test_the_sitemap_lists_the_home_page_and_every_guide():
    sitemap = text(ROOT / "sitemap.xml")
    listed = set(re.findall(r"<loc>(.*?)</loc>", sitemap))
    assert listed == {BASE} | {f"{BASE}guides/{p.name}" for p in GUIDES}


def test_robots_points_to_the_sitemap():
    assert f"Sitemap: {BASE}sitemap.xml" in text(ROOT / "robots.txt")


def test_the_home_page_links_to_every_guide_for_the_free_edition_only():
    home = text(ROOT / "index.html")
    block = re.search(r'<p class="small" data-only="free">Guides:(.*?)</p>', home, re.S).group(1)
    for page in GUIDES:
        assert f'href="guides/{page.name}"' in block


@pytest.mark.parametrize("page", GUIDES, ids=lambda p: p.name)
def test_every_local_link_resolves(page):
    for href in re.findall(r'href="([^"]+)"', text(page)):
        href = urldefrag(href)[0]
        if not href or href.startswith(("http", "data:")):
            continue
        assert (page.parent / href).resolve().exists() or (page.parent / href).resolve().is_dir(), href


def test_guides_do_not_repeat_the_wrong_claim_that_remove_duplicates_is_case_sensitive():
    for page in GUIDES + [ROOT / "index.html"]:
        html = text(page).lower()
        assert "different capitals" not in html, page.name
        assert "character for character" not in html, page.name
