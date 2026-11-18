// SHA-256 as lowercase hex (the frozen configs).
export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>))
  return [...digest].map(b => b.toString(16).padStart(2, "0")).join("")
}

export const sha256Text = (text: string) => sha256(new TextEncoder().encode(text))
