"""The Firefox add-on, in a real Firefox (needs `node build.mjs` first).

Run: python -m pytest test/test_extension.py   (Selenium 4; it finds Firefox itself)
"""
import csv
import json
import os
import re
import time
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "test" / "fixtures"
ADDON = ROOT / "dist" / "firefox"
ADDON_ID = "contact-cleaner@naserdemiraj.github.io"
UUID = "11111111-2222-4333-8444-555555555555"
PAGE = f"moz-extension://{UUID}/index.html"


# ---------------------------------------------------------------------------
# What is in the package
# ---------------------------------------------------------------------------
def test_the_manifest_asks_for_nothing_and_declares_no_data():
    m = json.loads((ADDON / "manifest.json").read_text(encoding="utf-8"))
    for key in ("permissions", "host_permissions", "optional_permissions", "content_scripts"):
        assert key not in m
    gecko = m["browser_specific_settings"]["gecko"]
    assert gecko["id"] == ADDON_ID
    assert gecko["data_collection_permissions"] == {"required": ["none"]}
    csp = m["content_security_policy"]["extension_pages"]
    assert "connect-src 'none'" in csp and "unsafe" not in csp and "http" not in csp
    assert len(m["name"]) <= 45 and len(m["description"]) <= 132


def test_the_package_is_exactly_these_files_and_never_the_paid_one():
    files = sorted(p.relative_to(ADDON).as_posix() for p in ADDON.rglob("*") if p.is_file())
    assert files == ["app.js", "background.js", "config.js", "engine.js", "icon.svg", "index.html",
                     "manifest.json", "style.css", "vendor/SHEETJS-LICENSE",
                     "vendor/xlsx.full.min.js"]
    assert 'edition: "free"' in (ADDON / "config.js").read_text(encoding="utf-8")


def test_the_page_loads_only_its_own_files():
    html = (ADDON / "index.html").read_text(encoding="utf-8")
    for src in re.findall(r'(?:src|href)="([^"]+)"', html):
        if src.startswith("#"):
            continue
        if src.startswith("https://"):
            assert src in ("https://payhip.com/b/rse9L", "https://sheetjs.com")   # plain links
        else:
            assert (ADDON / src).is_file(), src
    assert not re.search(r'<(script|link|img)[^>]+https?:', html)
    assert "http-equiv" not in html and 'id="pricing"' not in html and "guides/" not in html


# ---------------------------------------------------------------------------
# In Firefox
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def zipped(tmp_path_factory):
    path = tmp_path_factory.mktemp("addon") / "addon.zip"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for p in ADDON.rglob("*"):
            if p.is_file():
                z.write(p, p.relative_to(ADDON).as_posix())
    return path


@pytest.fixture
def firefox(zipped, tmp_path):
    selenium = pytest.importorskip("selenium")
    from selenium import webdriver

    options = webdriver.FirefoxOptions()
    options.add_argument("-headless")
    options.set_preference("extensions.webextensions.uuids", json.dumps({ADDON_ID: UUID}))
    options.set_preference("browser.download.folderList", 2)
    options.set_preference("browser.download.dir", str(tmp_path))
    options.set_preference("browser.download.alwaysOpenPanel", False)
    if os.environ.get("CC_FIREFOX"):
        options.binary_location = os.environ["CC_FIREFOX"]
    # Lets the test press the toolbar button, in this throwaway profile only.
    service = webdriver.FirefoxService(service_args=["--allow-system-access"])
    try:
        driver = webdriver.Firefox(options=options, service=service)
    except selenium.common.exceptions.WebDriverException as exc:
        if os.environ.get("CC_FIREFOX"):
            raise
        pytest.skip(f"no Firefox available: {exc.msg}")
    driver.install_addon(str(zipped), temporary=True)
    driver.downloads = tmp_path
    yield driver
    driver.quit()


def wait(check, seconds=15):
    end = time.time() + seconds
    while True:
        value = check()
        if value or time.time() > end:
            assert value
            return value
        time.sleep(0.1)


