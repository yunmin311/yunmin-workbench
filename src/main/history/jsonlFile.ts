import { open } from 'node:fs/promises';

/**
 * Streaming JSONL tail reader for harness transcripts.
 *
 * Mechanics follow csx `source/jsonl.rs` (`read_from_offset`):
 *   - resume from a persisted byte offset instead of re-reading the file
 *   - a trailing line with no terminating newline is still being written, so it
 *     is left unconsumed and completed on the next pass
 *   - blank lines are skipped
 *   - an offset past EOF reads nothing
 *
 * One deliberate difference: csx treats a malformed line as a hard error and
 * fails the whole file. That would let one bad line drop an entire session, so
 * this reader hands back every line it could decode and lets the parser record
 * per-line problems (Klovi's `onMalformed` contract) instead.
 *
 * Offsets are counted in bytes and lines are split on the raw newline byte, so
 * multi-byte UTF-8 sequences are never split mid-character: only complete lines
 * are decoded.
 */

export interface JsonlLine {
  text: string;
  /** 1-based line number in the file, carried across passes via the line cursor. */
  lineNumber: number;
}

export interface JsonlReadResult {
  lines: JsonlLine[];
  /** Byte offset just past the last complete line consumed. */
  newOffset: number;
  /** Line cursor to persist, so the next pass continues numbering correctly. */
  newLineCursor: number;
  /** Bytes of an incomplete trailing line deliberately left for the next pass. */
  partialTailBytes: number;
}

const NEWLINE = 0x0a;

export async function readJsonlFromOffset(
  path: string,
  offset: number,
  lineCursor: number,
  chunkBytes = 1 << 20,
): Promise<JsonlReadResult> {
  const lines: JsonlLine[] = [];
  let cursor = lineCursor;
  let consumed = 0;
  let leftover: Buffer = Buffer.alloc(0);

  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    if (offset >= stat.size) {
      return { lines, newOffset: offset, newLineCursor: cursor, partialTailBytes: 0 };
    }

    const buffer = Buffer.allocUnsafe(chunkBytes);
    let position = offset;

    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, chunkBytes, position);
      if (bytesRead === 0) break;
      position += bytesRead;

      let chunk = leftover.length > 0 ? Buffer.concat([leftover, buffer.subarray(0, bytesRead)]) : buffer.subarray(0, bytesRead);
      let start = 0;

      for (;;) {
        const idx = chunk.indexOf(NEWLINE, start);
        if (idx === -1) break;
        const raw = chunk.subarray(start, idx);
        start = idx + 1;
        consumed += raw.length + 1;
        cursor += 1;
        const text = raw.toString('utf8').trim();
        if (text.length > 0) lines.push({ text, lineNumber: cursor });
      }

      // Copy the tail. A subarray would still point at `buffer`; the next read
      // overwrites that memory before the line can be completed.
      leftover = Buffer.from(chunk.subarray(start));
      if (leftover.length > chunkBytes) {
        // A single line larger than the chunk: keep growing, this loop terminates
        // when the line finally ends or the file does.
        continue;
      }
    }
  } finally {
    await handle.close();
  }

  return {
    lines,
    newOffset: offset + consumed,
    newLineCursor: cursor,
    partialTailBytes: leftover.length,
  };
}
