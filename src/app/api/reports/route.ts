import { NextResponse } from "next/server";
import { readdir, stat } from "fs/promises";
import path from "path";
import { accessCodeValid, humanSize, REPORTS_DIR } from "@/lib/portal";

/** GET /api/reports?code=... — list deliverable reports (HTML/PDF) in the reports directory. */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (!accessCodeValid(searchParams.get("code"))) {
    return NextResponse.json(
      { ok: false, error: "Invalid access code." },
      { status: 401 }
    );
  }

  let names: string[];
  try {
    names = await readdir(REPORTS_DIR);
  } catch {
    return NextResponse.json({ ok: true, reports: [] });
  }

  const reportNames = names.filter((n) => {
    const ext = path.extname(n).toLowerCase();
    return (
      (ext === ".html" || ext === ".pdf") &&
      !n.startsWith(".") &&
      !n.startsWith("A_BACKUP") &&
      !n.startsWith("Global_EIS_Pipeline_SelfTest")
    );
  });

  const reports = await Promise.all(
    reportNames.map(async (n) => {
      const full = path.join(REPORTS_DIR, n);
      const s = await stat(full);
      return {
        name: n,
        sizeBytes: s.size,
        sizeHuman: humanSize(s.size),
        modified: s.mtime.toISOString(),
      };
    })
  );

  reports.sort((a, b) => b.modified.localeCompare(a.modified));
  return NextResponse.json({ ok: true, reports });
}
