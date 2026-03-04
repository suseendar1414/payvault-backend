import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
import prisma from '../../../../../lib/prisma';
import jwt from 'jsonwebtoken';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
        return NextResponse.json({ error: 'OAuth error from Xero' }, { status: 400 });
    }

    if (!code) {
        return NextResponse.json({ error: 'No code provided' }, { status: 400 });
    }

    // CSRF: Verify state matches the cookie we set in /api/auth/xero
    const storedState = request.cookies.get('oauth_state')?.value;
    if (!state || !storedState || state !== storedState) {
        return NextResponse.json({ error: 'Invalid state parameter' }, { status: 403 });
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
        console.error('[PayVault] JWT_SECRET environment variable is not set');
        return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
    }

    try {
        // 1. Exchange code for token
        const tokenResponse = await fetch('https://identity.xero.com/connect/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${Buffer.from(`${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`).toString('base64')}`
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: process.env.XERO_REDIRECT_URI || ''
            })
        });

        const tokenData = await tokenResponse.json();
        if (!tokenResponse.ok) {
            console.error('[PayVault] Xero token exchange failed:', tokenData.error);
            throw new Error('Failed to fetch token');
        }

        // 2. Get connection (Tenant ID)
        const connectionsResponse = await fetch('https://api.xero.com/connections', {
            headers: {
                'Authorization': `Bearer ${tokenData.access_token}`
            }
        });

        const connections = await connectionsResponse.json();
        if (!connections || connections.length === 0) {
            throw new Error('No Xero tenants connected');
        }

        const tenantId = connections[0].tenantId;
        const tenantName = connections[0].tenantName;

        // 3. Upsert Tenant in DB
        const tenant = await prisma.tenant.upsert({
            where: { xeroTenantId: tenantId },
            update: {
                name: tenantName,
                accessToken: tokenData.access_token,
                refreshToken: tokenData.refresh_token,
                expiresAt: new Date(Date.now() + tokenData.expires_in * 1000)
            },
            create: {
                xeroTenantId: tenantId,
                name: tenantName,
                accessToken: tokenData.access_token,
                refreshToken: tokenData.refresh_token,
                expiresAt: new Date(Date.now() + tokenData.expires_in * 1000)
            }
        });

        // 4. Generate a session token for the Chrome Extension
        const extensionToken = jwt.sign(
            { tenantId: tenant.id, xeroTenantId: tenant.xeroTenantId },
            jwtSecret,
            { expiresIn: '30d' }
        );

        const extensionId = process.env.CHROME_EXTENSION_ID;
        if (!extensionId) {
            console.error('[PayVault] CHROME_EXTENSION_ID environment variable is not set');
            return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
        }

        // 5. Return success page — sends the token directly into chrome.storage.local via
        //    chrome.runtime.sendMessage so it is immediately available to the content script.
        //    Both values are safely serialised via JSON.stringify to prevent XSS.
        const safeToken = JSON.stringify(extensionToken);
        const safeExtId = JSON.stringify(extensionId);
        const htmlResponse = `
      <html>
        <head>
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-payvault'; style-src 'nonce-payvault'">
          <style nonce="payvault">
            body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; color: #374151; }
            h2 { margin-bottom: 8px; }
            #status { color: #6b7280; font-size: 14px; }
          </style>
        </head>
        <body>
          <h2>PayVault Connected</h2>
          <p id="status">Linking to extension...</p>
          <script nonce="payvault">
            (function() {
              var token = ${safeToken};
              var extId = ${safeExtId};
              function done(msg) {
                document.getElementById('status').textContent = msg;
                setTimeout(function() { window.close(); }, 1500);
              }
              if (!window.chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
                done('Extension not detected — please reload Xero and try again.');
                return;
              }
              chrome.runtime.sendMessage(extId, { type: 'STORE_TOKEN', token: token }, function(resp) {
                if (chrome.runtime.lastError || !resp || !resp.success) {
                  done('Could not reach extension — please reload Xero and try again.');
                  return;
                }
                done('Linked! Closing tab...');
              });
            })();
          </script>
        </body>
      </html>
    `;

        const response = new NextResponse(htmlResponse, {
            headers: { 'Content-Type': 'text/html' }
        });
        // Clear the CSRF state cookie
        response.cookies.set('oauth_state', '', { maxAge: 0, path: '/' });
        return response;

    } catch (err: unknown) {
        console.error('[PayVault] OAuth callback error:', err);
        return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
    }
}
