import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
import prisma from '../../../../lib/prisma';

export async function GET(request: Request) {
    // Verify cron secret if it is configured — always reject on mismatch when CRON_SECRET is set
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
        const authHeader = request.headers.get('authorization');
        if (authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
    }

    try {
        // Query all ledgers where balance has reached £0 or is less than the next monthly deduction
        const allLedgers = await prisma.ledger.findMany({
            include: {
                employee: {
                    include: { tenant: true }
                }
            }
        });

        const alertsTriggered: { tenantId: string; employeeId: string; balance: number }[] = [];

        for (const ledger of allLedgers) {
            if (
                ledger.remainingBalance <= 0 ||
                ledger.remainingBalance < ledger.monthlyDeduction
            ) {
                console.log(`[ALERT] Employee ${ledger.employee.xeroEmployeeId} needs attention. Remaining balance: £${ledger.remainingBalance}`);

                alertsTriggered.push({
                    tenantId: ledger.employee.tenantId,
                    employeeId: ledger.employee.xeroEmployeeId,
                    balance: ledger.remainingBalance
                });
            }
        }

        return NextResponse.json({ message: 'Balance checks completed', alerts: alertsTriggered.length, records: alertsTriggered });
    } catch (err: unknown) {
        console.error('[PayVault] Cron check-balances error:', err);
        return NextResponse.json({ error: 'Cron job failed' }, { status: 500 });
    }
}
