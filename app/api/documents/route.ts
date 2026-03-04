import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
import { verifySession } from '../../../lib/auth';
import prisma from '../../../lib/prisma';
import crypto from 'crypto';
import path from 'path';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({
    region: process.env.AWS_REGION!,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
});

const BUCKET = process.env.AWS_S3_BUCKET!;

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.doc', '.docx']);

const ALLOWED_DOCUMENT_TYPES = new Set([
    'TFN_DECLARATION',
    'SUPER_CHOICE',
    'EMPLOYMENT_CONTRACT',
    'IDENTIFICATION',
    'OTHER',
]);

function sanitizeFilename(raw: unknown): string | null {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    const base = path.basename(raw);
    const safe = base.replace(/[^a-zA-Z0-9 .\-_]/g, '_');
    if (!safe || safe === '.' || safe === '..') return null;
    const ext = path.extname(safe).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) return null;
    return safe;
}

export async function GET(request: NextRequest) {
    const session = await verifySession(request);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const { searchParams } = new URL(request.url);
        const employeeId = searchParams.get('employeeId');
        const documentId = searchParams.get('documentId');

        // Return a presigned GET URL for a single document (used for download)
        if (documentId) {
            const doc = await prisma.document.findUnique({
                where: { id: documentId },
                include: { employee: true },
            });
            if (!doc || doc.employee.tenantId !== session.tenantId) {
                return NextResponse.json({ error: 'Document not found' }, { status: 404 });
            }
            const downloadUrl = await getSignedUrl(
                s3,
                new GetObjectCommand({ Bucket: BUCKET, Key: doc.s3Key }),
                { expiresIn: 300 } // 5 minutes
            );
            return NextResponse.json({ downloadUrl });
        }

        // Return list of documents for an employee
        if (!employeeId || !employeeId.trim()) {
            return NextResponse.json({ error: 'Missing employeeId or documentId' }, { status: 400 });
        }

        const employee = await prisma.employee.upsert({
            where: {
                tenantId_xeroEmployeeId: {
                    tenantId: session.tenantId,
                    xeroEmployeeId: employeeId
                }
            },
            update: {},
            create: { tenantId: session.tenantId, xeroEmployeeId: employeeId }
        });

        const documents = await prisma.document.findMany({
            where: { employeeId: employee.id },
            select: { id: true, filename: true, documentType: true, uploadedAt: true },
            orderBy: { uploadedAt: 'desc' },
        });

        return NextResponse.json({ documents });
    } catch (error) {
        console.error('[PayVault] GET /api/documents error:', error);
        return NextResponse.json({ error: 'Failed to fetch documents' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    const session = await verifySession(request);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const body = await request.json();
        const { employeeId } = body;
        const filename = sanitizeFilename(body.filename);
        const documentType = typeof body.documentType === 'string' && ALLOWED_DOCUMENT_TYPES.has(body.documentType)
            ? body.documentType
            : 'OTHER';

        if (typeof employeeId !== 'string' || !employeeId.trim()) {
            return NextResponse.json({ error: 'Invalid employeeId' }, { status: 400 });
        }
        if (!filename) {
            return NextResponse.json({ error: 'Invalid or disallowed filename' }, { status: 400 });
        }

        const employee = await prisma.employee.upsert({
            where: {
                tenantId_xeroEmployeeId: {
                    tenantId: session.tenantId,
                    xeroEmployeeId: employeeId
                }
            },
            update: {},
            create: { tenantId: session.tenantId, xeroEmployeeId: employeeId }
        });

        const s3Key = `tenants/${session.tenantId}/employees/${employee.id}/${crypto.randomUUID()}-${filename}`;

        const uploadUrl = await getSignedUrl(
            s3,
            new PutObjectCommand({
                Bucket: BUCKET,
                Key: s3Key,
                ContentType: 'application/octet-stream',
            }),
            { expiresIn: 300 } // 5 minutes
        );

        const doc = await prisma.document.create({
            data: { employeeId: employee.id, filename, s3Key, documentType }
        });

        return NextResponse.json({ uploadUrl, document: doc });
    } catch (error) {
        console.error('[PayVault] POST /api/documents error:', error);
        return NextResponse.json({ error: 'Failed to negotiate upload' }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    const session = await verifySession(request);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const { searchParams } = new URL(request.url);
        const documentId = searchParams.get('documentId');

        if (!documentId || !documentId.trim()) {
            return NextResponse.json({ error: 'Missing documentId' }, { status: 400 });
        }

        const doc = await prisma.document.findUnique({
            where: { id: documentId },
            include: { employee: true },
        });
        if (!doc || doc.employee.tenantId !== session.tenantId) {
            return NextResponse.json({ error: 'Document not found' }, { status: 404 });
        }

        // Delete from S3 first, then DB
        await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: doc.s3Key }));
        await prisma.document.delete({ where: { id: documentId } });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[PayVault] DELETE /api/documents error:', error);
        return NextResponse.json({ error: 'Failed to delete document' }, { status: 500 });
    }
}
