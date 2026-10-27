import {
  pieceList,
  PictureError,
  windowedReader,
  type CleanerResult,
  type PictureFile,
  type WindowedReader,
} from './bytes';

// HEIC, HEIF and AVIF files are ISO boxes: size, type, contents. The 'meta' box lists the items
// (pictures, Exif, XMP), where their bytes are ('iloc') and the pictures' properties. Exif and XMP
// items hold the details: they're blanked where they are, so every offset in the file stays right.
// Rotation and mirroring are picture properties ('irot', 'imir'), so no orientation is lost.

interface Box {
  type: string;
  start: number;
  /** Where the contents start. */
  body: number;
  end: number;
}

const MAX_META = 16 * 1024 * 1024;
const XMP_PACKET =
  '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"/><?xpacket end="w"?>';

function boxAt(bytes: Buffer, at: number, limit: number, offset = 0): Box {
  let size = bytes.readUInt32BE(at);
  let body = at + 8;
  if (size === 1) {
    size = Number(bytes.readBigUInt64BE(at + 8));
    body = at + 16;
  } else if (size === 0) {
    size = limit - at;
  }
  if (size < body - at || at + size > limit) throw new PictureError();
  const type = bytes.toString('latin1', at + 4, at + 8);
  return { type, start: offset + at, body: offset + body, end: offset + at + size };
}

function boxesIn(bytes: Buffer, start: number, end: number): Box[] {
  const boxes: Box[] = [];
  for (let at = start; at + 8 <= end; at = boxes[boxes.length - 1]?.end ?? end) {
    boxes.push(boxAt(bytes, at, end));
  }
  return boxes;
}

async function topLevelBoxes(reader: WindowedReader): Promise<Box[]> {
  const boxes: Box[] = [];
  for (let at = 0; at + 8 <= reader.size;) {
    const head = await reader.bytes(at, Math.min(16, reader.size - at));
    const box = boxAt(head, 0, reader.size - at, at);
    boxes.push(box);
    at = box.end;
  }
  return boxes;
}

/** Reads big-endian numbers of 0 to 8 bytes from `bytes`, moving along. */
function cursor(bytes: Buffer, start: number) {
  let at = start;
  const take = (length: number): number => {
    const value =
      length === 8 ? Number(bytes.readBigUInt64BE(at)) : length && bytes.readUIntBE(at, length);
    at += length;
    return value;
  };
  return { take, skip: (length: number) => void (at += length), at: () => at };
}

interface Item {
  type: string;
  contentType: string;
}

function itemInfos(meta: Buffer, iinf: Box): Map<number, Item> {
  const items = new Map<number, Item>();
  const version = meta.readUInt8(iinf.body);
  for (const infe of boxesIn(meta, iinf.body + 4 + (version === 0 ? 2 : 4), iinf.end)) {
    const infeVersion = meta.readUInt8(infe.body);
    if (infe.type !== 'infe' || infeVersion < 2) continue; // older versions have no item types
    const read = cursor(meta, infe.body + 4);
    const id = read.take(infeVersion === 2 ? 2 : 4);
    read.skip(2);
    const type = meta.toString('latin1', read.at(), read.at() + 4);
    const nameEnd = meta.indexOf(0, read.at() + 4);
    let contentType = '';
    if (type === 'mime' && nameEnd !== -1 && nameEnd < infe.end) {
      const typeEnd = meta.indexOf(0, nameEnd + 1);
      contentType = meta.toString('latin1', nameEnd + 1, typeEnd === -1 ? infe.end : typeEnd);
    }
    items.set(id, { type, contentType: contentType.toLowerCase() });
  }
  return items;
}

interface Location {
  /** 0: offsets in the file; 1: offsets in the 'idat' box. */
  method: number;
  extents: { offset: number; length: number }[];
}

function itemLocations(meta: Buffer, iloc: Box): Map<number, Location> {
  const locations = new Map<number, Location>();
  const version = meta.readUInt8(iloc.body);
  const read = cursor(meta, iloc.body + 4);
  const sizes = read.take(1);
  const more = read.take(1);
  const idSize = version < 2 ? 2 : 4;
  const count = read.take(idSize);
  for (let index = 0; index < count; index += 1) {
    const id = read.take(idSize);
    const method = version >= 1 ? read.take(2) & 0x0f : 0;
    read.skip(2); // data reference
    const base = read.take(more >> 4);
    const extents: Location['extents'] = [];
    for (let left = read.take(2); left > 0; left -= 1) {
      if (version >= 1) read.take(more & 0x0f); // extent index
      const offset = base + read.take(sizes >> 4);
      extents.push({ offset, length: read.take(sizes & 0x0f) });
    }
    locations.set(id, { method, extents });
  }
  return locations;
}

