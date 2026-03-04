import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
import prisma from '../../../lib/prisma';
import { verifySession } from '../../../lib/auth';

function isPositiveFinite(value: unknown): value is number {
    return typeof value === 'number' && isFinite(value) && value >= 0;
}

export async function GET(request: NextRequest) {
    const session = await verifySession(request);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const employeeId = request.nextUrl.searchParams.get('employeeId');
    if (!employeeId) return NextResponse.json({ error: 'Missing employeeId' }, { status: 400 });

    try {
        const employee = await prisma.employee.findUnique({
            where: {
                tenantId_xeroEmployeeId: {
                    tenantId: session.tenantId,
                    xeroEmployeeId: employeeId
                }
            },
            include: {
                ledgers: true
            }
        });

        if (!employee || employee.ledgers.length === 0) {
            return NextResponse.json({ ledger: null });
        }

        return NextResponse.json({ ledger: employee.ledgers[0] });
    } catch (error) {
        console.error('[PayVault] GET /api/aeo error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    const session = await verifySession(request);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const body = await request.json();
        const { employeeId, totalDebt, monthlyDeduction, protectedEarnings, balanceAdjustment } = body;

        // Validate required fields
        if (typeof employeeId !== 'string' || !employeeId.trim()) {
            return NextResponse.json({ error: 'Invalid employeeId' }, { status: 400 });
        }
        if (!isPositiveFinite(totalDebt)) {
            return NextResponse.json({ error: 'totalDebt must be a non-negative number' }, { status: 400 });
        }
        if (!isPositiveFinite(monthlyDeduction)) {
            return NextResponse.json({ error: 'monthlyDeduction must be a non-negative number' }, { status: 400 });
        }
        if (!isPositiveFinite(protectedEarnings)) {
            return NextResponse.json({ error: 'protectedEarnings must be a non-negative number' }, { status: 400 });
        }
        if (balanceAdjustment !== undefined && !isPositiveFinite(balanceAdjustment)) {
            return NextResponse.json({ error: 'balanceAdjustment must be a non-negative number' }, { status: 400 });
        }

        // 1. Ensure Employee exists for this tenant
        const employee = await prisma.employee.upsert({
            where: {
                tenantId_xeroEmployeeId: {
                    tenantId: session.tenantId,
                    xeroEmployeeId: employeeId
                }
            },
            update: {},
            create: {
                tenantId: session.tenantId,
                xeroEmployeeId: employeeId,
                name: 'Unknown via Extension'
            }
        });

        // 2. Upsert Ledger
        const existingLedger = await prisma.ledger.findFirst({
            where: { employeeId: employee.id }
        });

        let newBalance = totalDebt;
        if (existingLedger && balanceAdjustment !== undefined) {
            newBalance = existingLedger.remainingBalance - balanceAdjustment;
            if (newBalance < 0) newBalance = 0;
        } else if (existingLedger) {
            newBalance = existingLedger.remainingBalance;
        }

        const ledger = await prisma.ledger.upsert({
            where: { id: existingLedger?.id || '' },
            update: {
                totalDebt,
                monthlyDeduction,
                protectedEarnings,
                remainingBalance: newBalance
            },
            create: {
                employeeId: employee.id,
                totalDebt,
                monthlyDeduction,
                protectedEarnings,
                remainingBalance: totalDebt
            }
        });

        return NextResponse.json({ ledger });
    } catch (error) {
        console.error('[PayVault] POST /api/aeo error:', error);
        return NextResponse.json({ error: 'Failed to save ledger' }, { status: 500 });
    }
}
