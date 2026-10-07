/**
 * Disables the browser's right-click menu on the public site (no "Save image as...", "Copy image address",
 * "View page source" shortcut) and stops pictures being dragged out of the page.
 *
 * Text fields keep their menu on purpose: students paste their phone number into the enquiry form, and
 * blocking that would cost real enquiries. The admin panel does not load this file.
 *
 * Be realistic about what this achieves: it stops casual copying. It cannot stop someone who is determined
 * (browser menus, developer tools and screenshots are outside any page's control).
 */
const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

// Capture phase, so nothing further down the page can re-enable the menu.
window.addEventListener(
  'contextmenu',
  (e) => {
    if (e.target instanceof Element && e.target.closest(EDITABLE)) return;
    e.preventDefault();
  },
  true,
);

window.addEventListener(
  'dragstart',
  (e) => {
    if (e.target instanceof Element && e.target.closest('img, picture, svg')) e.preventDefault();
  },
  true,
);
