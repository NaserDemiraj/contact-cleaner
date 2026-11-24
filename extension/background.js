// The toolbar button opens the tool in a tab. Nothing else runs in the background.
browser.action.onClicked.addListener(() => {
  browser.tabs.create({ url: browser.runtime.getURL("index.html") });
});
