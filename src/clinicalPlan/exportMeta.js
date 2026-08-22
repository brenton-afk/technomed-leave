// Kept apart from exportDocx.js on purpose: that module pulls in the docx
// library (~400KB), so anything the UI needs eagerly must not live beside it or
// the dynamic import is defeated and the library lands in the main bundle.
export const DOCX_FILENAME = 'Weekly Clinical Plan CURRENT.docx'