/** The primary picture's property boxes, in the order 'ipma' lists them. */
function primaryProperties(meta: Buffer, children: Box[]): Box[] {
  const pitm = children.find((box) => box.type === 'pitm');
  const iprp = children.find((box) => box.type === 'iprp');
  if (!pitm || !iprp) return [];
  const primary = cursor(meta, pitm.body + 4).take(meta.readUInt8(pitm.body) === 0 ? 2 : 4);
  const parts = boxesIn(meta, iprp.body, iprp.end);
  const ipco = parts.find((box) => box.type === 'ipco');
  const ipma = parts.find((box) => box.type === 'ipma');
  if (!ipco || !ipma) return [];
  const properties = boxesIn(meta, ipco.body, ipco.end);
  const version = meta.readUInt8(ipma.body);
  const wide = (meta.readUInt8(ipma.body + 3) & 1) === 1;
  const read = cursor(meta, ipma.body + 4);
  for (let left = read.take(4); left > 0; left -= 1) {
    const id = read.take(version < 1 ? 2 : 4);
    const indexes: number[] = [];
    for (let count = read.take(1); count > 0; count -= 1) {
      indexes.push(wide ? read.take(2) & 0x7fff : read.take(1) & 0x7f);
    }
    if (id === primary) {
      return indexes.flatMap((index) =>
        properties[index - 1] ? [properties[index - 1] as Box] : [],
      );
    }
  }
  return [];
}

/** What blanked Exif data says: an empty TIFF folder, then zeros. */
function blankExif(length: number): Buffer {
  const bytes = Buffer.alloc(length);
  if (length >= 18) {
    bytes.write('MM', 4, 'latin1'); // the first 4 bytes: the TIFF header is right after them
    bytes.writeUInt16BE(42, 6);
    bytes.writeUInt32BE(8, 8);
  }
  return bytes;
}

function blankXmp(length: number): Buffer {
  const bytes = Buffer.alloc(length, ' ');
  if (length >= XMP_PACKET.length) bytes.write(XMP_PACKET, 0, 'latin1');
  return bytes;
}

/** Blank bytes for every Exif and XMP item, by where they go in the file. */
function detailPatches(meta: Buffer, children: Box[], metaStart: number): Map<number, Buffer> {
  const patches = new Map<number, Buffer>();
  const iinf = children.find((box) => box.type === 'iinf');
  const iloc = children.find((box) => box.type === 'iloc');
  const idat = children.find((box) => box.type === 'idat');
  if (!iinf || !iloc) return patches;
  const locations = itemLocations(meta, iloc);
  for (const [id, item] of itemInfos(meta, iinf)) {
    const exif = item.type === 'Exif';
    const xmp = item.type === 'mime' && /xmp|rdf\+xml/.test(item.contentType);
    const location = locations.get(id);
    if ((!exif && !xmp) || !location) continue;
    if (location.method > 1 || (location.method === 1 && !idat)) throw new PictureError();
    const base = location.method === 1 && idat ? metaStart + idat.body : 0;
    const total = location.extents.reduce((sum, extent) => sum + extent.length, 0);
    const blank = exif ? blankExif(total) : blankXmp(total);
    let used = 0;
    for (const { offset, length } of location.extents) {
      if (length === 0) throw new PictureError(); // "to the end of the file"
      patches.set(base + offset, blank.subarray(used, used + length));
      used += length;
    }
  }
  return patches;
}

/** The primary picture's size after cropping ('clap') and rotation ('irot'), in their order. */
function shownSize(meta: Buffer, children: Box[]): [number, number] {
  let size: [number, number] = [0, 0];
  for (const property of primaryProperties(meta, children)) {
    const at = property.body;
    if (property.type === 'ispe') size = [meta.readUInt32BE(at + 4), meta.readUInt32BE(at + 8)];
    if (property.type === 'clap') {
      const ratio = (offset: number) =>
        Math.floor(meta.readUInt32BE(at + offset) / (meta.readUInt32BE(at + offset + 4) || 1));
      size = [ratio(0), ratio(8)];
    }
    if (property.type === 'irot' && (meta.readUInt8(at) & 1) === 1) size = [size[1], size[0]];
  }
  return size;
}

/** Blanks the Exif and XMP items in place, and reads the primary picture's shown size. */
export async function cleanHeif(file: PictureFile): Promise<CleanerResult> {
  const reader = windowedReader(file);
  const metaBox = (await topLevelBoxes(reader)).find((box) => box.type === 'meta');
  if (!metaBox) return { width: 0, height: 0, pieces: null };
  if (metaBox.end - metaBox.start > MAX_META) throw new PictureError();
  const meta = Buffer.from(await reader.bytes(metaBox.start, metaBox.end - metaBox.start));
  const children = boxesIn(meta, metaBox.body - metaBox.start + 4, meta.length);
  const patches = detailPatches(meta, children, metaBox.start);
  const out = pieceList(file.size);
  let at = 0;
  for (const [start, bytes] of [...patches].sort(([a], [b]) => a - b)) {
    if (start < at || start + bytes.length > file.size) throw new PictureError();
    if ((await reader.bytes(start, bytes.length)).equals(bytes)) continue; // already blank
    out.keep(at, start);
    out.add(bytes);
    at = start + bytes.length;
  }
  out.keep(at, file.size);
  const [width, height] = shownSize(meta, children);
  return { width, height, pieces: out.done() };
}
