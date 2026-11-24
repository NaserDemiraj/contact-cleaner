# Firefox Add-ons listing

What to enter on addons.mozilla.org, in the order its form asks.

## Upload

- Distribution: **On this site**
- File: `dist/contact-cleaner-firefox.zip`
- Platform: **Firefox** (desktop) only
- Source code needed? **No.** Our own code is not minified, bundled or generated. The only minified
  file is an unmodified third-party release, named in the notes to reviewers.

## Describe

**Name:** Contact Cleaner: Find Duplicate Contacts

**Summary:**
Find and merge duplicate contacts in spreadsheet and CSV files. Everything runs on your computer; your file is never uploaded. Free up to 500 rows per download; a paid version downloads larger lists.

**Description:**

Find the duplicate contacts a spreadsheet's "remove duplicates" misses.

Open an Excel, CSV or OpenDocument list and Contact Cleaner shows:

- the same person typed differently, with stray spaces or capitals
- the same email or phone number written two ways, such as +383 44 123 456 and 044 123 456
- similar names, such as ACME Corp. and Acme Corporation
- email addresses that don't look valid, blank rows and N/A placeholders

Rows that are identical once tidied are removed. Likely duplicates are grouped for you to decide, and are never merged on their own.

Private by design: the add-on asks for no permissions, collects no data, and its security policy blocks every network connection. Your file stays on your computer, and it works offline.

What is free: checking lists of any size, reviewing and merging duplicates, the summary, and downloading cleaned lists up to 500 rows.

What needs payment: downloading cleaned lists of more than 500 rows needs Contact Cleaner Pro, a separate offline file sold on Payhip for $9 (once, no subscription). The add-on links to it only when your list is over the limit. I make both.

**This add-on requires payment, non-free services or software, or additional hardware:** tick it

**Categories:** Other, or the closest the form offers

**Support website:** https://github.com/NaserDemiraj/contact-cleaner/issues

**License:** All Rights Reserved

**Privacy policy:** Contact Cleaner collects, stores and sends no data. Files you open are read in the
browser's memory, on your computer, and are gone when you close the tab. The add-on makes no network
requests.

## Notes to reviewers

- The toolbar button opens `index.html` in a tab. There are no permissions, content scripts or host access.
- `content_security_policy` sets `connect-src 'none'`.
- To test: press the toolbar button, then "Or try it with a sample list". A file of more than 500 rows
  shows the free limit and the link to the paid file. Payment is not needed to review any feature in the package.
- `vendor/xlsx.full.min.js` is SheetJS Community Edition 0.20.3, unmodified (Apache-2.0):
  - file: https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js (SheetJS's own distribution site)
  - sha256: cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41
  - readable source: https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz

## Images

`dist/listing/`: `icon-128.png` and three screenshots.
