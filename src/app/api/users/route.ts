import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  hashPassword,
  normalizeUsername,
  sessionAccount,
  validUsername,
} from "@/lib/session";

/**
 * Account management — operator only.
 *
 * GET  /api/users          -> list accounts (safe fields)
 * POST /api/users          -> action: add | reset | activate | deactivate
 *
 *   { action: "add",         username, password, label?, role? }
 *   { action: "reset",       username, password }
 *   { action: "activate",    username }
 *   { action: "deactivate",  username }
 *
 * Safety rails: an operator cannot deactivate or reset their own account
 * (prevents accidental lockout of the last operator).
 */

const SAFE_SELECT = {
  username: true,
  label: true,
  role: true,
  active: true,
  createdAt: true,
  lastLoginAt: true,
};

export async function GET(req: Request) {
  const me = await sessionAccount(req);
  if (!me) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (me.role !== "operator") {
    return NextResponse.json({ ok: false, error: "Operator account required." }, { status: 403 });
  }
  const users = await db.portalUser.findMany({
    select: SAFE_SELECT,
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ ok: true, users, self: me.username });
}

export async function POST(req: Request) {
  const me = await sessionAccount(req);
  if (!me) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (me.role !== "operator") {
    return NextResponse.json({ ok: false, error: "Operator account required." }, { status: 403 });
  }

  let body: {
    action?: string;
    username?: string;
    password?: string;
    label?: string;
    role?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const target = normalizeUsername(body.username ?? "");
  const password = body.password ?? "";

  switch (body.action) {
    case "add": {
      if (!validUsername(target)) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "ID must be 3-40 characters: letters, numbers, dots, dashes, underscores.",
          },
          { status: 400 }
        );
      }
      if (password.length < 8) {
        return NextResponse.json(
          { ok: false, error: "Password must be at least 8 characters." },
          { status: 400 }
        );
      }
      const role = body.role === "operator" ? "operator" : "client";
      const label = (body.label ?? "").trim().slice(0, 60) || null;
      const exists = await db.portalUser.findUnique({ where: { username: target } });
      if (exists) {
        return NextResponse.json(
          { ok: false, error: `Account "${target}" already exists — reset its password instead.` },
          { status: 409 }
        );
      }
      const user = await db.portalUser.create({
        data: { username: target, passwordHash: hashPassword(password), label, role },
        select: SAFE_SELECT,
      });
      return NextResponse.json({ ok: true, user });
    }

    case "reset": {
      if (target === me.username) {
        return NextResponse.json(
          { ok: false, error: "Use the signed-in account's own reset outside this panel." },
          { status: 400 }
        );
      }
      if (password.length < 8) {
        return NextResponse.json(
          { ok: false, error: "Password must be at least 8 characters." },
          { status: 400 }
        );
      }
      const n = await db.portalUser.updateMany({
        where: { username: target },
        data: { passwordHash: hashPassword(password), active: true },
      });
      return n.count === 0
        ? NextResponse.json({ ok: false, error: `No such account: ${target}` }, { status: 404 })
        : NextResponse.json({ ok: true });
    }

    case "activate":
    case "deactivate": {
      if (target === me.username) {
        return NextResponse.json(
          { ok: false, error: "You cannot activate/deactivate your own account." },
          { status: 400 }
        );
      }
      const n = await db.portalUser.updateMany({
        where: { username: target },
        data: { active: body.action === "activate" },
      });
      return n.count === 0
        ? NextResponse.json({ ok: false, error: `No such account: ${target}` }, { status: 404 })
        : NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json(
        { ok: false, error: "Unknown action (add | reset | activate | deactivate)." },
        { status: 400 }
      );
  }
}
