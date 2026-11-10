// What the file pickers offer, so nothing is picked only to be refused (e.g. SVG or TIFF).

/** Invoice and receipt scanning: what the ai-scan function reads (its ALLOWED_MEDIA_TYPES). */
export const SCAN_FILE_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.gif';

/**
 * Mobile receipt capture (11-10): the same types as media types, which phones need to offer
 * the camera. Without HEIC listed, iPhones hand over library photos as JPEG.
 */
export const RECEIPT_FILE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,application/pdf';

/** Attachments: what the attachments bucket takes (attachment.service's ATTACHMENT_TYPES). */
export const ATTACHMENT_FILE_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif,.docx,.xlsx,.pptx,.csv';
