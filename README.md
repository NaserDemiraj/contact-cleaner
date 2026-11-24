# Contact Cleaner

Find the duplicate contacts Excel misses, privately, in the browser.

Excel's *Remove Duplicates* only removes rows that are exactly identical. Contact
Cleaner also finds the same person typed differently, the same email or phone
written two ways (`+383 44 123 456` and `044 123 456`), and similar names
(`ACME Corp.` and `Acme Corporation`). Exact duplicates are removed; likely ones
are grouped for a person to decide, and nothing is merged on its own.

The file never leaves the computer: the page's Content Security Policy blocks
every network connection (`connect-src 'none'`), and a browser test checks it.

## Editions

| | Free (the website) | Pro ($9, one file) |
|---|---|---|
| Check any list, see every finding | yes | yes |
| Review and merge duplicates | yes | yes |
| Download the cleaned list | up to 500 rows | any size |
| Works offline | after loading | always: one HTML file |

`config.js` sets the edition, the free row limit and the "Get Pro" link.

The free edition is also a Firefox add-on (`extension/`): the same page inside the
browser, with no permissions. Its store text is in `extension/LISTING.md`.

## Build and test

```sh
node build.mjs                      # dist/site/, dist/firefox/ and dist/contact-cleaner-pro.html
node --test test/engine.test.mjs    # engine, incl. parity with GENESIS listclean.py
python -m pytest test/test_page.py  # both editions in Chrome/Edge (Playwright)
python -m pytest test/test_extension.py  # the add-on in real Firefox (Selenium 4)
```

Package the add-on (Mozilla's own tool, lint first):

```sh
npx web-ext@10.8.0 lint -s dist/firefox
npx web-ext@10.8.0 build -s dist/firefox -a dist -n contact-cleaner-firefox.zip --overwrite-dest
```

`dist/` is ignored: `dist/contact-cleaner-pro.html` is the paid product and is
uploaded to the store, never committed.

## Release

1. Put the Payhip product URL in `config.js` (`buyUrl`).
2. `node build.mjs`, run the tests, upload `dist/contact-cleaner-pro.html` to the
   Payhip product.
3. Publish the site files (`index.html`, `style.css`, `engine.js`, `config.js`,
   `app.js`, `vendor/`) to static hosting.

## Credits

Excel files are read and written with [SheetJS Community Edition](https://sheetjs.com)
0.20.3, Apache License 2.0 (`vendor/SHEETJS-LICENSE`). The matching logic is a
port of `listclean.py` from GENESIS, including Python's `difflib.SequenceMatcher`.
