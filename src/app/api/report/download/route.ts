import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { REPORTS_DIR } from "@/lib/portal";
import { sessionUser } from "@/lib/session";

/**
 * GET /api/report/download?file=... — stream one report (traversal-safe).
 * Resolution order: published ReportFile (blob URL, production) → local
 * reports directory (dev / self-hosted). Requires a signed-in account.
 */
export async function GET(req: Request) {
  const user = await sessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  }

  const name = searchParams(req).get("file") ?? "";
  const ext = path.extname(name).toLowerCase();
  if (ext !== ".html" && ext !== ".pdf") {
    return NextResponse.json({ ok: false, error: "Unsupported report type." }, { status: 400 });
  }

  // 1) Published copy — DB bytes (DB storage mode) → blob URL → fall through
  try {
    const row = await db.reportFile.findFirst({
      where: { name },
      orderBy: { createdAt: "desc" },
    });
    if (row?.data) {
      return reportResponse(name, ext, Buffer.from(row.data));
    }
    if (row?.url) {
      const upstream = await fetch(row.url);
      if (!upstream.ok) {
        return NextResponse.json(
          { ok: false, error: "Report not found." },
          { status: 404 }
        );
      }
      const data = Buffer.from(await upstream.arrayBuffer());
      return reportResponse(name, ext, data);
    }
  } catch {
    // db hiccup — fall through to local file mode
  }

  // 2) Local file mode (dev / self-hosted) — resolved inside REPORTS_DIR only
  const base = path.resolve(REPORTS_DIR);
  const target = path.resolve(base, name);
  if (!target.startsWith(base + path.sep)) {
    return NextResponse.json({ ok: false, error: "Invalid file reference." }, { status: 400 });
  }

  let data: Buffer;
  try {
    data = await readFile(target);
  } catch {
    return NextResponse.json({ ok: false, error: "Report not found." }, { status: 404 });
  }
  return reportResponse(target, ext, data);
}

function searchParams(req: Request): URLSearchParams {
  return new URL(req.url).searchParams;
}

function reportResponse(fileRef: string, ext: string, data: Buffer): NextResponse {
  const contentType = ext === ".pdf" ? "application/pdf" : "text/html; charset=utf-8";
  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${path.basename(fileRef)}"`,
      "Content-Length": String(data.length),
    },
  });
}
