const htmlEntities: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => htmlEntities[character]);

const applicationMessages = {
  en: {
    receivedSubject: 'Application Received',
    receivedTitle: 'We received your instructor application',
    receivedBody:
      'Thank you for applying to become an instructor. We will review your application and email you when a decision is made.',
    approvedSubject: 'Application Approved',
    approvedTitle: 'Your instructor application is approved',
    approvedBody: 'Congratulations! You are now approved to teach on ScoopDope.',
    rejectedSubject: 'Application Rejected',
    rejectedTitle: 'Your instructor application was not approved',
    rejectedBody: 'Thank you for your interest in teaching on ScoopDope. Reviewer feedback:',
    greeting: 'Hello',
  },
  es: {
    receivedSubject: 'Solicitud recibida',
    receivedTitle: 'Hemos recibido tu solicitud para ser instructor',
    receivedBody:
      'Gracias por solicitar convertirte en instructor. Revisaremos tu solicitud y te enviaremos un correo cuando tomemos una decisión.',
    approvedSubject: 'Solicitud aprobada',
    approvedTitle: 'Tu solicitud para ser instructor ha sido aprobada',
    approvedBody: '¡Enhorabuena! Ya puedes impartir cursos en ScoopDope.',
    rejectedSubject: 'Solicitud rechazada',
    rejectedTitle: 'Tu solicitud para ser instructor no ha sido aprobada',
    rejectedBody: 'Gracias por tu interés en enseñar en ScoopDope. Comentarios del revisor:',
    greeting: 'Hola',
  },
  fr: {
    receivedSubject: 'Candidature reçue',
    receivedTitle: 'Nous avons reçu votre candidature pour enseigner',
    receivedBody:
      'Merci d’avoir souhaité devenir formateur. Nous étudierons votre candidature et vous informerons par e-mail de notre décision.',
    approvedSubject: 'Candidature approuvée',
    approvedTitle: 'Votre candidature pour enseigner est approuvée',
    approvedBody: 'Félicitations ! Vous pouvez désormais enseigner sur ScoopDope.',
    rejectedSubject: 'Candidature rejetée',
    rejectedTitle: 'Votre candidature pour enseigner n’a pas été approuvée',
    rejectedBody:
      'Merci de votre intérêt pour ScoopDope. Commentaire de la personne chargée de l’examen :',
    greeting: 'Bonjour',
  },
  ar: {
    receivedSubject: 'تم استلام الطلب',
    receivedTitle: 'لقد استلمنا طلبك لتصبح مدرّسًا',
    receivedBody:
      'شكرًا لتقديم طلبك لتصبح مدرّسًا. سنراجع طلبك ونرسل إليك بريدًا إلكترونيًا عند اتخاذ القرار.',
    approvedSubject: 'تمت الموافقة على الطلب',
    approvedTitle: 'تمت الموافقة على طلبك لتصبح مدرّسًا',
    approvedBody: 'تهانينا! يمكنك الآن التدريس على ScoopDope.',
    rejectedSubject: 'تم رفض الطلب',
    rejectedTitle: 'لم تتم الموافقة على طلبك لتصبح مدرّسًا',
    rejectedBody: 'شكرًا لاهتمامك بالتدريس على ScoopDope. ملاحظات المراجع:',
    greeting: 'مرحبًا',
  },
};

const waitlistMessages = {
  en: {
    subject: "You're on the waitlist!",
    title: "You're on the waitlist!",
    body: 'Thanks for signing up. We will email you as soon as a spot opens up.',
    positionLabel: 'Your position in the queue',
    timeline: 'Estimated invitation timeline: we are inviting new members in batches over the coming weeks.',
    greeting: 'Hello',
  },
  es: {
    subject: '¡Estás en la lista de espera!',
    title: '¡Estás en la lista de espera!',
    body: 'Gracias por registrarte. Te enviaremos un correo en cuanto se libere una plaza.',
    positionLabel: 'Tu posición en la cola',
    timeline:
      'Plazo estimado de invitación: estamos invitando a nuevos miembros por lotes durante las próximas semanas.',
    greeting: 'Hola',
  },
  fr: {
    subject: 'Vous êtes sur la liste d’attente !',
    title: 'Vous êtes sur la liste d’attente !',
    body: 'Merci de votre inscription. Nous vous enverrons un e-mail dès qu’une place se libère.',
    positionLabel: 'Votre position dans la file',
    timeline:
      'Délai d’invitation estimé : nous invitons les nouveaux membres par lots au cours des prochaines semaines.',
    greeting: 'Bonjour',
  },
  ar: {
    subject: 'أنت على قائمة الانتظار!',
    title: 'أنت على قائمة الانتظار!',
    body: 'شكرًا لتسجيلك. سنرسل إليك بريدًا إلكترونيًا بمجرد توفر مكان.',
    positionLabel: 'موقعك في قائمة الانتظار',
    timeline: 'الموعد المتوقع للدعوة: ندعو الأعضاء الجدد على دفعات خلال الأسابيع القادمة.',
    greeting: 'مرحبًا',
  },
};

