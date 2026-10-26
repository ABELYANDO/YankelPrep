// ── Minimal CSV writer shared by the evaluation scripts ─────────
// Quotes every field (so commas, quotes and line breaks inside student
// answers survive), and starts with a UTF-8 byte-order mark so Excel
// opens accented names and symbols correctly.

const quote = (value) => {
  if (value === null || value === undefined) return '""'
  return `"${String(value).replace(/"/g, '""')}"`
}

// rows: array of plain objects; columns: optional explicit column order.
export const toCsv = (rows, columns = Object.keys(rows[0] || {})) => {
  const lines = [columns.map(quote).join(',')]
  for (const row of rows) lines.push(columns.map(c => quote(row[c])).join(','))
  return '﻿' + lines.join('\r\n') + '\r\n'
}
