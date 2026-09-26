import { NextResponse } from "next/server";
import { accessCodeValid } from "@/lib/portal";

export async function POST(req: Request) {
  try {
    const { code } = (await req.json()) as { code?: string };
    return NextResponse.json({ ok: accessCodeValid(code) });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
