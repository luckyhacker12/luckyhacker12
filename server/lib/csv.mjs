/**
 * Minimal RFC4180 CSV parser/serialiser.
 *
 * Implemented locally (no dependency) so that:
 *  - quoted fields containing commas, quotes and newlines survive a round-trip;
 *  - import never executes anything from the uploaded file;
 *  - the behaviour is covered by unit tests instead of trusted blindly.
 */

/** Parses CSV text into an array of string arrays. Handles BOM + CRLF. */
export function parseCsv(text) {
  if (typeof text !== 'string') return []
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }

    if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (ch === '\r') {
      // swallow; \n terminates the row
    } else {
      field += ch
    }
  }

  // Flush trailing field/row if the file did not end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''))
}

/** Parses CSV text with a header row into objects keyed by lower-cased header. */
export function parseCsvObjects(text) {
  const rows = parseCsv(text)
  if (rows.length === 0) return { headers: [], records: [] }

  // Normalise headers to a single snake_case-ish form so that "Phone Number",
  // "Phone-Number" and "phone_number" all resolve to the same key.
  const headers = rows[0].map((h) =>
    String(h)
      .replace(/^\uFEFF/, '')
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_'),
  )
  const records = []

  for (let i = 1; i < rows.length; i += 1) {
    const cells = rows[i]
    const record = {}
    headers.forEach((header, idx) => {
      record[header] = cells[idx] !== undefined ? String(cells[idx]).trim() : ''
    })
    // Keep the source line number (1-based, including the header) for error messages.
    record.__line = i + 1
    records.push(record)
  }

  return { headers, records }
}

/** Escapes a single CSV cell. */
export function escapeCell(value) {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

/**
 * Serialises rows to CSV.
 * @param {string[]} headers column keys, also used as the header row
 * @param {Array<Record<string, unknown>>} rows
 */
export function toCsv(headers, rows) {
  const lines = [headers.map(escapeCell).join(',')]
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCell(row[h])).join(','))
  }
  // Trailing newline keeps spreadsheet tools happy.
  return `${lines.join('\r\n')}\r\n`
}
