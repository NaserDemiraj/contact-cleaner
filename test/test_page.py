"""Browser tests for both editions (needs `node build.mjs` first).

Run: python -m pytest test/test_page.py   (Playwright + installed Chrome or Edge)
"""
import csv
import io
from pathlib import Path

import pytest
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "test" / "fixtures"
SITE = (ROOT / "dist" / "site" / "index.html").as_uri()
PRO = (ROOT / "dist" / "contact-cleaner-pro.html").as_uri()


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as pw:
        b = None
        for options in ({"channel": "chrome"}, {"channel": "msedge"}, {}):
            try:
                b = pw.chromium.launch(headless=True, **options)
                break
            except Exception:
                continue
        if b is None:
            pytest.skip("no browser available")
        yield b
        b.close()


@pytest.fixture
def open_page(browser, tmp_path):
    contexts = []

    def _open(url):
        ctx = browser.new_context(accept_downloads=True)
        contexts.append(ctx)
        page = ctx.new_page()
        page.errors, page.requests = [], []
        page.on("console", lambda m: page.errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: page.errors.append(str(e)))
        page.on("request", lambda r: page.requests.append(r.url))
        page.goto(url)
        return page

    yield _open
    for c in contexts:
        c.close()


def big_csv(tmp_path, n=600):
    path = tmp_path / "big.csv"
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Name", "Email"])
        for i in range(n):
            w.writerow([f"Person {i:04d} Example", f"p{i}@example.com"])
        w.writerow(["Person 0001 Example", "p1@example.com"])  # one exact duplicate
    return path


def tile(page, i):
    return page.locator("#tiles .tile .n").nth(i)


def download_text(page, button):
    with page.expect_download() as info:
        page.click(button)
    return Path(info.value.path()).read_bytes()


def test_sample_list_end_to_end(open_page):
    page = open_page(SITE)
    page.click("#sample")
    expect(page.locator("#results")).to_be_visible()
    expect(tile(page, 0)).to_have_text("16")   # rows checked
    expect(tile(page, 1)).to_have_text("1")    # exact duplicate (third Arta row)
    expect(tile(page, 3)).to_have_text("1")    # blerim@example
    groups = page.locator("#groups .group")
    assert groups.count() >= 5
    # The two Mark Smiths share a phone but have different emails: flagged with caution
    # and left alone by the bulk merge.
    expect(page.locator(".badge.caution").first).to_be_visible()
    before = page.locator("#export-count").inner_text()
    page.click("#merge-sure")
    after = page.locator("#export-count").inner_text()
    assert "merged" in after and after != before
    assert page.locator(".group.merge").count() >= 2
    data = download_text(page, "#dl-csv").decode("utf-8-sig")
    rows = list(csv.reader(io.StringIO(data)))
    assert rows[0] == ["Full Name", "Email", "Phone", "Company", "City"]
    expected = int(after.split(" will have ")[1].split(" rows")[0])
    assert len(rows) - 1 == expected
    assert not any(r[1] == "n/a" for r in rows[1:]), "placeholders are cleared"
    xlsx = download_text(page, "#dl-xlsx")
    assert xlsx[:2] == b"PK" and len(xlsx) > 2000
    assert page.errors == []


def test_free_edition_limits_downloads_of_big_lists(open_page, tmp_path):
    page = open_page(SITE)
    page.set_input_files("#file", str(big_csv(tmp_path)))
    expect(tile(page, 0)).to_have_text("601")
    expect(tile(page, 1)).to_have_text("1")
    expect(page.locator("#upsell")).to_be_visible()
    expect(page.locator("#dl-csv")).to_be_disabled()
    expect(page.locator("#dl-summary")).to_be_enabled()
    assert "601" in page.locator("#upsell-text").inner_text()


def test_pro_edition_is_one_offline_file_without_limits(open_page, tmp_path):
    page = open_page(PRO)
    expect(page.locator("#pricing")).to_be_hidden()
    page.set_input_files("#file", str(big_csv(tmp_path)))
    expect(tile(page, 0)).to_have_text("601")
    expect(page.locator("#upsell")).to_be_hidden()
    expect(page.locator("#dl-csv")).to_be_enabled()
    rows = list(csv.reader(io.StringIO(download_text(page, "#dl-csv").decode("utf-8-sig"))))
    assert len(rows) == 601  # header + 600 unique
    assert page.errors == [], page.errors
    # Nothing but the file itself was ever requested.
    assert all(u.startswith(("file:", "blob:", "data:")) for u in page.requests), page.requests


def test_excel_file_with_two_sheets(open_page):
    page = open_page(SITE)
    page.set_input_files("#file", str(FIX / "contacts.xlsx"))
    expect(page.locator("#sheet-pick")).to_be_visible()
    expect(tile(page, 0)).to_have_text("3")
    group = page.locator("#groups .group").first
    expect(group).to_contain_text("same email")
    expect(group).to_contain_text("383441234567")  # a long number kept whole
    page.select_option("#sheet", "Suppliers")
    expect(tile(page, 0)).to_have_text("2")
    expect(page.locator("#groups .group").first).to_contain_text("similar name, different email")
    assert page.errors == []


def test_central_european_csv_is_detected(open_page):
    page = open_page(SITE)
    page.set_input_files("#file", str(FIX / "cp1250.csv"))
    expect(page.locator("#notes")).to_contain_text("Windows-1250")
    expect(page.locator("#groups")).to_contain_text("Petrović")


def test_the_page_never_contacts_a_server(open_page):
    page = open_page(SITE)
    page.click("#sample")
    expect(page.locator("#results")).to_be_visible()
    # The page's security policy itself must refuse the connection (a failed
    # request alone would prove nothing: it could fail for other reasons).
    directive = page.evaluate("""async () => {
        const seen = new Promise((res) => document.addEventListener(
            'securitypolicyviolation', (e) => res(e.effectiveDirective), { once: true }));
        try { await fetch('https://example.com/'); } catch (e) { /* expected */ }
        return Promise.race([seen, new Promise((r) => setTimeout(() => r('no violation'), 3000))]);
    }""")
    assert directive == "connect-src"
    assert all(u.startswith(("file:", "blob:", "data:")) for u in page.requests), page.requests
