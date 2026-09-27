import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStoredObject } from "@/lib/storage";
import { verifyStatementViewToken } from "@/lib/actions";

/**
 * GET /api/statement/view?id=<statementFileId>&token=<hmac>
 *
 * Signed, session-free statement viewer for operator emails — the "view the
 * bank statement from the mail" link. The token is an HMAC of
 * (statementFileId:"view") keyed with SESSION_SECRET, minted only by the
 * portal when it composes an operator mail; a forged or stale token is
 * rejected with 403. Renders inline so the statement opens straight in the
 * browser tab (same trust model as the Start/Retry email buttons: possession
 * of the mail IS the authorization).
 */
export const dynamic = "force-dynamic";

function contentTypeFor(name: string): string {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  return ext === "pdf"
    ? "application/pdf"
    : ext === "png"
      ? "image/png"
      : ext === "jpg" || ext === "jpeg"
        ? "image/jpeg"
        : "application/octet-stream";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const token = url.searchParams.get("token") ?? "";

  if (!id || !verifyStatementViewToken(id, token)) {
    return NextResponse.json(
      { ok: false, error: "Invalid or expired view link — use the link inside the operator email." },
      { status: 403 }
    );
  }

  const row = await db.statementFile.findUnique({
    where: { id },
    select: { originalName: true, storedPath: true, storedUrl: true, data: true },
  });
  if (!row) {
    return NextResponse.json(
      { ok: false, error: "Statement not found — it may have been removed." },
      { status: 404 }
    );
  }

  const data = row.data
    ? Buffer.from(row.data)
    : await getStoredObject({ key: row.storedPath, url: row.storedUrl ?? "" });
  if (!data) {
    return NextResponse.json({ ok: false, error: "Statement bytes unavailable." }, { status: 404 });
  }

  const safeName = row.originalName.replace(/"/g, "");
  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": contentTypeFor(row.originalName),
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Content-Length": String(data.length),
      "Cache-Control": "no-store",
    },
  });
}
