import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
  const cookies = request.headers.get('cookie');

  try {
    const response = await fetch(`${backendUrl}/api/content/daily-verse`, {
      headers: cookies ? { cookie: cookies } : {},
      credentials: 'include',
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch daily verse' }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching daily verse:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
