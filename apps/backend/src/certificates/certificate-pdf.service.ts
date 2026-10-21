import { Injectable } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { Certificate } from './certificate.entity';

@Injectable()
export class CertificatePdfService {
  async generateCertificatePdf(
    certificate: Certificate,
    verificationBaseUrl: string,
  ): Promise<Buffer> {
    const studentName =
      certificate.user?.username || certificate.user?.email || certificate.userId;
    const isLearningPath = certificate.certificateType === 'learning_path';
    const courseTitle = certificate.course?.title || certificate.courseId;
    const pathTitle =
      certificate.learningPath?.title || certificate.learningPathId || courseTitle;
    const issuedAt = certificate.issuedAt.toISOString().slice(0, 10);
    const verificationUrl = `${verificationBaseUrl}/v1/certificates/verify`;
    const qrPayload = JSON.stringify({ hash: certificate.certificateHash });

    // Generate QR as PNG buffer
    const qrPng: Buffer = await QRCode.toBuffer(qrPayload, { width: 120, margin: 1 });

    return this.buildPdf({
      studentName,
      courseTitle,
      pathTitle,
      isLearningPath,
      issuedAt,
      verificationUrl,
      qrPng,
      certificateId: certificate.id,
    });
  }

  private buildPdf(data: {
    studentName: string;
    courseTitle: string;
    pathTitle: string;
    isLearningPath: boolean;
    issuedAt: string;
    verificationUrl: string;
    qrPng: Buffer;
    certificateId: string;
  }): Buffer {
    const {
      studentName,
      courseTitle,
      pathTitle,
      isLearningPath,
      issuedAt,
      verificationUrl,
      qrPng,
      certificateId,
    } = data;

    const esc = (v: string) =>
      v.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

    // Page: landscape letter 792 x 612
    const W = 792;
    const H = 612;

    // Parse PNG dimensions from IHDR chunk (bytes 16-23)
    const qrW = qrPng.readUInt32BE(16);
    const qrH = qrPng.readUInt32BE(20);

    const qrX = W - 180;
    const qrY = H - 460;

    const content = isLearningPath
      ? this.buildLearningPathContent({
          studentName,
          pathTitle,
          issuedAt,
          verificationUrl,
          certificateId,
          W,
          H,
          qrX,
          qrY,
          qrW,
          qrH,
          esc,
        })
      : [
          // Background
          `q 0.98 0.96 0.88 rg 0 0 ${W} ${H} re f Q`,
          // Top/bottom bars (teal)
          `q 0.13 0.55 0.55 rg 0 ${H - 18} ${W} 18 re f Q`,
          `q 0.13 0.55 0.55 rg 0 0 ${W} 18 re f Q`,
          // Side bars
          `q 0.13 0.55 0.55 rg 0 0 8 ${H} re f Q`,
          `q 0.13 0.55 0.55 rg ${W - 8} 0 8 ${H} re f Q`,
          // Title
          `BT /F2 30 Tf 0.13 0.55 0.55 rg 60 ${H - 85} Td (Certificate of Completion) Tj ET`,
          // Body text
          `BT /F1 13 Tf 0.3 0.3 0.3 rg 60 ${H - 130} Td (This certifies that) Tj ET`,
          `BT /F2 24 Tf 0.1 0.1 0.1 rg 60 ${H - 170} Td (${esc(studentName)}) Tj ET`,
          `BT /F1 13 Tf 0.3 0.3 0.3 rg 60 ${H - 210} Td (has successfully completed the course) Tj ET`,
          `BT /F2 18 Tf 0.13 0.55 0.55 rg 60 ${H - 250} Td (${esc(courseTitle)}) Tj ET`,
          // Divider
          `q 0.7 0.7 0.7 RG 1 w 60 ${H - 275} m ${W - 60} ${H - 275} l S Q`,
          // Meta
          `BT /F1 11 Tf 0.3 0.3 0.3 rg 60 ${H - 310} Td (Date Issued: ${esc(issuedAt)}) Tj ET`,
          `BT /F1 9 Tf 0.5 0.5 0.5 rg 60 ${H - 330} Td (Certificate ID: ${esc(certificateId)}) Tj ET`,
          `BT /F1 9 Tf 0.5 0.5 0.5 rg 60 ${H - 350} Td (Verify at: ${esc(verificationUrl)}) Tj ET`,
          // QR label
          `BT /F1 9 Tf 0.3 0.3 0.3 rg ${qrX} ${qrY + qrH + 8} Td (Scan to verify on-chain) Tj ET`,
          // Draw QR image
          `q ${qrW} 0 0 ${qrH} ${qrX} ${qrY} cm /QR Do Q`,
        ].join('\n');

    const contentBuf = Buffer.from(content, 'latin1');

    // Build PDF objects as buffers
    const catalog = str(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj`);
    const pages = str(`2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj`);
    const page = str(
      `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}]\n` +
      `/Resources << /Font << /F1 4 0 R /F2 5 0 R >> /XObject << /QR 6 0 R >> >>\n` +
      `/Contents 7 0 R >>\nendobj`,
    );
    const fontReg = str(`4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj`);
    const fontBold = str(`5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj`);

    // Object 6: PNG image XObject
    const qrHeader = str(
      `6 0 obj\n<< /Type /XObject /Subtype /Image /Width ${qrW} /Height ${qrH}\n` +
      `/ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode\n` +
      `/Length ${qrPng.length} >>\nstream\n`,
    );
    const qrFooter = str(`\nendstream\nendobj`);

    // Object 7: content stream
    const contentObj = Buffer.concat([
      str(`7 0 obj\n<< /Length ${contentBuf.length} >>\nstream\n`),
      contentBuf,
      str(`\nendstream\nendobj`),
    ]);

    // Assemble with xref
    const header = str('%PDF-1.4\n');
    const parts: Buffer[] = [header];
    const offsets: number[] = [];
    let pos = header.length;

    const addObj = (buf: Buffer) => {
      offsets.push(pos);
      parts.push(buf);
      pos += buf.length;
    };

    addObj(catalog);
    addObj(pages);
    addObj(page);
    addObj(fontReg);
    addObj(fontBold);

    // QR image object (binary stream)
    offsets.push(pos);
    const qrObjBuf = Buffer.concat([qrHeader, qrPng, qrFooter]);
    parts.push(qrObjBuf);
    pos += qrObjBuf.length;

    addObj(contentObj);

    const xrefOffset = pos;
    const xrefLines = [
      `xref\n0 ${offsets.length + 1}\n`,
      '0000000000 65535 f \n',
      ...offsets.map((o) => `${o.toString().padStart(10, '0')} 00000 n \n`),
      `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`,
    ];
    parts.push(str(xrefLines.join('')));

    return Buffer.concat(parts);
  }

  private buildLearningPathContent(data: {
    studentName: string;
    pathTitle: string;
    issuedAt: string;
    verificationUrl: string;
    certificateId: string;
    W: number;
    H: number;
    qrX: number;
    qrY: number;
    qrW: number;
    qrH: number;
    esc: (v: string) => string;
  }): string {
    const {
      studentName,
      pathTitle,
      issuedAt,
      verificationUrl,
      certificateId,
      W,
      H,
      qrX,
      qrY,
      qrW,
      qrH,
      esc,
    } = data;

    return [
      // Background (deep navy for path certificates, distinct from course template)
      `q 0.07 0.12 0.24 rg 0 0 ${W} ${H} re f Q`,
      // Inner frame (gold)
      `q 0.85 0.68 0.25 RG 3 w 24 24 ${W - 48} ${H - 48} re S Q`,
      // Top/bottom bars (gold)
      `q 0.85 0.68 0.25 rg 0 ${H - 18} ${W} 18 re f Q`,
      `q 0.85 0.68 0.25 rg 0 0 ${W} 18 re f Q`,
      // Side bars
      `q 0.85 0.68 0.25 rg 0 0 8 ${H} re f Q`,
      `q 0.85 0.68 0.25 rg ${W - 8} 0 8 ${H} re f Q`,
      // Title
      `BT /F2 30 Tf 0.85 0.68 0.25 rg 60 ${H - 85} Td (Learning Path Completion) Tj ET`,
      // Body text
      `BT /F1 13 Tf 0.85 0.85 0.85 rg 60 ${H - 130} Td (This certifies that) Tj ET`,
      `BT /F2 24 Tf 1 1 1 rg 60 ${H - 170} Td (${esc(studentName)}) Tj ET`,
      `BT /F1 13 Tf 0.85 0.85 0.85 rg 60 ${H - 210} Td (has successfully completed the learning path) Tj ET`,
      `BT /F2 18 Tf 0.85 0.68 0.25 rg 60 ${H - 250} Td (${esc(pathTitle)}) Tj ET`,
      // Divider
      `q 0.85 0.68 0.25 RG 1 w 60 ${H - 275} m ${W - 60} ${H - 275} l S Q`,
      // Meta
      `BT /F1 11 Tf 0.85 0.85 0.85 rg 60 ${H - 310} Td (Date Issued: ${esc(issuedAt)}) Tj ET`,
      `BT /F1 9 Tf 0.6 0.6 0.6 rg 60 ${H - 330} Td (Certificate ID: ${esc(certificateId)}) Tj ET`,
      `BT /F1 9 Tf 0.6 0.6 0.6 rg 60 ${H - 350} Td (Verify at: ${esc(verificationUrl)}) Tj ET`,
      // QR label
      `BT /F1 9 Tf 0.85 0.85 0.85 rg ${qrX} ${qrY + qrH + 8} Td (Scan to verify on-chain) Tj ET`,
      // Draw QR image
      `q ${qrW} 0 0 ${qrH} ${qrX} ${qrY} cm /QR Do Q`,
    ].join('\n');
  }
}

function str(s: string): Buffer {
  return Buffer.from(s + '\n', 'latin1');
}
