import { proxyAiGenerateRequest } from "../proxy";

export async function POST(request: Request) {
  return proxyAiGenerateRequest(request, "/start");
}