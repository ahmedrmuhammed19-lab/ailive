import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { accessCodeValid, REPORTS_DIR } from "@/lib/portal";

/** GET /api/report/download?code=...&file=... — stream one report from the reports directory (traversal-safe). */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (!accessCodeValid(searchParams.get("code"))) {
    return NextResponse.json(
      { ok: false, error: "Invalid access code." },
      { status: 401 }
    );
  }

  const name = searchParams.get("file") ?? "";
  const base = path.resolve(REPORTS_DIR);
  const target = path.resolve(base, name);
  if (!target.startsWith(base + path.sep)) {
    return NextResponse.json(
      { ok: false, error: "Invalid file reference." },
      { status: 400 }
    );
  }
  const ext = path.extname(target).toLowerCase();
  if (ext !== ".html" && ext !== ".pdf") {
    return NextResponse.json(
      { ok: false, error: "Unsupported report type." },
      { status: 400 }
    );
  }

  let data: Buffer;
  try {
    data = await readFile(target);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Report not found." },
      { status: 404 }
    );
  }

  const contentType = ext === ".pdf" ? "application/pdf" : "text/html; charset=utf-8";
  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${path.basename(target)}"`,
      "Content-Length": String(data.length),
    },
  });
}
