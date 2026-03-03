import { proxyTemplatesRequest } from "./proxy";

export async function GET(request: Request) {
  return proxyTemplatesRequest(request, "");
}

export async function POST(request: Request) {
  return proxyTemplatesRequest(request, "");
}

export async function PATCH(request: Request) {
  return proxyTemplatesRequest(request, "");
}

export async function DELETE(request: Request) {
  return proxyTemplatesRequest(request, "");
}
