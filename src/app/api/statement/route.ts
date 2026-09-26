import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStoredObject } from "@/lib/storage";
import { sessionUser } from "@/lib/session";

/**
 * GET /api/statement?id=... — stream one uploaded statement back to a
 * signed-in account. Resolves the file record, then proxies bytes from
 * blob storage (production) or the local filesystem (dev).
 */
export async function GET(req: Request) {
  const user = await sessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  }

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) {
    return NextResponse.json({ ok: false, error: "File id is required." }, { status: 400 });
  }

  const row = await db.statementFile.findUnique({ where: { id } });
  if (!row) {
    return NextResponse.json({ ok: false, error: "File not found." }, { status: 404 });
  }

  // DB storage mode: bytes live on the row itself; otherwise blob/fs lookup.
  const data = row.data
    ? Buffer.from(row.data)
    : await getStoredObject({ key: row.storedPath, url: row.storedUrl ?? "" });
  if (!data) {
    return NextResponse.json({ ok: false, error: "File not found." }, { status: 404 });
  }

  const ext = (row.originalName.split(".").pop() ?? "").toLowerCase();
  const type =
    ext === "pdf"
      ? "application/pdf"
      : ext === "png"
        ? "image/png"
        : ext === "jpg" || ext === "jpeg"
          ? "image/jpeg"
          : "application/octet-stream";

  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${row.originalName.replace(/"/g, "")}"`,
      "Content-Length": String(data.length),
    },
  });
}
