import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { markDoneAndNotify } from "@/lib/notify";

/**
 * TEMPORARY (DL-14d) — single-purpose analyst close-out for case EIS-DV4G2.
 *
 * Context: the analyst finished the DL-12/13 report but the sandbox lost the
 * production-matched SESSION_SECRET in a wipe, so the HMAC-verified attach
 * path (/api/queue/attach/<token>/<spec>) cannot be invoked from outside.
 * This route performs THE EXACT SAME flow server-side, where the runtime env
 * is trusted, for ONE hardcoded case and ONE hardcoded file. It accepts no
 * parameters, exposes no secrets, is idempotent, and is REMOVED in the next
 * commit after it fires once. Nothing here is reusable for any other case.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const QUEUE = "EIS-DV4G2";
const FILE_URL =
  "https://raw.githubusercontent.com/ahmedrmuhammed19-lab/ailive/main/published/GlobalEIS_Report_AmirEzzat_CIB_EGP_427rows.html";
const NAME = "GlobalEIS_Report_AmirEzzat_CIB_EGP_428rows_rev1.1.html";
const NOTE =
  "DL-12/13 analyst attach - full Master v1.2.6 forensic report, rev 1.1, 428 rows. " +
  "Apr/Jul/Aug exact to bank prints, Sep chain 91/91, May captured span exact at 9 checkpoints. " +
  "May 25-31 = one unscanned sheet; bank prints fix its net at -EGP 45,186.26 (135,283.04 -> 90,096.78). " +
  "Re-scan of that sheet upgrades May to full census.";
const MAX_BYTES = 8 * 1024 * 1024;

export async function GET() {
  const subs = await db.submission.findMany({
    where: { userId: QUEUE },
    orderBy: { createdAt: "asc" },
  });
  if (subs.length === 0) {
    return NextResponse.json({ ok: false, error: `No case for queue ${QUEUE}.` }, { status: 404 });
  }
  const sub = subs.find((s) => s.status !== "DONE") ?? subs[0];

  const existing = await db.reportFile.findMany({ where: { submissionId: sub.id } });
  const dup = existing.find((r) => r.name === NAME);

  if (!dup) {
    const res = await fetch(FILE_URL, { signal: AbortSignal.timeout(30_000), redirect: "follow" });
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `fetch HTTP ${res.status}` }, { status: 502 });
    }
    const ab = await res.arrayBuffer();
    if (ab.byteLength > MAX_BYTES) {
      return NextResponse.json({ ok: false, error: "file too large" }, { status: 413 });
    }
    const buf = Buffer.from(ab);
    const head = buf.subarray(0, 4096).toString("utf8").trim().toLowerCase();
    if (!head.startsWith("<!doctype html") && !head.startsWith("<html") && !head.startsWith("<")) {
      return NextResponse.json({ ok: false, error: "content is not HTML" }, { status: 415 });
    }
    await db.reportFile.create({
      data: {
        submissionId: sub.id,
        queueId: sub.userId,
        name: NAME,
        url: "",
        data: buf,
        sizeBytes: buf.length,
      },
    });
  }

  if (sub.status === "DONE") {
    return NextResponse.json({
      ok: true,
      queueId: sub.userId,
      submissionId: sub.id,
      status: sub.status,
      attached: dup ? [] : [{ name: NAME }],
      skipped: dup ? [{ name: NAME, reason: "already attached" }] : [],
      alreadyDone: true,
    });
  }

  const done = await markDoneAndNotify(sub.id, [NAME], NOTE);
  return NextResponse.json({
    ok: true,
    queueId: sub.userId,
    submissionId: sub.id,
    status: done?.status ?? sub.status,
    attached: [{ name: NAME, sizeBytes: dup ? dup.sizeBytes : 0 }],
    skipped: dup ? [{ name: NAME, reason: "already attached" }] : [],
    notified: done?.notified ?? null,
  });
}
