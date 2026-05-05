import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyLinkerSignature } from "@/lib/server-linker";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const scriptId = searchParams.get("scriptId");
    const category = searchParams.get("category");
    const search = searchParams.get("search");
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 50);

    // ── If scriptId provided, return specific script ──
    if (scriptId) {
      const script = await db.script.findUnique({
        where: { id: scriptId },
      });

      if (!script || !script.isPublic) {
        return NextResponse.json(
          { success: false, error: { code: "NOT_FOUND", message: "Script not found or not public" } },
          { status: 404 }
        );
      }

      // Increment usage count
      await db.script.update({
        where: { id: scriptId },
        data: { usageCount: { increment: 1 } },
      });

      return NextResponse.json({
        success: true,
        data: {
          id: script.id,
          name: script.name,
          description: script.description,
          code: script.code,
          category: script.category,
          usageCount: script.usageCount + 1,
          createdAt: script.createdAt,
        },
      });
    }

    // ── Browse public scripts ──
    const where: Record<string, unknown> = { isPublic: true };

    if (category) {
      where.category = category;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    const scripts = await db.script.findMany({
      where,
      select: {
        id: true,
        name: true,
        description: true,
        category: true,
        usageCount: true,
        createdAt: true,
      },
      orderBy: { usageCount: "desc" },
      take: limit,
    });

    return NextResponse.json({
      success: true,
      data: {
        count: scripts.length,
        scripts,
      },
    });
  } catch (error) {
    console.error("[linker/scripts] Error:", error);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "Failed to fetch scripts" } },
      { status: 500 }
    );
  }
}