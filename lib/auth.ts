import { NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';
import prisma from './prisma';

export interface PayVaultSession {
    tenantId: string;
    xeroTenantId: string;
}

export async function verifySession(request: NextRequest): Promise<PayVaultSession | null> {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }

    const token = authHeader.split(' ')[1];
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) throw new Error('JWT_SECRET environment variable is not set');

    try {
        const decoded = jwt.verify(token, jwtSecret) as PayVaultSession;

        // Optional: Check if tenant still exists in DB
        const tenant = await prisma.tenant.findUnique({
            where: { id: decoded.tenantId }
        });

        if (!tenant) return null;

        return decoded;
    } catch (error) {
        return null;
    }
}
