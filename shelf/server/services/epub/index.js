const AdmZip = require('adm-zip');
const { parseDocument } = require('htmlparser2');
const { DomUtils } = require('htmlparser2');
const path = require('path');

/**
 * Parse an EPUB file and return extracted text + metadata.
 * @param {string} epubPath  Absolute path to the .epub file
 * @returns {{ title, author, text, coverData, coverExt }}
 */
function parseEpub(epubPath) {
  const zip = new AdmZip(epubPath);

  // 1. Find OPF path from META-INF/container.xml
  const containerXml = zip.readAsText('META-INF/container.xml');
  const opfPath = extractOpfPath(containerXml);
  if (!opfPath) throw new Error('Could not locate OPF file in EPUB');

  // 2. Parse OPF for metadata, manifest, and spine
  const opfXml = zip.readAsText(opfPath);
  const opfDir = path.dirname(opfPath);
  const { title, author, spineItems, coverItemId } = parseOpf(opfXml);

  // 3. Build manifest map: id → href
  const manifest = buildManifest(opfXml, opfDir);

  // 4. Extract cover image bytes (if any)
  let coverData = null;
  let coverExt = 'jpg';
  const coverId = coverItemId || findCoverId(manifest);
  if (coverId && manifest[coverId]) {
    const coverEntry = zip.getEntry(manifest[coverId].href);
    if (coverEntry) {
      coverData = coverEntry.getData();
      coverExt = path.extname(manifest[coverId].href).slice(1).toLowerCase() || 'jpg';
    }
  }

  // 5. Extract and concatenate chapter text in spine order
  const chunks = [];
  for (const itemId of spineItems) {
    const item = manifest[itemId];
    if (!item) continue;
    const entry = zip.getEntry(item.href);
    if (!entry) continue;
    const html = entry.getData().toString('utf8');
    const text = extractTextFromHtml(html);
    if (text.trim()) chunks.push(text.trim());
  }

  const text = chunks.join('\n\n');
  return { title, author, text, coverData, coverExt };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractOpfPath(containerXml) {
  const doc = parseDocument(containerXml, { xmlMode: true });
  const rootfile = DomUtils.findOne(
    el => el.name === 'rootfile',
    doc.children,
    true
  );
  return rootfile ? rootfile.attribs['full-path'] : null;
}

function parseOpf(opfXml) {
  const doc = parseDocument(opfXml, { xmlMode: true });

  const titleEl = DomUtils.findOne(el => el.name === 'dc:title', doc.children, true);
  const authorEl = DomUtils.findOne(el => el.name === 'dc:creator', doc.children, true);
  const title = titleEl ? DomUtils.getText(titleEl).trim() : 'Unknown Title';
  const author = authorEl ? DomUtils.getText(authorEl).trim() : null;

  // Spine order
  const spineEl = DomUtils.findOne(el => el.name === 'spine', doc.children, true);
  const spineItems = spineEl
    ? DomUtils.findAll(el => el.name === 'itemref', [spineEl])
        .map(el => el.attribs.idref)
        .filter(Boolean)
    : [];

  // Cover item id from <meta name="cover" content="...">
  const coverMeta = DomUtils.findOne(
    el => el.name === 'meta' && el.attribs.name === 'cover',
    doc.children,
    true
  );
  const coverItemId = coverMeta ? coverMeta.attribs.content : null;

  return { title, author, spineItems, coverItemId };
}

function buildManifest(opfXml, opfDir) {
  const doc = parseDocument(opfXml, { xmlMode: true });
  const manifestEl = DomUtils.findOne(el => el.name === 'manifest', doc.children, true);
  if (!manifestEl) return {};

  const items = DomUtils.findAll(el => el.name === 'item', [manifestEl]);
  const manifest = {};
  for (const item of items) {
    const id = item.attribs.id;
    const href = opfDir ? `${opfDir}/${item.attribs.href}` : item.attribs.href;
    const mediaType = item.attribs['media-type'] || '';
    const properties = item.attribs.properties || '';
    manifest[id] = { href: href.replace(/\\/g, '/'), mediaType, properties };
  }
  return manifest;
}

function findCoverId(manifest) {
  for (const [id, item] of Object.entries(manifest)) {
    if (
      item.properties.includes('cover-image') ||
      id.toLowerCase().includes('cover') ||
      (item.mediaType.startsWith('image/') && id.toLowerCase().includes('cover'))
    ) {
      return id;
    }
  }
  return null;
}

const BLOCK_ELEMENTS = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li', 'blockquote', 'section', 'article', 'header',
  'footer', 'main', 'aside', 'br',
]);

function extractTextFromHtml(html) {
  const doc = parseDocument(html);
  const parts = [];
  walkNode(doc, parts);
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
}

function walkNode(node, parts) {
  if (node.type === 'text') {
    const text = node.data.replace(/\s+/g, ' ');
    if (text.trim()) parts.push(text);
    return;
  }
  if (node.type !== 'tag') {
    if (node.children) node.children.forEach(c => walkNode(c, parts));
    return;
  }

  const tag = node.name.toLowerCase();
  if (['script', 'style', 'head'].includes(tag)) return;

  if (tag === 'br') {
    parts.push('\n');
    return;
  }

  if (BLOCK_ELEMENTS.has(tag)) parts.push('\n');
  if (node.children) node.children.forEach(c => walkNode(c, parts));
  if (BLOCK_ELEMENTS.has(tag)) parts.push('\n');
}

module.exports = { parseEpub };
