import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '../../../lib/auth';
import prisma from '../../../lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const session = await verifySession(request);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const employees = await prisma.employee.findMany({
            where: { tenantId: session.tenantId },
            include: {
                _count: { select: { documents: true } },
                documents: {
                    select: { documentType: true },
                },
            },
            orderBy: { createdAt: 'asc' },
        });

        const result = employees.map(emp => ({
            id: emp.id,
            xeroEmployeeId: emp.xeroEmployeeId,
            name: emp.name,
            documentCount: emp._count.documents,
            documentTypes: emp.documents.map(d => d.documentType),
        }));

        return NextResponse.json({ employees: result });
    } catch (error) {
        console.error('[PayVault] GET /api/employees error:', error);
        return NextResponse.json({ error: 'Failed to fetch employees' }, { status: 500 });
    }
}
