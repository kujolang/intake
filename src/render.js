export function printTable(rows, columns) {
  if (!rows.length) {
    console.log("No records.");
    return;
  }
  const widths = columns.map((column) =>
    Math.max(column.length, ...rows.map((row) => String(row[column] ?? "").length))
  );
  console.log(columns.map((column, i) => column.padEnd(widths[i])).join("  "));
  console.log(columns.map((column, i) => "-".repeat(widths[i])).join("  "));
  for (const row of rows) {
    console.log(columns.map((column, i) => String(row[column] ?? "").padEnd(widths[i])).join("  "));
  }
}

export function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}
