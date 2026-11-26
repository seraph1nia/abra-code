const encoder = new TextEncoder();
export const utf8Bytes = (text: string) => encoder.encode(text).byteLength;
export const maxUtf8Bytes = (maximum: number) => (text: string) => utf8Bytes(text) <= maximum;
