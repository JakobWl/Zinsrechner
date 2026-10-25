export interface HistoryGroup {
  name: string;
  banks: string[];
}

export interface HistoryRow {
  datum: string; // DD.MM.YYYY
  bankName: string;
  menge: number; // nominal amount
  prozent: number; // interest rate
  ereignis: string; // e.g. "Eröffnung" / "Ablauf"
  aenderung: "up" | "down" | "none"; // change vs previous entry for same bank
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildHistoryHtml(rows: HistoryRow[], groups: HistoryGroup[]): string {
  const hasGroups = groups.length > 0;
  const veranlagungCols = hasGroups
    ? groups.map((g) => g.name)
    : ["Betrag"];

  // Compute today's date string and find insertion point
  const todayStr = new Date().toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });
  // Parse DD.MM.YYYY to comparable value
  const parseDatum = (d: string) => {
    const [day, month, year] = d.split(".");
    return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
  };
  const todayTime = parseDatum(todayStr);

  // Compute running totals to find sum at today
  let todaySumTotal = 0;
  const todayGroupSums: Record<string, number> = {};
  if (hasGroups) groups.forEach((g) => (todayGroupSums[g.name] = 0));
  let todayRowInserted = false;

  const body = rows
    .map((r, idx) => {
      // Update running totals
      if (r.ereignis === "Eröffnung") {
        todaySumTotal += r.menge;
        if (hasGroups) {
          groups.forEach((g) => {
            if (g.banks.includes(r.bankName)) todayGroupSums[g.name] += r.menge;
          });
        }
      }
      if (r.ereignis === "Ablauf") {
        todaySumTotal -= r.menge;
        if (hasGroups) {
          groups.forEach((g) => {
            if (g.banks.includes(r.bankName)) todayGroupSums[g.name] -= r.menge;
          });
        }
      }

      const mengeText = r.menge.toLocaleString("de-DE", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

      const groupCells = hasGroups
        ? groups
            .map((g) => {
              const val =
                r.ereignis === "Eröffnung" && g.banks.includes(r.bankName)
                  ? mengeText
                  : "";
              return `<td style="text-align:right">${val}</td>`;
            })
            .join("")
        : `<td style="text-align:right">${r.ereignis === "Eröffnung" ? mengeText : ""}</td>`;

      const ablaufCell = `<td style="text-align:right;background:#f5f5f5">${r.ereignis === "Ablauf" ? mengeText : ""}</td>`;

      const row = `<tr>
          <td>${r.datum}</td>
          <td>${escapeXml(r.bankName)}</td>
          ${groupCells}
          ${ablaufCell}
        </tr>`;

      // Check if we need to insert the today summary row after this row
      let todayRow = "";
      if (!todayRowInserted) {
        const currentTime = parseDatum(r.datum);
        const nextTime = idx < rows.length - 1 ? parseDatum(rows[idx + 1].datum) : Infinity;
        if (currentTime <= todayTime && nextTime > todayTime) {
          todayRowInserted = true;
          const sumText = todaySumTotal.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          const todayGroupCells = hasGroups
            ? groups.map((g) => {
                const val = todayGroupSums[g.name].toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                return `<td style="text-align:right;color:#fff;font-weight:bold">${val}</td>`;
              }).join("")
            : `<td style="text-align:right;color:#fff;font-weight:bold">${sumText}</td>`;
          todayRow = `<tr style="background:#1677ff !important;color:#fff;font-weight:bold">
            <td style="color:#fff;font-weight:bold">${todayStr}</td>
            <td style="color:#fff;font-weight:bold">⟶ Summe heute</td>
            ${todayGroupCells}
            <td style="text-align:right;color:#fff;font-weight:bold">${sumText}</td>
          </tr>`;
        }
      }

      return row + todayRow;
    })
    .join("");

  // If today is after all rows, append summary at end
  let todayAppendRow = "";
  if (!todayRowInserted && rows.length > 0) {
    const sumText = todaySumTotal.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const todayGroupCells = hasGroups
      ? groups.map((g) => {
          const val = todayGroupSums[g.name].toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          return `<td style="text-align:right;color:#fff;font-weight:bold">${val}</td>`;
        }).join("")
      : `<td style="text-align:right;color:#fff;font-weight:bold">${sumText}</td>`;
    todayAppendRow = `<tr style="background:#1677ff !important;color:#fff;font-weight:bold">
      <td style="color:#fff;font-weight:bold">${todayStr}</td>
      <td style="color:#fff;font-weight:bold">⟶ Summe heute</td>
      ${todayGroupCells}
      <td style="text-align:right;color:#fff;font-weight:bold">${sumText}</td>
    </tr>`;
  }

  const colCount = 2 + veranlagungCols.length + 1;
  const colWidth = Math.floor(56 / (veranlagungCols.length + 1));

  const generated = new Date().toLocaleString("de-AT");
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8" />
<title>Chronologische Historie</title>
<style>
  body, html { font-family: Arial, sans-serif; margin: 0; padding: 20px; color: #333; }
  h1 { text-align: center; margin-bottom: 4px; }
  .meta { text-align: center; color: #666; margin-bottom: 20px; font-size: 0.9em; }
  table { width: 100%; border-collapse: collapse; }
  table, th, td { border: 1px solid #ddd; }
  th { background-color: #f2f2f2; padding: 10px; text-align: left; }
  td { padding: 8px 10px; }
  tr:nth-child(even) { background-color: #f9f9f9; }
  .group-header { text-align: center; font-weight: bold; }
</style>
</head>
<body>
  <h1>Chronologische Historie aller Veranlagungen</h1>
  <div class="meta">Erstellt am ${generated}</div>
  <table>
    <thead>
      <tr>
        <th rowspan="2" style="width:12%">Datum</th>
        <th rowspan="2" style="width:30%">Bankname</th>
        <th colspan="${veranlagungCols.length + 1}" class="group-header" style="text-align:center">Veranlagung (€)</th>
      </tr>
      <tr>
        ${veranlagungCols.map((c) => `<th style="width:${colWidth}%; text-align:right">${escapeXml(c)}</th>`).join("")}
        <th style="width:${58 - veranlagungCols.length * colWidth}%; text-align:right; background:#f5f5f5">Ablauf</th>
      </tr>
    </thead>
    <tbody>
      ${body}${todayAppendRow}
    </tbody>
  </table>
</body>
</html>`;
}

export function buildHistoryExcelXml(rows: HistoryRow[], groups: HistoryGroup[]): string {
  const hasGroups = groups.length > 0;
  const veranlagungCols = hasGroups ? groups.map((g) => g.name) : ["Betrag"];
  const headerStyle = ' ss:StyleID="headerRow"';

  const parseDatumExcel = (d: string) => {
    const [day, month, year] = d.split(".");
    return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
  };
  const todayStrExcel = new Date().toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });
  const todayTimeExcel = parseDatumExcel(todayStrExcel);
  let excelSum = 0;
  const excelGroupSums: Record<string, number> = {};
  if (hasGroups) groups.forEach((g) => (excelGroupSums[g.name] = 0));
  let excelTodayInserted = false;

  const cells = rows
    .map((r, idx) => {
      if (r.ereignis === "Eröffnung") {
        excelSum += r.menge;
        if (hasGroups) groups.forEach((g) => { if (g.banks.includes(r.bankName)) excelGroupSums[g.name] += r.menge; });
      }
      if (r.ereignis === "Ablauf") {
        excelSum -= r.menge;
        if (hasGroups) groups.forEach((g) => { if (g.banks.includes(r.bankName)) excelGroupSums[g.name] -= r.menge; });
      }

      const mengeText = r.menge.toLocaleString("de-DE", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

      const groupCells = hasGroups
        ? groups
            .map((g) => {
              const val =
                r.ereignis === "Eröffnung" && g.banks.includes(r.bankName)
                  ? mengeText
                  : "";
              return `<Cell ss:StyleID="normal"><Data ss:Type="String">${escapeXml(val)}</Data></Cell>`;
            })
            .join("\n        ")
        : `<Cell ss:StyleID="normal"><Data ss:Type="String">${escapeXml(r.ereignis === "Eröffnung" ? mengeText : "")}</Data></Cell>`;

      const ablaufVal = r.ereignis === "Ablauf" ? mengeText : "";

      let row = `<Row>
        <Cell${headerStyle}><Data ss:Type="String">${escapeXml(r.datum)}</Data></Cell>
        <Cell${headerStyle}><Data ss:Type="String">${escapeXml(r.bankName)}</Data></Cell>
        ${groupCells}
        <Cell ss:StyleID="ablauf"><Data ss:Type="String">${escapeXml(ablaufVal)}</Data></Cell>
      </Row>`;

      // Insert today summary row
      if (!excelTodayInserted) {
        const currentTime = parseDatumExcel(r.datum);
        const nextTime = idx < rows.length - 1 ? parseDatumExcel(rows[idx + 1].datum) : Infinity;
        if (currentTime <= todayTimeExcel && nextTime > todayTimeExcel) {
          excelTodayInserted = true;
          const sumText = excelSum.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          const todayGroupCells = hasGroups
            ? groups.map((g) => {
                const val = excelGroupSums[g.name].toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                return `<Cell ss:StyleID="todayRow"><Data ss:Type="String">${escapeXml(val)}</Data></Cell>`;
              }).join("\n        ")
            : `<Cell ss:StyleID="todayRow"><Data ss:Type="String">${escapeXml(sumText)}</Data></Cell>`;
          row += `\n      <Row>
        <Cell ss:StyleID="todayRow"><Data ss:Type="String">${escapeXml(todayStrExcel)}</Data></Cell>
        <Cell ss:StyleID="todayRow"><Data ss:Type="String">\u27f6 Summe heute</Data></Cell>
        ${todayGroupCells}
        <Cell ss:StyleID="todayRow"><Data ss:Type="String">${escapeXml(sumText)}</Data></Cell>
      </Row>`;
        }
      }

      return row;
    })
    .join("\n");

  // Append if today is after all rows
  let excelTodayAppendRow = "";
  if (!excelTodayInserted && rows.length > 0) {
    const sumText = excelSum.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const todayGroupCells = hasGroups
      ? groups.map((g) => {
          const val = excelGroupSums[g.name].toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          return `<Cell ss:StyleID="todayRow"><Data ss:Type="String">${escapeXml(val)}</Data></Cell>`;
        }).join("\n        ")
      : `<Cell ss:StyleID="todayRow"><Data ss:Type="String">${escapeXml(sumText)}</Data></Cell>`;
    excelTodayAppendRow = `\n      <Row>
      <Cell ss:StyleID="todayRow"><Data ss:Type="String">${escapeXml(todayStrExcel)}</Data></Cell>
      <Cell ss:StyleID="todayRow"><Data ss:Type="String">\u27f6 Summe heute</Data></Cell>
      ${todayGroupCells}
      <Cell ss:StyleID="todayRow"><Data ss:Type="String">${escapeXml(sumText)}</Data></Cell>
    </Row>`;
  }

  const columns = [
    '<Column ss:Width="110"/>',
    '<Column ss:Width="200"/>',
    ...veranlagungCols.map(() => '<Column ss:Width="140"/>'),
    '<Column ss:Width="140"/>',
  ].join("\n   ");

  const headerCells = [
    `<Cell${headerStyle}><Data ss:Type="String">Datum</Data></Cell>`,
    `<Cell${headerStyle}><Data ss:Type="String">Bankname</Data></Cell>`,
    ...veranlagungCols.map(
      (c) => `<Cell${headerStyle}><Data ss:Type="String">${escapeXml(c)}</Data></Cell>`,
    ),
    `<Cell${headerStyle}><Data ss:Type="String">Ablauf</Data></Cell>`,
  ].join("\n    ");

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#333333"/>
   <Alignment ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="headerRow">
   <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#333333"/>
   <Interior ss:Color="#F2F2F2" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#DDDDDD"/>
   </Borders>
  </Style>
  <Style ss:ID="normal">
   <Alignment ss:Horizontal="Right"/>
  </Style>
  <Style ss:ID="ablauf">
   <Alignment ss:Horizontal="Right"/>
   <Interior ss:Color="#F5F5F5" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="todayRow">
   <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#1677FF" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Right"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Historie">
  <Table>
   ${columns}
   <Row>
    ${headerCells}
   </Row>
   ${cells}${excelTodayAppendRow}
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <Selected/>
   <Panes><Pane><Number>3</Number></Pane></Panes>
   <ProtectObjects>False</ProtectObjects>
   <ProtectScenarios>False</ProtectScenarios>
  </WorksheetOptions>
 </Worksheet>
</Workbook>`;
}
