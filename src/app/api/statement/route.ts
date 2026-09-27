import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStoredObject } from "@/lib/storage";
import { sessionAccount } from "@/lib/session";
import { isOperator, ownedScope } from "@/lib/authz";

/**
 * GET /api/statement?id=... — stream one uploaded statement back to a
 * signed-in account. Resolves the file record, then proxies bytes from
 * blob storage (production) or the local filesystem (dev).
 * Operators can fetch any statement; client accounts only their own.
 */
export async function GET(req: Request) {
  const account = await sessionAccount(req);
  if (!account) {
    return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  }

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) {
    return NextResponse.json({ ok: false, error: "File id is required." }, { status: 400 });
  }

  const row = await db.statementFile.findUnique({
    where: { id },
    include: { submission: { select: { submittedBy: true, userId: true } } },
  });
  if (!row) {
    return NextResponse.json({ ok: false, error: "File not found." }, { status: 404 });
  }

  if (!isOperator(account)) {
    const owns =
      row.submission.submittedBy === account.username ||
      row.submission.userId === account.username;
    if (!owns) {
      return NextResponse.json({ ok: false, error: "Not your statement." }, { status: 403 });
    }
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

  // disp=inline renders the statement in the browser tab (portal "view" UX);
  // default stays attachment (plain download) so existing links behave as before.
  const inline = new URL(req.url).searchParams.get("disp") === "inline";
  const safeName = row.originalName.replace(/"/g, "");

  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": type,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safeName}"`,
      "Content-Length": String(data.length),
    },
  });
}
