import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import prisma from '../../../../lib/prisma';

export const dynamic = 'force-dynamic';

const DASHBOARD_URL = process.env.DASHBOARD_URL ?? 'https://payvaultdocs.co.uk';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
        return NextResponse.redirect(`${DASHBOARD_URL}/?error=oauth_error`);
    }

    if (!code) {
        return NextResponse.redirect(`${DASHBOARD_URL}/?error=no_code`);
    }

    const storedState = request.cookies.get('oauth_state_web')?.value;
    if (!state || !storedState || state !== storedState) {
        return NextResponse.redirect(`${DASHBOARD_URL}/?error=invalid_state`);
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
        return NextResponse.redirect(`${DASHBOARD_URL}/?error=server_error`);
    }

    try {
        const tokenResponse = await fetch('https://identity.xero.com/connect/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${Buffer.from(`${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`).toString('base64')}`,
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: process.env.XERO_WEB_REDIRECT_URI ?? '',
            }),
        });

        const tokenData = await tokenResponse.json();
        if (!tokenResponse.ok) {
            console.error('[PayVault] Xero token exchange failed:', tokenData.error);
            return NextResponse.redirect(`${DASHBOARD_URL}/?error=token_exchange`);
        }

        const connectionsResponse = await fetch('https://api.xero.com/connections', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });

        const connections = await connectionsResponse.json();
        if (!connections || connections.length === 0) {
            return NextResponse.redirect(`${DASHBOARD_URL}/?error=no_tenant`);
        }

        const xeroTenantId = connections[0].tenantId;
        const tenantName = connections[0].tenantName;

        const tenant = await prisma.tenant.upsert({
            where: { xeroTenantId },
            update: {
                name: tenantName,
                accessToken: tokenData.access_token,
                refreshToken: tokenData.refresh_token,
                expiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
            },
            create: {
                xeroTenantId,
                name: tenantName,
                accessToken: tokenData.access_token,
                refreshToken: tokenData.refresh_token,
                expiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
            },
        });

        const token = jwt.sign(
            { tenantId: tenant.id, xeroTenantId: tenant.xeroTenantId },
            jwtSecret,
            { expiresIn: '30d' }
        );

        const response = NextResponse.redirect(`${DASHBOARD_URL}/dashboard`);
        response.cookies.set('payvault_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 30, // 30 days
            path: '/',
        });
        response.cookies.set('oauth_state_web', '', { maxAge: 0, path: '/' });

        return response;
    } catch (err) {
        console.error('[PayVault] Web OAuth callback error:', err);
        return NextResponse.redirect(`${DASHBOARD_URL}/?error=server_error`);
    }
}
