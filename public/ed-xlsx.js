/* ED-ALL native XLSX exporter. Builds a standards-compliant OOXML workbook without external runtime dependencies. */
(function (global) {
  "use strict";

  const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const XML_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const encoder = new TextEncoder();

  function xmlSafe(value) {
    return String(value == null ? "" : value)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "\uFFFD")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function columnName(index) {
    let n = index + 1;
    let name = "";
    while (n > 0) {
      const remainder = (n - 1) % 26;
      name = String.fromCharCode(65 + remainder) + name;
      n = Math.floor((n - 1) / 26);
    }
    return name;
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc ^= bytes[i];
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function zipStored(entries) {
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;
    let centralSize = 0;

    for (const entry of entries) {
      const nameBytes = encoder.encode(entry.name);
      const dataBytes = encoder.encode(entry.content);
      const checksum = crc32(dataBytes);

      const local = new Uint8Array(30);
      const localView = new DataView(local.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, 0, true);
      localView.setUint16(12, 0x0021, true);
      localView.setUint32(14, checksum, true);
      localView.setUint32(18, dataBytes.length, true);
      localView.setUint32(22, dataBytes.length, true);
      localView.setUint16(26, nameBytes.length, true);
      localView.setUint16(28, 0, true);
      localParts.push(local, nameBytes, dataBytes);

      const central = new Uint8Array(46);
      const centralView = new DataView(central.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, 0, true);
      centralView.setUint16(14, 0x0021, true);
      centralView.setUint32(16, checksum, true);
      centralView.setUint32(20, dataBytes.length, true);
      centralView.setUint32(24, dataBytes.length, true);
      centralView.setUint16(28, nameBytes.length, true);
      centralView.setUint16(30, 0, true);
      centralView.setUint16(32, 0, true);
      centralView.setUint16(34, 0, true);
      centralView.setUint16(36, 0, true);
      centralView.setUint32(38, 0, true);
      centralView.setUint32(42, localOffset, true);
      centralParts.push(central, nameBytes);

      localOffset += local.length + nameBytes.length + dataBytes.length;
      centralSize += central.length + nameBytes.length;
    }

    const centralOffset = localOffset;
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(4, 0, true);
    endView.setUint16(6, 0, true);
    endView.setUint16(8, entries.length, true);
    endView.setUint16(10, entries.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, centralOffset, true);
    endView.setUint16(20, 0, true);

    const parts = localParts.concat(centralParts, [end]);
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const archive = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      archive.set(part, offset);
      offset += part.length;
    }
    return archive;
  }

  function valueAsText(value) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    try {
      return JSON.stringify(value);
    } catch (_) {
      return String(value);
    }
  }

  function cellXml(reference, value, styleIndex) {
    const style = styleIndex ? ' s="' + styleIndex + '"' : "";
    if (typeof value === "number" && Number.isFinite(value)) {
      return '<c r="' + reference + '"' + style + '><v>' + String(value) + '</v></c>';
    }
    if (typeof value === "boolean") {
      return '<c r="' + reference + '"' + style + ' t="b"><v>' + (value ? "1" : "0") + '</v></c>';
    }
    const text = xmlSafe(valueAsText(value));
    return '<c r="' + reference + '"' + style + ' t="inlineStr"><is><t xml:space="preserve">' + text + '</t></is></c>';
  }

  function workbookEntries(rows, options) {
    const settings = options || {};
    const items = Array.isArray(rows) ? rows.filter(row => row && typeof row === "object") : [];
    const requestedHeaders = Array.isArray(settings.headers) ? settings.headers : null;
    const headers = requestedHeaders
      ? requestedHeaders.map(valueAsText)
      : Array.from(new Set(items.flatMap(item => Object.keys(item))));
    if (!headers.length) headers.push("بيانات");

    const safeSheetName = String(settings.sheetName || "ED-ALL")
      .replace(/[\\/*?:\[\]]/g, "_").trim().slice(0, 31) || "ED-ALL";
    const rowXml = [];
    rowXml.push('<row r="1">' + headers.map((header, index) => cellXml(columnName(index) + "1", header, 1)).join("") + '</row>');
    items.forEach((item, rowIndex) => {
      const rowNumber = rowIndex + 2;
      const cells = headers.map((header, index) => cellXml(columnName(index) + rowNumber, item[header], 0)).join("");
      rowXml.push('<row r="' + rowNumber + '">' + cells + '</row>');
    });

    const lastCell = columnName(headers.length - 1) + Math.max(1, items.length + 1);
    const rightToLeft = settings.rightToLeft !== false;
    const filter = items.length ? '<autoFilter ref="A1:' + lastCell + '"/>' : "";
    const worksheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="' + XML_NS + '" xmlns:r="' + REL_NS + '">' +
      '<dimension ref="A1:' + lastCell + '"/>' +
      '<sheetViews><sheetView workbookViewId="0"' + (rightToLeft ? ' rightToLeft="1"' : "") + '>' +
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      '</sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/>' +
      '<sheetData>' + rowXml.join("") + '</sheetData>' + filter + '</worksheet>';

    const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>';

    const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';

    const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="' + XML_NS + '" xmlns:r="' + REL_NS + '">' +
      '<bookViews><workbookView/></bookViews><sheets><sheet name="' + xmlSafe(safeSheetName) + '" sheetId="1" r:id="rId1"/></sheets>' +
      '</workbook>';

    const workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';

    const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="' + XML_NS + '">' +
      '<fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Arial"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>';

    return [
      { name: "[Content_Types].xml", content: contentTypes },
      { name: "_rels/.rels", content: rootRels },
      { name: "xl/workbook.xml", content: workbook },
      { name: "xl/_rels/workbook.xml.rels", content: workbookRels },
      { name: "xl/styles.xml", content: styles },
      { name: "xl/worksheets/sheet1.xml", content: worksheet },
    ];
  }

  function createWorkbookBytes(rows, options) {
    return zipStored(workbookEntries(rows, options));
  }

  async function createWorkbookBlob(rows, options) {
    return new Blob([createWorkbookBytes(rows, options)], { type: MIME });
  }

  async function download(rows, filename, options) {
    const blob = await createWorkbookBlob(rows, options);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename || ("edall-report-" + new Date().toISOString().slice(0, 10) + ".xlsx");
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  global.EDALLXLSX = { createWorkbookBytes, createWorkbookBlob, download };
})(typeof window !== "undefined" ? window : globalThis);