def text(driver, css):
    return driver.execute_script("return document.querySelector(arguments[0]).textContent", css)


def tiles(driver):
    return driver.execute_script(
        "return [...document.querySelectorAll('#tiles .n')].map((e) => e.textContent)")


def choose(driver, path):
    from selenium.webdriver.common.by import By

    driver.execute_script("document.getElementById('file').hidden = false")
    driver.find_element(By.ID, "file").send_keys(str(path))
    wait(lambda: tiles(driver))


def click(driver, css):
    driver.execute_script("document.querySelector(arguments[0]).click()", css)


def downloaded(driver, name):
    path = driver.downloads / name
    wait(lambda: path.exists() and path.stat().st_size and not path.with_name(name + ".part").exists())
    return path


def test_the_toolbar_button_opens_the_tool(firefox):
    with firefox.context(firefox.CONTEXT_CHROME):
        firefox.execute_script(
            "const { ExtensionParent } = ChromeUtils.importESModule("
            "  'resource://gre/modules/ExtensionParent.sys.mjs');"
            "const ext = ExtensionParent.GlobalManager.getExtension(arguments[0]);"
            "ExtensionParent.apiManager.global.browserActionFor(ext).triggerAction(window);", ADDON_ID)
    wait(lambda: len(firefox.window_handles) == 2)
    firefox.switch_to.window(firefox.window_handles[-1])
    wait(lambda: firefox.current_url == PAGE)
    assert "Contact" in text(firefox, ".brand")


def test_a_csv_is_checked_merged_and_downloaded(firefox):
    firefox.get(PAGE)
    click(firefox, "#sample")
    wait(lambda: tiles(firefox))
    assert tiles(firefox)[:2] == ["16", "1"]
    click(firefox, "#merge-sure")
    assert "merged" in text(firefox, "#export-count")
    click(firefox, "#dl-csv")
    out = downloaded(firefox, "sample-contacts-cleaned.csv")
    rows = list(csv.reader(out.open(encoding="utf-8-sig", newline="")))
    assert rows[0] == ["Full Name", "Email", "Phone", "Company", "City"]
    assert f"will have {len(rows) - 1} rows" in text(firefox, "#export-count")
    click(firefox, "#dl-xlsx")
    assert downloaded(firefox, "sample-contacts-cleaned.xlsx").read_bytes()[:2] == b"PK"


def test_an_excel_file_is_read(firefox):
    firefox.get(PAGE)
    choose(firefox, FIX / "contacts.xlsx")
    assert tiles(firefox)[0] == "3"
    assert "383441234567" in text(firefox, "#groups")


def test_a_big_list_is_checked_free_and_the_limit_is_stated(firefox, tmp_path):
    big = tmp_path / "big.csv"
    lines = ["Name,Email"] + [f"Person {i:04d} Example,p{i}@example.com" for i in range(600)]
    big.write_text("\n".join(lines + ["Person 0001 Example,p1@example.com"]), encoding="utf-8")
    firefox.get(PAGE)
    assert "up to 500 rows" in text(firefox, ".privacy-line")          # before choosing a file
    choose(firefox, big)
    assert tiles(firefox)[:2] == ["601", "1"]
    js = "return [document.getElementById('dl-csv').disabled, document.getElementById('upsell').hidden," \
         "document.getElementById('dl-summary').disabled, document.getElementById('buy').href]"
    assert firefox.execute_script(js) == [True, False, False, "https://payhip.com/b/rse9L"]


def test_the_browser_itself_refuses_any_connection(firefox):
    firefox.get(PAGE)
    directive = firefox.execute_async_script("""
        const done = arguments[0];
        document.addEventListener('securitypolicyviolation', (e) => done(e.effectiveDirective), { once: true });
        fetch('https://example.com/').catch(() => {});
        setTimeout(() => done('no violation'), 3000);""")
    assert directive == "connect-src"
