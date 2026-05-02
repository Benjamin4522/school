import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { redisGetExecution } from "@/lib/redis";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("jobId");

    if (!jobId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "jobId query parameter is required",
          },
        },
        { status: 400 }
      );
    }

    const redisData = await redisGetExecution(jobId) as Record<string, any> | null;

    const execution = await db.execution.findUnique({
      where: { id: jobId },
    });

    if (!execution) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "NOT_FOUND",
            message: "Execution not found",
          },
        },
        { status: 404 }
      );
    }

    const logLines = execution.logs ? execution.logs.split("\n") : [];
    const currentPhase = redisData?.phase || inferPhaseFromStatus(execution.status);

    const createdAt = new Date(execution.createdAt).getTime();
    const elapsedMs = execution.status === "completed" || execution.status === "failed"
      ? (redisData?.durationMs || 0)
      : Date.now() - createdAt;

    const progress = calculateProgress(currentPhase, execution.status);

    const recentLogs = logLines.slice(-5);

    return NextResponse.json(
      {
        success: true,
        data: {
          jobId: execution.id,
          status: execution.status,
          phase: currentPhase,
          progress,
          logs: execution.logs,
          recentLogs,
          elapsedMs,
          gameId: execution.gameId,
          createdAt: execution.createdAt,
          ...(redisData && {
            redisPhase: redisData.phase,
            startedAt: redisData.startedAt,
            completedAt: redisData.completedAt,
            failedAt: redisData.failedAt,
            durationMs: redisData.durationMs,
          }),
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[executor/status] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to fetch execution status",
        },
      },
      { status: 500 }
    );
  }
}

function inferPhaseFromStatus(status: string): string {
  switch (status) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "unknown";
  }
}

function calculateProgress(phase: string, status: string): number {
  if (status === "completed") return 100;
  if (status === "failed") return 0;

  const phaseProgress: Record<string, number> = {
    queued: 5,
    validating: 20,
    allocating: 40,
    injecting: 60,
    running: 80,
  };

  return phaseProgress[phase] || 10;
}
