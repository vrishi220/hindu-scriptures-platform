import { proxyAiGenerateRequest } from "../proxy";

export async function GET(request: Request) {
  return proxyAiGenerateRequest(request, "/estimate");
}