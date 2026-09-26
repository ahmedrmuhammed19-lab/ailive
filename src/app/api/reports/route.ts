import { NextResponse } from "next/server";
import { readdir, stat } from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { humanSize, REPORTS_DIR } from "@/lib/portal";
import { sessionAccount } from "@/lib/session";
import { isOperator, ownedScope } from "@/lib/authz";

interface ReportEntry {
  name: string;
  sizeBytes: number;
  sizeHuman: string;
  modified: string;
}

/**
 * GET /api/reports — list deliverable reports (HTML/PDF).
 * Merges published ReportFile rows (blob storage in production) with the
 * local reports directory (dev / self-hosted). Operators see everything;
 * client accounts only see reports on their own submissions.
 */
export async function GET(req: Request) {
  const account = await sessionAccount(req);
  if (!account) {
    return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  }

  const operator = isOperator(account);
  const byName = new Map<string, ReportEntry>();

  // 1) Published reports (Vercel Blob in production; empty table in local dev)
  try {
    let published;
    if (operator) {
      published = await db.reportFile.findMany({ orderBy: { createdAt: "desc" } });
    } else {
      // client scope: reports joined to submissions they own
      const owned = await db.submission.findMany({
        where: ownedScope(account.username),
        select: { id: true },
      });
      const ids = owned.map((s) => s.id);
      published = ids.length
        ? await db.reportFile.findMany({
            where: { submissionId: { in: ids } },
            orderBy: { createdAt: "desc" },
          })
        : [];
    }
    for (const r of published) {
      byName.set(r.name, {
        name: r.name,
        sizeBytes: r.sizeBytes,
        sizeHuman: humanSize(r.sizeBytes),
        modified: r.createdAt.toISOString(),
      });
    }
  } catch {
    // table missing / db hiccup — fall through to local listing
  }

  // 2) Local reports directory (dev / self-hosted) — operators only
  if (operator) {
    let names: string[] = [];
    try {
      names = await readdir(REPORTS_DIR);
    } catch {
      // no local dir (e.g. serverless) — published list only
    }
    const localNames = names.filter((n) => {
      const ext = path.extname(n).toLowerCase();
      return (
        (ext === ".html" || ext === ".pdf") &&
        !n.startsWith(".") &&
        !n.startsWith("A_BACKUP") &&
        !n.startsWith("Global_EIS_Pipeline_SelfTest")
      );
    });
    for (const n of localNames) {
      if (byName.has(n)) continue; // published entry wins (it carries the blob URL)
      try {
        const s = await stat(path.join(REPORTS_DIR, n));
        byName.set(n, {
          name: n,
          sizeBytes: s.size,
          sizeHuman: humanSize(s.size),
          modified: s.mtime.toISOString(),
        });
      } catch {
        // file vanished between readdir and stat — skip
      }
    }
  }

  const reports = Array.from(byName.values()).sort((a, b) =>
    b.modified.localeCompare(a.modified)
  );
  return NextResponse.json({ ok: true, reports });
}
