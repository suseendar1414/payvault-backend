import { NextResponse } from 'next/server';
import crypto from 'crypto';

export async function GET() {
    const clientId = process.env.XERO_CLIENT_ID;
    const redirectUri = process.env.XERO_REDIRECT_URI;
    const scopes = 'openid profile email payroll.employees offline_access';

    if (!clientId || !redirectUri) {
        return NextResponse.json({ error: 'Xero OAuth configuration missing' }, { status: 500 });
    }

    // Cryptographically secure state for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');

    const authUrl = new URL('https://login.xero.com/identity/connect/authorize');
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('client_id', clientId);
    authUrl.searchParams.append('redirect_uri', redirectUri);
    authUrl.searchParams.append('scope', scopes);
    authUrl.searchParams.append('state', state);

    // Store state in a short-lived, httpOnly, SameSite=Lax cookie so we can verify it in the callback
    const response = NextResponse.redirect(authUrl.toString());
    response.cookies.set('oauth_state', state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 600, // 10 minutes
        path: '/'
    });

    return response;
}