type ApplicationLocale = keyof typeof applicationMessages;
type WaitlistLocale = keyof typeof waitlistMessages;

const isRtlLocale = (locale?: string) => (locale || 'en').split('-')[0].toLowerCase() === 'ar';

/**
 * Returns the attributes for the root <html> element plus RTL-safe CSS.
 * Arabic locales get dir="rtl" lang="ar"; everything else stays LTR.
 * Layout uses logical properties (padding-inline, margin-inline, text-align:start)
 * so padding/margins mirror automatically without overflowing the 600px container.
 */
const rtlSupport = (locale?: string) => {
  const rtl = isRtlLocale(locale);
  const lang = (locale || 'en').split('-')[0].toLowerCase();
  const htmlAttributes = `dir="${rtl ? 'rtl' : 'ltr'}" lang="${lang}"`;
  const css = rtl
    ? `<style>
        html[dir="rtl"] body { direction: rtl; text-align: right; }
        html[dir="rtl"] .email-container { direction: rtl; text-align: right; padding-inline: 16px; }
        html[dir="rtl"] blockquote { border-inline-start: 4px solid #ddd; border-inline-end: none; padding-inline-start: 12px; padding-inline-end: 0; margin-inline-start: 0; margin-inline-end: 0; }
        html[dir="rtl"] ul { padding-inline-start: 20px; padding-inline-end: 0; }
      </style>`
    : '';
  return { rtl, lang, htmlAttributes, css };
};

const wrapEmail = (locale: string | undefined, innerHtml: string) => {
  const { htmlAttributes, css } = rtlSupport(locale);
  return `<!DOCTYPE html>
<html ${htmlAttributes}>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${css}
  </head>
  <body style="margin:0;padding:0">
    <div class="email-container" style="font-family:sans-serif;max-width:600px;margin:0 auto;padding-inline:16px;box-sizing:border-box;text-align:start">
      ${innerHtml}
    </div>
  </body>
</html>`;
};

const applicationTemplate = (
  kind: 'received' | 'approved' | 'rejected',
  data: { userName: string; locale?: string; adminNote?: string | null }
) => {
  const locale = (data.locale || 'en').split('-')[0] as ApplicationLocale;
  const messages = applicationMessages[locale] || applicationMessages.en;
  const title = messages[`${kind}Title`];
  const body = messages[`${kind}Body`];
  const reviewerFeedback =
    kind === 'rejected' && data.adminNote
      ? `<blockquote>${escapeHtml(data.adminNote)}</blockquote>`
      : '';

  const inner = `
      <h2>${title}</h2>
      <p>${messages.greeting} ${escapeHtml(data.userName)},</p>
      <p>${body}</p>
      ${reviewerFeedback}`;

  return {
    subject: messages[`${kind}Subject`],
    html: wrapEmail(locale, inner),
  };
};

