/**
 * A minimal RFC 5322 / MIME parser, enough for job-related mail.
 *
 * Why not a library: `mailparser` is the obvious choice and it is good, but it
 * drags a large transitive tree into a project that has kept its dependency
 * list to five runtime packages on purpose. What we need is narrow — headers,
 * the text and HTML parts, and the two transfer encodings that actually appear
 * in this mail — and that is ~150 lines we can test and reason about.
 *
 * What it handles: folded headers, MIME encoded-words in Subject and From,
 * nested multipart, quoted-printable, base64, and charset conversion.
 * What it does not: signatures, encryption, attachments. None are needed to
 * read a job alert.
 */

export type ParsedMail = {
  messageId: string | null;
  from: { name: string | null; address: string | null };
  subject: string | null;
  date: string | null;
  /** Best available body: the HTML part if present, else text/plain. */
  html: string | null;
  text: string | null;
  headers: Record<string, string>;
};

/* ------------------------------------------------------------- headers -- */

/**
 * Split a message into headers and body, unfolding continuation lines.
 * Folding (a header continued on an indented line) is the classic reason a
 * naive line-by-line parser loses half a Subject.
 */
function splitMessage(raw: string): { headers: Record<string, string>; body: string } {
  const normalized = raw.replace(/\r\n/g, "\n");
  const separator = normalized.indexOf("\n\n");
  const headerBlock = separator === -1 ? normalized : normalized.slice(0, separator);
  const body = separator === -1 ? "" : normalized.slice(separator + 2);

  const headers: Record<string, string> = {};
  let current: string | null = null;

  for (const line of headerBlock.split("\n")) {
    if (/^[ \t]/.test(line) && current) {
      headers[current] += ` ${line.trim()}`;
      continue;
    }
    const match = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(line);
    if (match?.[1]) {
      current = match[1].toLowerCase();
      headers[current] = match[2] ?? "";
    }
  }

  return { headers, body };
}

/* ------------------------------------------------------------ encoding -- */

function decodeQuotedPrintable(input: string): Buffer {
  const withoutSoftBreaks = input.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < withoutSoftBreaks.length; i++) {
    const ch = withoutSoftBreaks[i];
    if (ch === "=" && i + 2 < withoutSoftBreaks.length) {
      const hex = withoutSoftBreaks.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(Number.parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    bytes.push(ch!.charCodeAt(0));
  }
  return Buffer.from(bytes);
}

function toText(buffer: Buffer, charset: string | undefined): string {
  const cs = (charset ?? "utf-8").toLowerCase().replace(/["']/g, "");
  try {
    // Node ships iso-8859-1 and windows-1252 among others.
    return new TextDecoder(cs).decode(buffer);
  } catch {
    return buffer.toString("utf8");
  }
}

function decodeBody(body: string, encoding: string | undefined, charset: string | undefined): string {
  const enc = (encoding ?? "7bit").toLowerCase().trim();
  if (enc === "base64") {
    return toText(Buffer.from(body.replace(/\s+/g, ""), "base64"), charset);
  }
  if (enc === "quoted-printable") {
    return toText(decodeQuotedPrintable(body), charset);
  }
  return toText(Buffer.from(body, "binary"), charset);
}

/**
 * Decode MIME encoded-words: =?UTF-8?B?...?= and =?UTF-8?Q?...?=
 * Subjects from LinkedIn are routinely encoded, so skipping this loses the
 * single most useful classification signal.
 */
export function decodeEncodedWords(input: string | null | undefined): string | null {
  if (!input) return null;
  return input.replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (_full, charset: string, kind: string, payload: string) => {
      try {
        if (kind.toUpperCase() === "B") {
          return toText(Buffer.from(payload, "base64"), charset);
        }
        // In Q-encoding, underscore means space.
        return toText(decodeQuotedPrintable(payload.replace(/_/g, " ")), charset);
      } catch {
        return payload;
      }
    },
  ).replace(/\?=\s+=\?/g, ""); // adjacent encoded words are concatenated
}

/* ----------------------------------------------------------- multipart -- */

type Part = { headers: Record<string, string>; body: string };

function paramOf(headerValue: string | undefined, name: string): string | undefined {
  if (!headerValue) return undefined;
  const match = new RegExp(`${name}\\s*=\\s*"?([^";]+)"?`, "i").exec(headerValue);
  return match?.[1]?.trim();
}

function collectParts(headers: Record<string, string>, body: string, depth = 0): Part[] {
  const contentType = headers["content-type"] ?? "";
  const boundary = paramOf(contentType, "boundary");

  // Guard against a malformed message nesting forever.
  if (!boundary || depth > 8) return [{ headers, body }];

  const parts: Part[] = [];
  const segments = body.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}(?:--)?\\s*\\n?`));

  for (const segment of segments) {
    if (!segment.trim()) continue;
    const { headers: partHeaders, body: partBody } = splitMessage(segment);
    if ((partHeaders["content-type"] ?? "").toLowerCase().startsWith("multipart/")) {
      parts.push(...collectParts(partHeaders, partBody, depth + 1));
    } else {
      parts.push({ headers: partHeaders, body: partBody });
    }
  }

  return parts.length > 0 ? parts : [{ headers, body }];
}

/* -------------------------------------------------------------- parse --- */

export function parseEml(raw: string): ParsedMail {
  const { headers, body } = splitMessage(raw);
  const parts = collectParts(headers, body);

  let html: string | null = null;
  let text: string | null = null;

  for (const part of parts) {
    const type = (part.headers["content-type"] ?? "text/plain").toLowerCase();
    const decoded = decodeBody(
      part.body,
      part.headers["content-transfer-encoding"],
      paramOf(part.headers["content-type"], "charset"),
    );
    if (type.includes("text/html") && !html) html = decoded;
    else if (type.includes("text/plain") && !text) text = decoded;
  }

  // A single-part message has its type on the top-level headers.
  if (!html && !text) {
    const decoded = decodeBody(
      body,
      headers["content-transfer-encoding"],
      paramOf(headers["content-type"], "charset"),
    );
    if ((headers["content-type"] ?? "").toLowerCase().includes("html")) html = decoded;
    else text = decoded;
  }

  const fromRaw = decodeEncodedWords(headers["from"]) ?? "";
  const addressMatch = /<([^>]+)>/.exec(fromRaw);
  const address = addressMatch?.[1] ?? (fromRaw.includes("@") ? fromRaw.trim() : null);
  const name = addressMatch
    ? fromRaw.slice(0, addressMatch.index).trim().replace(/^"|"$/g, "") || null
    : null;

  const dateHeader = headers["date"];
  const parsedDate = dateHeader ? Date.parse(dateHeader) : Number.NaN;

  return {
    messageId: headers["message-id"]?.replace(/^<|>$/g, "").trim() ?? null,
    from: { name, address: address?.toLowerCase() ?? null },
    subject: decodeEncodedWords(headers["subject"]),
    date: Number.isNaN(parsedDate) ? null : new Date(parsedDate).toISOString(),
    html,
    text,
    headers,
  };
}
