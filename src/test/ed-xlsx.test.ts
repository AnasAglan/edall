import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

function readStoredZip(buffer: ArrayBuffer): Map<string, string> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder();
  const files = new Map<string, string>();
  let offset = 0;

  while (offset + 30 <= view.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    files.set(name, decoder.decode(bytes.slice(dataStart, dataStart + size)));
    offset = dataStart + size;
  }
  return files;
}

describe("ED-ALL XLSX export", () => {
  it("creates a readable right-to-left XLSX workbook with safe text cells", async () => {
    const source = read("public/ed-xlsx.js");
    const sandbox = {
      window: {},
      Blob,
      TextEncoder,
      TextDecoder,
      Uint8Array,
      DataView,
      ArrayBuffer,
      URL,
      Math,
      JSON,
      Number,
      String,
      Object,
      setTimeout,
      clearTimeout,
    };
    runInNewContext(source, sandbox);
    const api = (sandbox.window as { EDALLXLSX?: { createWorkbookBlob: (rows: unknown[], options?: unknown) => Promise<Blob> } }).EDALLXLSX;
    expect(api).toBeDefined();

    const blob = await api!.createWorkbookBlob(
      [{ student: "أحمد & <اختبار>", score: 95, comment: "=HYPERLINK(\"https://bad.example\")" }],
      { rightToLeft: true, sheetName: "التقرير" },
    );
    expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const files = readStoredZip(await blob.arrayBuffer());
    expect(files.has("[Content_Types].xml")).toBe(true);
    expect(files.has("xl/workbook.xml")).toBe(true);

    const worksheet = files.get("xl/worksheets/sheet1.xml") || "";
    expect(worksheet).toContain('rightToLeft="1"');
    expect(worksheet).toContain("أحمد &amp; &lt;اختبار&gt;");
    expect(worksheet).toContain("=HYPERLINK");
    expect(worksheet).not.toContain("<f>");
    expect(worksheet).toContain('t="inlineStr"');
  });

  it("keeps the first row frozen and supports a header-only report", async () => {
    const source = read("public/ed-xlsx.js");
    const sandbox = { window: {}, Blob, TextEncoder, Uint8Array, DataView, ArrayBuffer, URL, Math, JSON, Number, String, Object, setTimeout, clearTimeout };
    runInNewContext(source, sandbox);
    const api = (sandbox.window as { EDALLXLSX?: { createWorkbookBlob: (rows: unknown[], options?: unknown) => Promise<Blob> } }).EDALLXLSX;
    expect(api).toBeDefined();
    const blob = await api!.createWorkbookBlob([], { headers: ["الاسم", "الدرجة"], rightToLeft: true });
    const files = readStoredZip(await blob.arrayBuffer());
    expect(files.get("xl/worksheets/sheet1.xml")).toContain('state="frozen"');
    expect(files.get("xl/worksheets/sheet1.xml")).toContain("الدرجة");
  });
});

describe("ED-ALL assignment grading integrity", () => {
  it("does not let a student overwrite a graded submission", () => {
    const migration = read("supabase/migrations/20261114121000_add_integrated_learning_suite.sql");
    const start = migration.indexOf("CREATE OR REPLACE FUNCTION public.submit_assignment");
    const end = migration.indexOf("$function$;", start);
    const submitRpc = migration.slice(start, end < 0 ? undefined : end);
    expect(submitRpc).toContain("SUBMISSION_ALREADY_GRADED");
    expect(submitRpc).toContain("FOR UPDATE");
  });
});