export const emailTemplates = {
  applicationReceived: (data: { userName: string; locale?: string }) =>
    applicationTemplate('received', data),

  applicationApproved: (data: { userName: string; locale?: string }) =>
    applicationTemplate('approved', data),

  applicationRejected: (data: { userName: string; locale?: string; adminNote?: string | null }) =>
    applicationTemplate('rejected', data),

  enrollment: (data: { userName: string; courseTitle: string; courseUrl: string; unsubscribeUrl: string; locale?: string }): EmailTemplate => {
    const html = wrapEmail(
      data.locale,
      `
        <h2>Welcome to ${data.courseTitle}!</h2>
        <p>Hi ${data.userName},</p>
        <p>You've successfully enrolled. Start learning now:</p>
        <a href="${data.courseUrl}" style="background:#4F46E5;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Go to Course</a>
        <p style="margin-top:40px;font-size:12px;color:#999">
          <a href="${data.unsubscribeUrl}">Unsubscribe</a>
        </p>`
    );

    return {
      subject: `You're enrolled in "${data.courseTitle}"`,
      html,
      text: htmlToPlainText(html),
    };
  },

  completion: (data: { userName: string; courseTitle: string; credentialUrl: string; unsubscribeUrl: string; locale?: string }): EmailTemplate => {
    const html = wrapEmail(
      data.locale,
      `
        <h2>🎉 Course Completed!</h2>
        <p>Hi ${data.userName},</p>
        <p>You've completed <strong>${data.courseTitle}</strong>. Your credential is ready:</p>
        <a href="${data.credentialUrl}" style="background:#059669;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">View Credential</a>
        <p style="margin-top:40px;font-size:12px;color:#999">
          <a href="${data.unsubscribeUrl}">Unsubscribe</a>
        </p>`
    );
    
    return {
      subject: `Congratulations! You completed "${data.courseTitle}"`,
      html,
      text: htmlToPlainText(html),
    };
  },

  credentialIssued: (data: { userName: string; courseTitle: string; txHash: string; unsubscribeUrl: string; locale?: string }): EmailTemplate => {
    const html = wrapEmail(
      data.locale,
      `
        <h2>🏆 Credential Issued on Stellar</h2>
        <p>Hi ${data.userName},</p>
        <p>Your credential for <strong>${data.courseTitle}</strong> has been recorded on the Stellar blockchain.</p>
        <p>Transaction: <code>${data.txHash}</code></p>
        <p style="margin-top:40px;font-size:12px;color:#999">
          <a href="${data.unsubscribeUrl}">Unsubscribe</a>
        </p>`
    );
    
    return {
      subject: `Your blockchain credential for "${data.courseTitle}" is ready`,
      html,
      text: htmlToPlainText(html),
    };
  },

  moduleUnlocked: (data: { userName: string; courseTitle: string; moduleTitle: string; courseUrl: string; unsubscribeUrl: string; locale?: string }): EmailTemplate => {
    const html = wrapEmail(
      data.locale,
      `
        <h2>🔓 New Module Available</h2>
        <p>Hi ${data.userName},</p>
        <p>A new module has just unlocked in <strong>${data.courseTitle}</strong>:</p>
        <p style="font-size:18px;font-weight:bold">${data.moduleTitle}</p>
        <a href="${data.courseUrl}" style="background:#4F46E5;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Start Learning</a>
        <p style="margin-top:40px;font-size:12px;color:#999">
          <a href="${data.unsubscribeUrl}">Unsubscribe</a>
        </p>`
    );
    
    return {
      subject: `New content unlocked in "${data.courseTitle}"`,
      html,
      text: htmlToPlainText(html),
    };
  },

  liveSessionReminder: (data: { userName: string; sessionTitle: string; date: string; timeLabel: string; joinUrl: string; sessionUrl: string; locale?: string }): EmailTemplate => {
    const html = wrapEmail(
      data.locale,
      `
        <h2>⏰ Session starting in ${data.timeLabel}</h2>
        <p>Hi ${data.userName},</p>
        <p><strong>${data.sessionTitle}</strong> starts in ${data.timeLabel}.</p>
        <ul>
          <li><strong>Date:</strong> ${data.date}</li>
          ${data.joinUrl ? `<li><strong>Join:</strong> <a href="${data.joinUrl}">${data.joinUrl}</a></li>` : ''}
        </ul>
        <a href="${data.joinUrl || data.sessionUrl}" style="background:#059669;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Join Now</a>`
    );
    
    return {
      subject: `⏰ Reminder: "${data.sessionTitle}" starts in ${data.timeLabel}`,
      html,
      text: htmlToPlainText(html),
    };
  },

  calendarInvite: (data: { userName: string; sessionTitle: string; date: string; duration: number; joinUrl?: string; sessionUrl: string; locale?: string }): EmailTemplate => {
    const html = wrapEmail(
      data.locale,
      `
        <h2>📅 You're invited to a live session</h2>
        <p>Hi ${data.userName},</p>
        <p><strong>${data.sessionTitle}</strong> has been scheduled.</p>
        <ul>
          <li><strong>Date:</strong> ${data.date}</li>
          <li><strong>Duration:</strong> ${data.duration} minutes</li>
          ${data.joinUrl ? `<li><strong>Join:</strong> <a href="${data.joinUrl}">${data.joinUrl}</a></li>` : ''}
        </ul>
        <p>Add to your calendar using the attached .ics file.</p>
        <a href="${data.sessionUrl}" style="background:#4F46E5;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">View Session</a>`
    );
    
    return {
      subject: `📅 Live Session: ${data.sessionTitle}`,
      html,
      text: htmlToPlainText(html),
    };
  },
};
