import { proxyAiGenerateRequest } from "../../../proxy";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const resolvedParams = await params;
  return proxyAiGenerateRequest(request, `/jobs/${resolvedParams.jobId}/cancel`);
}