import { proxyTemplatesRequest } from "../proxy";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const suffix = path.length ? `/${path.join("/")}` : "";
  return proxyTemplatesRequest(request, suffix);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const suffix = path.length ? `/${path.join("/")}` : "";
  return proxyTemplatesRequest(request, suffix);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const suffix = path.length ? `/${path.join("/")}` : "";
  return proxyTemplatesRequest(request, suffix);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const suffix = path.length ? `/${path.join("/")}` : "";
  return proxyTemplatesRequest(request, suffix);
}
