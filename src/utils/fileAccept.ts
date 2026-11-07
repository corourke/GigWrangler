// What the file pickers offer, so nothing is picked only to be refused (e.g. SVG or TIFF).

/** Invoice and receipt scanning: what the ai-scan function reads (its ALLOWED_MEDIA_TYPES). */
export const SCAN_FILE_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.gif';

/** Attachments: what the attachments bucket takes (attachment.service's ATTACHMENT_TYPES). */
export const ATTACHMENT_FILE_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif,.docx,.xlsx,.pptx,.csv';
