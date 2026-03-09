import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_ORIGINS = [
    'https://payroll.xero.com',
    'https://payvaultdocs.co.uk',
    'http://localhost:3000',
    'http://localhost:3001',
];

export function middleware(request: NextRequest) {
    const origin = request.headers.get('origin') ?? '';
    const isAllowed = ALLOWED_ORIGINS.includes(origin);

    // Handle OPTIONS preflight
    if (request.method === 'OPTIONS') {
        return new NextResponse(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': isAllowed ? origin : '',
                'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Authorization, Content-Type',
                'Access-Control-Max-Age': '86400',
            },
        });
    }

    const response = NextResponse.next();

    if (isAllowed) {
        response.headers.set('Access-Control-Allow-Origin', origin);
        response.headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    }

    return response;
}

export const config = {
    matcher: '/api/:path*',
};

// NOTE: Next.js 16 deprecates "middleware" in favour of "proxy".
// CORS is handled here for now; migrate to proxy.ts if upgrading.
