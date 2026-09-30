/**
 * Landing page chrome: navbar + side panel visibility (kiosk landing iframe).
 * Legacy `displayMode: panel | fullscreen` maps to both on / both off.
 */

function resolveLandingChrome(source) {
  const lp = source?.toObject ? source.toObject() : source || {};
  let showNavbar = lp.showNavbar;
  let showSidePanel = lp.showSidePanel;

  if (showNavbar === undefined || showSidePanel === undefined) {
    const immersive = lp.displayMode === 'fullscreen';
    if (showNavbar === undefined) showNavbar = !immersive;
    if (showSidePanel === undefined) showSidePanel = !immersive;
  }

  showNavbar = Boolean(showNavbar);
  showSidePanel = Boolean(showSidePanel);

  return {
    showNavbar,
    showSidePanel,
    displayMode: (!showNavbar && !showSidePanel) ? 'fullscreen' : 'panel',
    letterboxColor: lp.letterboxColor === 'white' ? 'white' : 'black',
  };
}

function applyLandingChromeFields(doc, body = {}) {
  const { showNavbar, showSidePanel, displayMode, letterboxColor } = body;

  if (showNavbar !== undefined) doc.showNavbar = Boolean(showNavbar);
  if (showSidePanel !== undefined) doc.showSidePanel = Boolean(showSidePanel);

  if (
    displayMode !== undefined
    && showNavbar === undefined
    && showSidePanel === undefined
  ) {
    const immersive = displayMode === 'fullscreen';
    doc.showNavbar = !immersive;
    doc.showSidePanel = !immersive;
  }

  const chrome = resolveLandingChrome(doc);
  doc.showNavbar = chrome.showNavbar;
  doc.showSidePanel = chrome.showSidePanel;
  doc.displayMode = chrome.displayMode;
  if (letterboxColor === 'white' || letterboxColor === 'black') {
    doc.letterboxColor = letterboxColor;
  }
}

function landingChromePayload(source) {
  return resolveLandingChrome(source);
}

module.exports = {
  resolveLandingChrome,
  applyLandingChromeFields,
  landingChromePayload,
};
