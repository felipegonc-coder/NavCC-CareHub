// Fictional files for the Messages checks: three tiny solid-colour pictures, a one-page PDF and an
// SVG. The JPEG carries made-up camera details and a made-up GPS position, so a check can see that
// Care Hub removes them on upload (Messages spec, section 3, Pictures and files).

/** A file for `setFiles`, made in the test. */
export type TestFile = { name: string; mimeType: string; buffer: Buffer };

const jpegWithLocation =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/4QCoRXhpZgAATU0AKgAAAAgAAgEPAAIAAAAUAAAAJoglAAQAAAABAAAAOgAAAABGaWN0' +
  'aW9uYWwgQ2FtZXJhIENvAAAEAAEAAgAAAAJOAAAAAAIABQAAAAMAAABwAAMAAgAAAAJXAAAAAAQABQAAAAMAAACIAAAAAAAA' +
  'AAwAAAABAAAAIgAAAAEAAAA4AAAAAQAAAEEAAAABAAAAKwAAAAEAAAAVAAAAAf/bAEMACgcHCAcGCggICAsKCgsOGBAODQ0O' +
  'HRUWERgjHyUkIh8iISYrNy8mKTQpISIwQTE0OTs+Pj4lLkRJQzxINz0+O//bAEMBCgsLDg0OHBAQHDsoIig7Ozs7Ozs7Ozs7' +
  'Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O//AABEIABAAGAMBIgACEQEDEQH/xAAfAAABBQEBAQEB' +
  'AQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR' +
  '8CQzYnKCCQoWFxgZGiUmJygpKjQ1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoOEhYaHiImKkpOUlZaX' +
  'mJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj5OXm5+jp6vHy8/T19vf4+fr/xAAfAQADAQEBAQEB' +
  'AQEBAAAAAAAAAQIDBAUGBwgJCgv/xAC1EQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS' +
  '8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SV' +
  'lpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEAAhEDEQA/' +
  'AM2iiivqj5kKKKKAP//Z';

const orangePng =
  'iVBORw0KGgoAAAANSUhEUgAAABgAAAAQCAIAAACDRijCAAAAHElEQVR42mO8U6HBQA3AxEAlMGrQqEGjBo1UgwARdQGc15gw1QAAAABJRU5ErkJggg==';
const greenPng =
  'iVBORw0KGgoAAAANSUhEUgAAABgAAAAQCAIAAACDRijCAAAAHElEQVR42mO0WRXFQA3AxEAlMGrQqEGjBo1UgwD/PQFgWHmNsAAAAABJRU5ErkJggg==';

/** Three pictures; the first one is the JPEG with a location in it. */
export function pictures(label: string): TestFile[] {
  return [
    {
      name: `${label} 1.jpg`,
      mimeType: 'image/jpeg',
      buffer: Buffer.from(jpegWithLocation, 'base64'),
    },
    { name: `${label} 2.png`, mimeType: 'image/png', buffer: Buffer.from(orangePng, 'base64') },
    { name: `${label} 3.png`, mimeType: 'image/png', buffer: Buffer.from(greenPng, 'base64') },
  ];
}

/** A valid one-page PDF with no text. */
export function pdf(name: string): TestFile {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(body, 'latin1') };
}

/** A small SVG picture, which Messages sends as a file card. */
export function svg(name: string): TestFile {
  const text =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="16">' +
    '<rect width="24" height="16" fill="#3a7"/></svg>';
  return { name, mimeType: 'image/svg+xml', buffer: Buffer.from(text, 'utf8') };
}

/**
 * True when a picture still holds a GPS position: its EXIF block (JPEG APP1, or a TIFF header
 * anywhere in the file) lists the GPS tag 0x8825 in its first directory.
 */
export function hasLocation(file: Buffer): boolean {
  const exif = file.indexOf('Exif\0\0', 0, 'latin1');
  const candidates = [
    exif >= 0 ? exif + 6 : -1,
    file.indexOf('II*\0', 0, 'latin1'),
    file.indexOf('MM\0*', 0, 'latin1'),
  ];
  for (const start of candidates.filter((offset) => offset >= 0)) {
    const little = file.toString('latin1', start, start + 2) === 'II';
    const u16 = (at: number) => (little ? file.readUInt16LE(at) : file.readUInt16BE(at));
    const u32 = (at: number) => (little ? file.readUInt32LE(at) : file.readUInt32BE(at));
    if (start + 8 > file.length) continue;
    const directory = start + u32(start + 4);
    if (directory + 2 > file.length) continue;
    const entries = u16(directory);
    for (let index = 0; index < entries; index += 1) {
      const entry = directory + 2 + index * 12;
      if (entry + 2 <= file.length && u16(entry) === 0x8825) return true;
    }
  }
  return false;
}
